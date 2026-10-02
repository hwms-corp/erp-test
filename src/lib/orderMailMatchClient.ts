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
  return {
    apiBaseUrl: (matchRuntime?.apiBaseUrl || '').trim().replace(/\/$/, ''),
    apiKey: (matchRuntime?.apiKey || '').trim(),
  };
}

export function isOrderMailMatchConfigured(): boolean {
  const c = getOrderMailMatchConfig();
  return Boolean(c.apiBaseUrl && c.apiKey);
}

export type OrderMailMatchApiCandidate = {
  mail_id: number;
  score: number;
  extracted_ref?: string | null;
  reasons?: string[];
  evidence?: unknown;
};

export type OrderMailMatchApiResult = {
  status: 'candidates' | 'matched' | 'unmatched';
  candidates: OrderMailMatchApiCandidate[];
  /** 구버전 단일 응답 호환 */
  mail_id?: number | null;
  score?: number | null;
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
        options: {
          mode: 'ref_text',
          exclude_prices: true,
          partner_ko_en_equivalent: true,
          no_attachments: true,
          no_date_window: true,
        },
      }),
    });

    if (probe.status === 401 || probe.status === 403) {
      return { ok: false, detail: 'API Key 인증 실패 (order-mail-match 키 확인)' };
    }
    if (probe.status === 404) {
      return { ok: false, detail: '/v1/order-mail-match 없음 — 엔진 미배포' };
    }
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
        mode: 'ref_text',
        exclude_prices: true,
        partner_ko_en_equivalent: true,
        no_attachments: true,
        no_date_window: true,
        return_candidates: true,
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

  const listRaw = (json as { candidates?: unknown }).candidates;
  const list: OrderMailMatchApiCandidate[] = [];
  if (Array.isArray(listRaw)) {
    for (const c of listRaw) {
      const row = c as Record<string, unknown>;
      const mailId = Number(row.mail_id);
      if (!Number.isFinite(mailId)) continue;
      list.push({
        mail_id: mailId,
        score: typeof row.score === 'number' ? row.score : 0,
        extracted_ref: (row.extracted_ref as string | null | undefined) ?? null,
        reasons: Array.isArray(row.reasons) ? (row.reasons as string[]) : [],
        evidence: row.evidence,
      });
    }
  }

  // 구버전 단일 matched 응답 → candidates로 정규화
  const legacyStatus = (json as { status?: string }).status;
  const legacyMailId = (json as { mail_id?: number | null }).mail_id;
  if (list.length === 0 && legacyStatus === 'matched' && legacyMailId != null) {
    list.push({
      mail_id: legacyMailId,
      score: typeof (json as { score?: number }).score === 'number' ? (json as { score: number }).score : 0.9,
      reasons: (json as { reasons?: string[] }).reasons || [],
      evidence: (json as { evidence?: unknown }).evidence,
    });
  }

  return {
    status: list.length > 0 ? 'candidates' : 'unmatched',
    candidates: list,
    mail_id: list[0]?.mail_id ?? null,
    score: list[0]?.score ?? null,
    reasons: list[0]?.reasons || [],
    evidence: (json as { evidence?: unknown }).evidence ?? {},
    engine_version: (json as { engine_version?: string }).engine_version ?? null,
  };
}
