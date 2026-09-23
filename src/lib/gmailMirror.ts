import { supabase } from '@/lib/supabase';

const supabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export type GmailMirrorAction =
  | 'trash'
  | 'untrash'
  | 'star'
  | 'unstar'
  | 'delete_forever'
  | 'modify_labels';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return {
    authorization: `Bearer ${token}`,
    apikey: supabaseAnonKey,
    'content-type': 'application/json',
  };
}

/** ERP 동작을 Gmail에 미러 (Edge Function gmail-mirror) */
export async function mirrorToGmail(opts: {
  action: GmailMirrorAction;
  mailIds: number[];
  addLabelIds?: string[];
  removeLabelIds?: string[];
}): Promise<{ ok: boolean; okCount: number; error?: string }> {
  if (!supabaseUrl) throw new Error('Supabase URL 없음');
  const unique = [...new Set(opts.mailIds.filter(id => Number.isFinite(id) && id > 0))];
  if (!unique.length) return { ok: true, okCount: 0 };

  const headers = await authHeader();
  const res = await fetch(`${supabaseUrl}/functions/v1/gmail-mirror`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: opts.action,
      mail_ids: unique,
      add_label_ids: opts.addLabelIds,
      remove_label_ids: opts.removeLabelIds,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, okCount: 0, error: (json as { error?: string }).error || `mirror ${res.status}` };
  }
  return {
    ok: !!(json as { ok?: boolean }).ok,
    okCount: Number((json as { okCount?: number }).okCount || 0),
    error: (json as { error?: string }).error,
  };
}
