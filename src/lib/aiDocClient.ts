import type { CanonicalExtraction } from '@/types/aiMail';

const API_BASE = import.meta.env.VITE_AI_DOC_API_URL || 'http://localhost:4040';
const API_KEY = import.meta.env.VITE_AI_DOC_API_KEY || 'aidoc_demo_haewon_dev_key_change_me';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
      ...(init?.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `AI API error ${res.status}`);
  return json as T;
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
