import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  ApiKeyRecord,
  DocumentJob,
  Subscription,
  Tenant,
  UsageEvent,
} from './types.js';
import { PLAN_LIMITS } from './types.js';

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

/** In-memory SaaS store (swap to Postgres for production) */
class Store {
  tenants = new Map<string, Tenant>();
  apiKeys = new Map<string, ApiKeyRecord>();
  jobs = new Map<string, DocumentJob>();
  usage: UsageEvent[] = [];
  subscriptions = new Map<string, Subscription>();
  webhooks = new Map<string, { tenant_id: string; url: string; secret: string }>();

  constructor() {
    this.seedDemoTenant();
  }

  private seedDemoTenant() {
    const tenant: Tenant = {
      id: 'tenant_haewon',
      name: '해원마린서비스',
      plan: 'standard',
      monthly_doc_limit: PLAN_LIMITS.standard,
      active: true,
      created_at: nowIso(),
    };
    this.tenants.set(tenant.id, tenant);
    const raw = process.env.AI_DOC_DEMO_API_KEY || 'aidoc_demo_haewon_dev_key_change_me';
    const rec: ApiKeyRecord = {
      id: randomUUID(),
      tenant_id: tenant.id,
      name: 'erp-dev',
      key_prefix: raw.slice(0, 12),
      key_hash: hashKey(raw),
      created_at: nowIso(),
      revoked_at: null,
    };
    this.apiKeys.set(rec.id, rec);
    this.subscriptions.set(tenant.id, {
      tenant_id: tenant.id,
      plan: 'standard',
      status: 'active',
      period_start: nowIso().slice(0, 10),
      period_end: '2099-12-31',
    });
  }

  resolveTenantByApiKey(rawKey: string | undefined): Tenant | null {
    if (!rawKey) return null;
    const h = hashKey(rawKey.replace(/^Bearer\s+/i, '').trim());
    for (const k of this.apiKeys.values()) {
      if (k.revoked_at) continue;
      if (k.key_hash === h) {
        return this.tenants.get(k.tenant_id) ?? null;
      }
    }
    return null;
  }

  createApiKey(tenantId: string, name: string) {
    const raw = `aidoc_${randomBytes(24).toString('hex')}`;
    const rec: ApiKeyRecord = {
      id: randomUUID(),
      tenant_id: tenantId,
      name,
      key_prefix: raw.slice(0, 12),
      key_hash: hashKey(raw),
      raw_key_once: raw,
      created_at: nowIso(),
      revoked_at: null,
    };
    this.apiKeys.set(rec.id, rec);
    return rec;
  }

  monthUsage(tenantId: string): number {
    const prefix = nowIso().slice(0, 7);
    return this.usage
      .filter(u => u.tenant_id === tenantId && u.created_at.startsWith(prefix))
      .reduce((s, u) => s + u.units, 0);
  }

  recordUsage(tenantId: string, kind: UsageEvent['kind'], units = 1, meta?: Record<string, unknown>) {
    this.usage.push({
      id: randomUUID(),
      tenant_id: tenantId,
      kind,
      units,
      meta,
      created_at: nowIso(),
    });
  }

  assertWithinQuota(tenant: Tenant) {
    const used = this.monthUsage(tenant.id);
    if (used >= tenant.monthly_doc_limit) {
      throw new Error(`Monthly document limit exceeded (${used}/${tenant.monthly_doc_limit})`);
    }
  }
}

export const store = new Store();
export { hashKey, nowIso };
