import type { CanonicalExtraction } from '@/types/aiMail';

export type AiDocRuntimeConfig = {
  apiBaseUrl: string;
  apiKey: string;
};

const ENV_BASE = (import.meta.env.VITE_AI_DOC_API_URL || 'http://localhost:4040').replace(/\/$/, '');
const ENV_KEY = import.meta.env.VITE_AI_DOC_API_KEY || 'aidoc_demo_haewon_dev_key_change_me';

let runtime: AiDocRuntimeConfig = {
  apiBaseUrl: ENV_BASE,
  apiKey: ENV_KEY,
};

export function getAiDocConfig(): AiDocRuntimeConfig {
  return { ...runtime };
}

export function setAiDocConfig(partial: Partial<AiDocRuntimeConfig>) {
  if (partial.apiBaseUrl != null) {
    runtime.apiBaseUrl = partial.apiBaseUrl.trim().replace(/\/$/, '') || ENV_BASE;
  }
  if (partial.apiKey != null) {
    runtime.apiKey = partial.apiKey.trim() || ENV_KEY;
  }
}

export function resetAiDocConfigToEnv() {
  runtime = { apiBaseUrl: ENV_BASE, apiKey: ENV_KEY };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiBaseUrl, apiKey } = getAiDocConfig();
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `AI API error ${res.status}`);
  return json as T;
}

export type AiHealthStatus = 'checking' | 'online' | 'offline' | 'unauthorized' | 'unconfigured';

export async function checkAiDocHealth(opts?: {
  apiBaseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<{ status: AiHealthStatus; detail?: string; openai?: boolean }> {
  const base = (opts?.apiBaseUrl ?? getAiDocConfig().apiBaseUrl).replace(/\/$/, '');
  const key = opts?.apiKey ?? getAiDocConfig().apiKey;
  if (!base) return { status: 'unconfigured', detail: 'API URL 없음' };

  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 5000);
  try {
    const healthRes = await fetch(`${base}/health`, { signal: ctrl.signal });
    if (!healthRes.ok) {
      return { status: 'offline', detail: `health ${healthRes.status}` };
    }
    const health = await healthRes.json().catch(() => ({} as Record<string, unknown>));

    // 키 유효성: usage (인증 필요)
    const usageRes = await fetch(`${base}/v1/usage`, {
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${key}` },
    });
    if (usageRes.status === 401 || usageRes.status === 403) {
      return { status: 'unauthorized', detail: 'API Key 인증 실패', openai: !!health };
    }
    if (!usageRes.ok) {
      return { status: 'offline', detail: `usage ${usageRes.status}` };
    }
    return { status: 'online', detail: '연동 정상', openai: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort')) return { status: 'offline', detail: '응답 시간 초과' };
    return { status: 'offline', detail: msg.slice(0, 120) };
  } finally {
    window.clearTimeout(t);
  }
}

export interface AiJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: CanonicalExtraction;
  classify?: { document_type: string; confidence: number; language: string };
  error?: string;
}

export const aiDocClient = {
  classify: (text: string) =>
    request<{ data: { document_type: string; confidence: number; language: string } }>(
      '/v1/documents/classify',
      { method: 'POST', body: JSON.stringify({ text }) },
    ),

  extract: (text: string, files?: { filename: string; text?: string; mime_type?: string }[]) =>
    request<{ data: CanonicalExtraction }>('/v1/documents/extract', {
      method: 'POST',
      body: JSON.stringify({ text, files }),
    }),

  createJob: (payload: {
    text?: string;
    files?: { filename: string; text?: string; mime_type?: string; content_base64?: string }[];
    webhook_url?: string;
  }) =>
    request<{ job_id: string; status: string }>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getJob: (jobId: string) => request<{ data: AiJob }>(`/v1/jobs/${jobId}`),

  usage: () =>
    request<{
      used_documents: number;
      monthly_doc_limit: number;
      remaining: number;
      plan: string;
    }>('/v1/usage'),

  pollJob: async (jobId: string, opts?: { intervalMs?: number; timeoutMs?: number }) => {
    const interval = opts?.intervalMs ?? 300;
    const timeout = opts?.timeoutMs ?? 30000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const { data } = await aiDocClient.getJob(jobId);
      if (data.status === 'completed' || data.status === 'failed') return data;
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('AI job poll timeout');
  },
};
