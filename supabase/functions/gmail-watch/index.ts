/**
 * Gmail Watch + Pub/Sub push receiver (Supabase Edge Function)
 *
 * Endpoints:
 *   GET  /gmail-watch           → health
 *   POST /gmail-watch           → Pub/Sub push (new mail) + AI classify/extract
 *   POST /gmail-watch?action=watch → register/renew Gmail users.watch
 *
 * Required secrets:
 *   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
 *   GMAIL_TOPIC_NAME          projects/.../topics/gmail-push
 *   GMAIL_USER                me  or  rfq@company.com
 *   AI_DOC_API_URL            public URL to ai-doc-api (not localhost)
 *   AI_DOC_API_KEY            Bearer key for ai-doc-api
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

type PubSubPush = {
  message?: { data?: string; messageId?: string };
  subscription?: string;
};

type GmailHeader = { name: string; value: string };
type GmailPayload = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
  headers?: GmailHeader[];
};

type CanonicalExtraction = {
  document_type: string;
  language: string;
  overall_confidence: number;
  customer: { name: { value: string | null } };
  request: { document_no?: { value: string | null } };
  items: { product_name: { value: string | null }; quantity: { value: number | null } }[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name)?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function b64urlDecode(data: string): string {
  const pad = '='.repeat((4 - (data.length % 4)) % 4);
  const b64 = (data + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const h = headers?.find(x => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function collectText(payload: GmailPayload | undefined): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;

  const walk = (p?: GmailPayload) => {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    if (p.body?.data) {
      const decoded = b64urlDecode(p.body.data);
      if (mt === 'text/plain' && !text) text = decoded;
      if (mt === 'text/html' && !html) html = decoded;
    }
    for (const part of p.parts || []) walk(part);
  };
  walk(payload);

  if (!text && html) {
    text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return { text, html };
}

function collectAttachmentMeta(payload: GmailPayload | undefined) {
  const out: { filename: string; mime_type: string | null; size_bytes: number | null }[] = [];
  const walk = (p?: GmailPayload) => {
    if (!p) return;
    if (p.filename) {
      out.push({
        filename: p.filename,
        mime_type: p.mimeType ?? null,
        size_bytes: p.body?.size ?? null,
      });
    }
    for (const part of p.parts || []) walk(part);
  };
  walk(payload);
  return out;
}

async function getAccessToken(): Promise<string> {
  const clientId = requireEnv('GMAIL_CLIENT_ID');
  const clientSecret = requireEnv('GMAIL_CLIENT_SECRET');
  const refreshToken = requireEnv('GMAIL_REFRESH_TOKEN');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`token refresh failed: ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

function gmailUser(): string {
  return encodeURIComponent(Deno.env.get('GMAIL_USER')?.trim() || 'me');
}

async function gmailGet(path: string, accessToken: string) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail GET ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function gmailPost(path: string, accessToken: string, body: unknown) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail POST ${path}: ${JSON.stringify(data)}`);
  return data;
}

function adminClient() {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function decideProcessStatus(extraction: CanonicalExtraction): 'ready_auto' | 'review_required' {
  const conf = extraction.overall_confidence;
  const hasCustomer = !!extraction.customer?.name?.value;
  const hasItems = (extraction.items || []).some(
    i => i.product_name?.value && i.quantity?.value != null,
  );
  const hasDocNo = !!extraction.request?.document_no?.value?.toString().trim();
  if (conf >= 0.95 && hasCustomer && hasItems && hasDocNo) return 'ready_auto';
  return 'review_required';
}

function aiApiConfigured(): boolean {
  return !!(Deno.env.get('AI_DOC_API_URL')?.trim() && Deno.env.get('AI_DOC_API_KEY')?.trim());
}

async function aiDocRequest<T>(path: string, body: unknown): Promise<T> {
  const base = requireEnv('AI_DOC_API_URL').replace(/\/$/, '');
  const key = requireEnv('AI_DOC_API_KEY');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const jsonBody = await res.json();
  if (!res.ok) throw new Error(jsonBody.error || `AI API ${path} ${res.status}`);
  return jsonBody as T;
}

/** Classify + extract; updates mail_messages. Skips if AI secrets missing. */
async function runAiForMail(
  sb: ReturnType<typeof adminClient>,
  mailId: number,
  text: string,
): Promise<{ status: string; skipped?: boolean; error?: string }> {
  if (!aiApiConfigured()) {
    console.log('AI skipped: AI_DOC_API_URL/KEY not set');
    return { status: 'received', skipped: true };
  }
  if (!text.trim()) {
    await sb
      .from('mail_messages')
      .update({ process_status: 'failed', error_message: 'empty body' })
      .eq('id', mailId);
    return { status: 'failed', error: 'empty body' };
  }

  await sb.from('mail_messages').update({ process_status: 'classifying' }).eq('id', mailId);

  try {
    const cls = await aiDocRequest<{
      data: { document_type: string; confidence: number; language: string };
    }>('/v1/documents/classify', { text });

    const isRfq = cls.data.document_type === 'quotation_request';
    await sb
      .from('mail_messages')
      .update({
        is_rfq: isRfq,
        classify_confidence: cls.data.confidence,
        process_status: isRfq ? 'extracting' : 'rejected',
      })
      .eq('id', mailId);

    if (!isRfq) return { status: 'rejected' };

    const extracted = await aiDocRequest<{ data: CanonicalExtraction }>(
      '/v1/documents/extract',
      { text },
    );
    const status = decideProcessStatus(extracted.data);

    await sb
      .from('mail_messages')
      .update({
        extraction: extracted.data,
        process_status: status,
        error_message: null,
      })
      .eq('id', mailId);

    console.log(`AI mail ${mailId} → ${status}`);
    return { status };
  } catch (e) {
    const msg = String(e);
    console.error('AI pipeline failed', mailId, msg);
    await sb
      .from('mail_messages')
      .update({ process_status: 'failed', error_message: msg.slice(0, 500) })
      .eq('id', mailId);
    return { status: 'failed', error: msg };
  }
}

async function registerWatch(accessToken: string) {
  const topicName = requireEnv('GMAIL_TOPIC_NAME');
  const mailbox = Deno.env.get('GMAIL_USER')?.trim() || 'me';
  const sb = adminClient();

  const watch = await gmailPost(`/users/${gmailUser()}/watch`, accessToken, {
    topicName,
    labelIds: ['INBOX'],
  });

  const historyId = String(watch.historyId ?? '');
  const expirationMs = watch.expiration ? Number(watch.expiration) : null;
  const watchExpiration = expirationMs ? new Date(expirationMs).toISOString() : null;

  await sb.from('gmail_sync_state').upsert(
    {
      mailbox,
      last_history_id: historyId || null,
      watch_expiration: watchExpiration,
      topic_name: topicName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'mailbox' },
  );

  return {
    historyId,
    expiration: watchExpiration,
    topicName,
  };
}

async function syncFromHistory(accessToken: string, incomingHistoryId?: string) {
  const mailbox = Deno.env.get('GMAIL_USER')?.trim() || 'me';
  const sb = adminClient();

  const { data: state } = await sb
    .from('gmail_sync_state')
    .select('*')
    .eq('mailbox', mailbox)
    .maybeSingle();

  const startHistoryId = state?.last_history_id as string | null | undefined;

  // First push / empty state: seed with incoming historyId (no backlog fetch)
  if (!startHistoryId) {
    if (incomingHistoryId) {
      await sb.from('gmail_sync_state').upsert(
        {
          mailbox,
          last_history_id: incomingHistoryId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'mailbox' },
      );
    }
    return { synced: 0, ai: [], seeded: true, historyId: incomingHistoryId ?? null };
  }

  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let newestHistoryId = startHistoryId;

  do {
    const qs = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
    });
    if (pageToken) qs.set('pageToken', pageToken);

    let hist: {
      history?: { messagesAdded?: { message?: { id?: string } }[]; id?: string }[];
      historyId?: string;
      nextPageToken?: string;
    };
    try {
      hist = await gmailGet(`/users/${gmailUser()}/history?${qs}`, accessToken);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('404') || msg.includes('historyId')) {
        if (incomingHistoryId) {
          await sb.from('gmail_sync_state').upsert(
            {
              mailbox,
              last_history_id: incomingHistoryId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'mailbox' },
          );
        }
        return { synced: 0, ai: [], reseeding: true, error: msg };
      }
      throw e;
    }

    for (const h of hist.history || []) {
      if (h.id) newestHistoryId = h.id;
      for (const m of h.messagesAdded || []) {
        if (m.message?.id) messageIds.add(m.message.id);
      }
    }
    if (hist.historyId) newestHistoryId = String(hist.historyId);
    pageToken = hist.nextPageToken;
  } while (pageToken);

  let synced = 0;
  const aiResults: { mailId: number; status: string }[] = [];

  for (const id of messageIds) {
    const msg = await gmailGet(
      `/users/${gmailUser()}/messages/${id}?format=full`,
      accessToken,
    );

    const headers = (msg.payload?.headers || []) as GmailHeader[];
    const { text, html } = collectText(msg.payload as GmailPayload);
    const attachments = collectAttachmentMeta(msg.payload as GmailPayload);
    const internalDate = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString();

    // Skip if already processed (Pub/Sub redelivery)
    const { data: existing } = await sb
      .from('mail_messages')
      .select('id, process_status')
      .eq('gmail_message_id', msg.id)
      .maybeSingle();

    if (
      existing &&
      existing.process_status &&
      !['received', 'failed', 'classifying', 'extracting'].includes(existing.process_status)
    ) {
      console.log('skip already processed', msg.id, existing.process_status);
      continue;
    }

    const { data: row, error } = await sb
      .from('mail_messages')
      .upsert(
        {
          gmail_message_id: msg.id,
          gmail_thread_id: msg.threadId ?? null,
          history_id: newestHistoryId,
          subject: headerValue(headers, 'Subject'),
          from_addr: headerValue(headers, 'From'),
          to_addr: headerValue(headers, 'To'),
          received_at: internalDate,
          snippet: msg.snippet ?? null,
          body_text: text,
          body_html: html,
          process_status: existing?.process_status === 'failed' ? 'received' : (existing?.process_status || 'received'),
        },
        { onConflict: 'gmail_message_id' },
      )
      .select('id, process_status')
      .single();

    if (error) {
      console.error('upsert mail failed', msg.id, error);
      continue;
    }

    if (row && attachments.length) {
      await sb.from('mail_attachments').delete().eq('mail_message_id', row.id);
      await sb.from('mail_attachments').insert(
        attachments.map(a => ({
          mail_message_id: row.id,
          filename: a.filename,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
        })),
      );
    }

    synced += 1;

    const bodyForAi = [text || '', msg.snippet || ''].filter(Boolean).join('\n');
    const ai = await runAiForMail(sb, row.id, bodyForAi);
    aiResults.push({ mailId: row.id, status: ai.status });
  }

  await sb.from('gmail_sync_state').upsert(
    {
      mailbox,
      last_history_id: incomingHistoryId || newestHistoryId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'mailbox' },
  );

  return {
    synced,
    ai: aiResults,
    historyId: incomingHistoryId || newestHistoryId,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'GET') {
      return json({
        ok: true,
        service: 'gmail-watch',
        ai_configured: aiApiConfigured(),
      });
    }

    if (req.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const accessToken = await getAccessToken();

    if (action === 'watch') {
      const result = await registerWatch(accessToken);
      return json({ ok: true, watch: result });
    }

    const body = (await req.json()) as PubSubPush;
    const dataB64 = body?.message?.data;
    const decoded = dataB64
      ? JSON.parse(atob(dataB64)) as { emailAddress?: string; historyId?: string }
      : (body as { emailAddress?: string; historyId?: string });

    const historyId = decoded?.historyId ? String(decoded.historyId) : undefined;
    const result = await syncFromHistory(accessToken, historyId);

    return json({
      ok: true,
      emailAddress: decoded?.emailAddress ?? null,
      historyId: historyId ?? null,
      result,
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
