import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomUUID } from 'node:crypto';
import { store, nowIso } from './store.js';
import { classifyText, collectInputText, extractText } from './engine.js';
import { CORE_SCHEMA_ID, PLAN_LIMITS } from './types.js';
import type { DocumentJob, Tenant } from './types.js';

type Env = { Variables: { tenant: Tenant } };

export const app = new Hono<Env>();

app.use('*', cors());

app.get('/health', c => c.json({ ok: true, service: 'ai-doc-api', version: '1.0.0' }));

app.use('/v1/*', async (c, next) => {
  const auth = c.req.header('authorization') || c.req.header('x-api-key');
  const tenant = store.resolveTenantByApiKey(auth ?? undefined);
  if (!tenant || !tenant.active) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('tenant', tenant);
  await next();
});

app.get('/v1/schemas', c => {
  return c.json({
    data: [
      {
        id: CORE_SCHEMA_ID,
        name: 'Quotation Request Core',
        version: 1,
        description: 'ERP orders/order_items canonical RFQ schema',
      },
    ],
  });
});

app.get('/v1/usage', c => {
  const tenant = c.get('tenant');
  const used = store.monthUsage(tenant.id);
  const sub = store.subscriptions.get(tenant.id);
  return c.json({
    tenant_id: tenant.id,
    plan: tenant.plan,
    period_month: nowIso().slice(0, 7),
    used_documents: used,
    monthly_doc_limit: tenant.monthly_doc_limit,
    remaining: Math.max(0, tenant.monthly_doc_limit - used),
    subscription: sub ?? null,
  });
});

app.post('/v1/documents/classify', async c => {
  const tenant = c.get('tenant');
  try {
    store.assertWithinQuota(tenant);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 429);
  }
  const body = await c.req.json<{ text?: string; files?: DocumentJob['input']['files'] }>();
  const text = collectInputText(body);
  const result = await classifyText(text, body.files);
  store.recordUsage(tenant.id, 'classify', 1, { document_type: result.document_type });
  return c.json({ data: result });
});

app.post('/v1/documents/extract', async c => {
  const tenant = c.get('tenant');
  try {
    store.assertWithinQuota(tenant);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 429);
  }
  const body = await c.req.json<{
    schema_id?: string;
    text?: string;
    files?: DocumentJob['input']['files'];
  }>();
  const text = collectInputText(body);
  const result = await extractText(text, body.files);
  store.recordUsage(tenant.id, 'extract', 1, { schema_id: body.schema_id ?? CORE_SCHEMA_ID });
  return c.json({ data: result, schema_id: body.schema_id ?? CORE_SCHEMA_ID });
});

app.post('/v1/jobs', async c => {
  const tenant = c.get('tenant');
  try {
    store.assertWithinQuota(tenant);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 429);
  }
  const body = await c.req.json<{
    schema_id?: string;
    text?: string;
    filename?: string;
    mime_type?: string;
    files?: DocumentJob['input']['files'];
    webhook_url?: string;
  }>();

  const job: DocumentJob = {
    id: `job_${randomUUID()}`,
    tenant_id: tenant.id,
    status: 'queued',
    schema_id: body.schema_id ?? CORE_SCHEMA_ID,
    created_at: nowIso(),
    updated_at: nowIso(),
    input: {
      text: body.text,
      filename: body.filename,
      mime_type: body.mime_type,
      files: body.files,
    },
  };
  store.jobs.set(job.id, job);
  store.recordUsage(tenant.id, 'job', 1, { job_id: job.id });

  // Async processing (OpenAI may take a few seconds)
  setTimeout(() => {
    void (async () => {
      const j = store.jobs.get(job.id);
      if (!j) return;
      j.status = 'processing';
      j.updated_at = nowIso();
      try {
        const text = collectInputText(j.input);
        j.classify = await classifyText(text, j.input.files);
        j.result = await extractText(text, j.input.files);
        j.status = 'completed';
      } catch (e) {
        j.status = 'failed';
        j.error = (e as Error).message;
      }
      j.updated_at = nowIso();

      if (body.webhook_url) {
        fetch(body.webhook_url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-ai-doc-event': 'job.completed' },
          body: JSON.stringify({ job_id: j.id, status: j.status }),
        }).catch(() => undefined);
      }
    })();
  }, 50);

  return c.json({ job_id: job.id, status: job.status }, 202);
});

app.get('/v1/jobs/:id', c => {
  const tenant = c.get('tenant');
  const job = store.jobs.get(c.req.param('id'));
  if (!job || job.tenant_id !== tenant.id) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: job });
});

app.post('/v1/webhooks/test', async c => {
  const body = await c.req.json<{ url: string }>();
  try {
    const res = await fetch(body.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ai-doc-event': 'webhook.test' },
      body: JSON.stringify({ ok: true, at: nowIso() }),
    });
    return c.json({ delivered: res.ok, status: res.status });
  } catch (e) {
    return c.json({ delivered: false, error: (e as Error).message }, 400);
  }
});

/** Admin-ish: create API key for tenant (dev) */
app.post('/v1/admin/api-keys', async c => {
  const tenant = c.get('tenant');
  const body = await c.req.json<{ name?: string }>();
  const rec = store.createApiKey(tenant.id, body.name || 'generated');
  return c.json({
    id: rec.id,
    key_prefix: rec.key_prefix,
    api_key: rec.raw_key_once,
    warning: 'Store this key now; it will not be shown again.',
  });
});

app.get('/v1/billing/plans', c => {
  return c.json({
    data: Object.entries(PLAN_LIMITS).map(([plan, monthly_doc_limit]) => ({
      plan,
      monthly_doc_limit,
      billing: 'monthly_subscription',
    })),
  });
});

app.get('/v1/billing/subscription', c => {
  const tenant = c.get('tenant');
  return c.json({ data: store.subscriptions.get(tenant.id) ?? null });
});
