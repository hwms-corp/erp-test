import type { MatchApiCandidatePayload, MatchApiOrderPayload } from '@/lib/orderMailMatch';

export type OrderMailMatchEngineConfig = {
  apiBaseUrl: string;
  apiKey: string;
};

let matchRuntime: OrderMailMatchEngineConfig | null = null;

export function setOrderMailMatchConfig(partial: Partial<OrderMailMatchEngineConfig>) {
  const cur = matchRuntime ?? { apiBaseUrl: '', apiKey: '' };
  matchRuntime = {
    apiBaseUrl: (partial.apiBaseUrl ?? cur.apiBaseUrl).trim().replace(/\/$/, ''),
    apiKey: (partial.apiKey ?? cur.apiKey).trim(),
  };
}

export function getOrderMailMatchConfig(): OrderMailMatchEngineConfig {
  // 분류(mail-ai-api) 키로 폴백하지 않음 — 학습샘플은 order-mail-match 전용 키만 사용
  return {
    apiBaseUrl: (matchRuntime?.apiBaseUrl || '').trim().replace(/\/$/, ''),
    apiKey: (matchRuntime?.apiKey || '').trim(),
  };
}

export function isOrderMailMatchConfigured(): boolean {
  const c = getOrderMailMatchConfig();
  return Boolean(c.apiBaseUrl && c.apiKey);
}

export type OrderMailMatchApiResult = {
  status: 'matched' | 'unmatched';
  mail_id: number | null;
  score: number | null;
  reasons?: string[];
  evidence?: unknown;
  engine_version?: string | null;
  error?: string;
};

export async function checkOrderMailMatchHealth(opts?: {
  apiBaseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; detail: string }> {
  const base = (opts?.apiBaseUrl ?? getOrderMailMatchConfig().apiBaseUrl).replace(/\/$/, '');
  const key = opts?.apiKey ?? getOrderMailMatchConfig().apiKey;
  if (!base) return { ok: false, detail: '매칭 API URL 없음' };
  if (!key) return { ok: false, detail: '매칭 API Key 없음' };
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 10000);
  try {
    const healthRes = await fetch(`${base}/health`, { signal: ctrl.signal });
    if (!healthRes.ok) return { ok: false, detail: `health ${healthRes.status}` };

    // 키 유효성: 최소 payload로 POST — 401/403이면 키 오류, 그 외(400/422/200)면 엔진·키 도달
    const probe = await fetch(`${base}/v1/order-mail-match`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        order: {
          id: 0,
          doc_no: '__health__',
          order_date: '1970-01-01',
          created_at: new Date().toISOString(),
          partner_name: '__health__',
          partner_name_hints: [],
          partner_email: null,
          contact_person: null,
          vessel: null,
          items: [],
        },
        candidates: [],
        options: { exclude_prices: true, partner_ko_en_equivalent: true, lookback_days: 15 },
      }),
    });

    if (probe.status === 401 || probe.status === 403) {
      return { ok: false, detail: 'API Key 인증 실패 (order-mail-match 키 확인)' };
    }
    if (probe.status === 404) {
      return { ok: false, detail: '/v1/order-mail-match 없음 — 엔진 미배포' };
    }
    // 200 matched/unmatched, 400 validation 등 → 호스트+키+엔드포인트 OK
    if (probe.status >= 500) {
      return { ok: false, detail: `서버 오류 ${probe.status}` };
    }
    return { ok: true, detail: `연동 OK (HTTP ${probe.status})` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : '연결 실패' };
  } finally {
    window.clearTimeout(t);
  }
}

export async function callOrderMailMatch(input: {
  order: MatchApiOrderPayload;
  candidates: MatchApiCandidatePayload[];
  config?: Partial<OrderMailMatchEngineConfig>;
  signal?: AbortSignal;
}): Promise<OrderMailMatchApiResult> {
  const cfg = {
    ...getOrderMailMatchConfig(),
    ...(input.config || {}),
  };
  const base = cfg.apiBaseUrl.replace(/\/$/, '');
  if (!base || !cfg.apiKey) {
    throw new Error(
      '학습샘플 매칭용 order-mail-match API URL/Key가 없습니다. AI 연동 → 「학습매칭 엔진」에 별도 키를 저장하세요. (메일 분류 키와 다름)',
    );
  }

  const res = await fetch(`${base}/v1/order-mail-match`, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      order: input.order,
      candidates: input.candidates,
      options: {
        exclude_prices: true,
        partner_ko_en_equivalent: true,
        lookback_days: 15,
      },
    }),
  });

  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    throw new Error(
      (json as { error?: string }).error ||
        `매칭 API 오류 ${res.status}${res.status === 404 ? ' — /v1/order-mail-match 엔진 미배포' : ''}`,
    );
  }

  const status = (json as { status?: string }).status === 'matched' ? 'matched' : 'unmatched';
  const mailId = (json as { mail_id?: number | null }).mail_id ?? null;
  return {
    status,
    mail_id: status === 'matched' ? mailId : null,
    score: typeof (json as { score?: number }).score === 'number' ? (json as { score: number }).score : null,
    reasons: (json as { reasons?: string[] }).reasons || [],
    evidence: (json as { evidence?: unknown }).evidence ?? {},
    engine_version: (json as { engine_version?: string }).engine_version ?? null,
  };
}
