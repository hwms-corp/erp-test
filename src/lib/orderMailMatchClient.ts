import { getAiDocConfig } from '@/lib/aiDocClient';
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
  if (matchRuntime?.apiBaseUrl && matchRuntime.apiKey) return { ...matchRuntime };
  // fallback: 분류 API와 동일 호스트를 임시로 쓸 수 있으나, 키/URL은 설정 분리 권장
  const fallback = getAiDocConfig();
  return {
    apiBaseUrl: matchRuntime?.apiBaseUrl || fallback.apiBaseUrl,
    apiKey: matchRuntime?.apiKey || fallback.apiKey,
  };
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
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 8000);
  try {
    const healthRes = await fetch(`${base}/health`, { signal: ctrl.signal });
    if (!healthRes.ok) return { ok: false, detail: `health ${healthRes.status}` };
    // 엔드포인트 존재 확인 (없으면 404 → 엔진 미배포로 안내)
    const probe = await fetch(`${base}/v1/order-mail-match`, {
      method: 'OPTIONS',
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${key}` },
    }).catch(() => null);
    if (probe && (probe.status === 401 || probe.status === 403)) {
      return { ok: false, detail: 'API Key 인증 실패' };
    }
    return { ok: true, detail: '매칭 엔진 호스트 응답 OK (엔드포인트는 배포 후 사용)' };
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
}): Promise<OrderMailMatchApiResult> {
  const cfg = {
    ...getOrderMailMatchConfig(),
    ...(input.config || {}),
  };
  const base = cfg.apiBaseUrl.replace(/\/$/, '');
  if (!base || !cfg.apiKey) {
    throw new Error('견적→메일 매칭 API URL/Key가 설정되지 않았습니다. AI 연동에서 Match API를 저장하세요.');
  }

  const res = await fetch(`${base}/v1/order-mail-match`, {
    method: 'POST',
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
