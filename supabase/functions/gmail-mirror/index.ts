/**
 * ERP → Gmail 미러 (삭제/별표/라벨/완전삭제)
 *
 * POST /gmail-mirror
 * Body: { action, mail_ids: number[], add_label_ids?: string[], remove_label_ids?: string[] }
 * action: trash | untrash | star | unstar | delete_forever | modify_labels
 *
 * Auth: Bearer user JWT
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function requireEnv(name: string): string {
  const v = Deno.env.get(name)?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function gmailUser(): string {
  return encodeURIComponent(Deno.env.get('GMAIL_USER')?.trim() || 'me');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: requireEnv('GMAIL_CLIENT_ID'),
    client_secret: requireEnv('GMAIL_CLIENT_SECRET'),
    refresh_token: requireEnv('GMAIL_REFRESH_TOKEN'),
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

async function gmailModify(
  accessToken: string,
  gmailMessageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
) {
  const res = await fetch(
    `${GMAIL_API}/users/${gmailUser()}/messages/${encodeURIComponent(gmailMessageId)}/modify`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gmail modify ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function gmailTrash(accessToken: string, gmailMessageId: string) {
  const res = await fetch(
    `${GMAIL_API}/users/${gmailUser()}/messages/${encodeURIComponent(gmailMessageId)}/trash`,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gmail trash ${res.status}: ${t.slice(0, 200)}`);
  }
}

async function gmailUntrash(accessToken: string, gmailMessageId: string) {
  const res = await fetch(
    `${GMAIL_API}/users/${gmailUser()}/messages/${encodeURIComponent(gmailMessageId)}/untrash`,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gmail untrash ${res.status}: ${t.slice(0, 200)}`);
  }
}

async function gmailDeleteForever(accessToken: string, gmailMessageId: string) {
  const res = await fetch(
    `${GMAIL_API}/users/${gmailUser()}/messages/${encodeURIComponent(gmailMessageId)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } },
  );
  // 404 = 이미 없음 → 성공으로 간주
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(`gmail delete ${res.status}: ${t.slice(0, 200)}`);
  }
}

type Action =
  | 'trash'
  | 'untrash'
  | 'star'
  | 'unstar'
  | 'delete_forever'
  | 'modify_labels';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

    const supabaseUrl = requireEnv('SUPABASE_URL');
    const anon = requireEnv('SUPABASE_ANON_KEY');
    const service = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401);

    const body = (await req.json()) as {
      action?: Action;
      mail_ids?: number[];
      add_label_ids?: string[];
      remove_label_ids?: string[];
    };

    const action = body.action;
    const mailIds = [...new Set((body.mail_ids || []).filter(n => Number.isFinite(n) && n > 0))];
    if (!action || !mailIds.length) {
      return json({ error: 'action and mail_ids required' }, 400);
    }

    const sb = createClient(supabaseUrl, service, { auth: { persistSession: false } });
    const { data: rows, error: selErr } = await sb
      .from('mail_messages')
      .select('id, gmail_message_id, gmail_label_ids, is_starred, deleted_at')
      .in('id', mailIds);

    if (selErr) return json({ error: selErr.message }, 500);
    if (!rows?.length) return json({ error: 'mails not found' }, 404);

    const accessToken = await getAccessToken();
    const now = new Date().toISOString();
    const results: { id: number; ok: boolean; error?: string }[] = [];

    for (const row of rows) {
      const gid = row.gmail_message_id as string;
      try {
        if (action === 'trash') {
          await gmailTrash(accessToken, gid);
          await sb
            .from('mail_messages')
            .update({ deleted_at: now, updated_at: now })
            .eq('id', row.id);
        } else if (action === 'untrash') {
          await gmailUntrash(accessToken, gid);
          await sb
            .from('mail_messages')
            .update({ deleted_at: null, updated_at: now })
            .eq('id', row.id);
        } else if (action === 'star') {
          await gmailModify(accessToken, gid, ['STARRED'], []);
          await sb
            .from('mail_messages')
            .update({ is_starred: true, starred_at: now, updated_at: now })
            .eq('id', row.id);
        } else if (action === 'unstar') {
          await gmailModify(accessToken, gid, [], ['STARRED']);
          await sb
            .from('mail_messages')
            .update({ is_starred: false, starred_at: null, updated_at: now })
            .eq('id', row.id);
        } else if (action === 'delete_forever') {
          await gmailDeleteForever(accessToken, gid);
          await sb.from('mail_attachments').delete().eq('mail_message_id', row.id);
          await sb.from('mail_messages').delete().eq('id', row.id);
        } else if (action === 'modify_labels') {
          const add = body.add_label_ids || [];
          const remove = body.remove_label_ids || [];
          if (!add.length && !remove.length) {
            results.push({ id: row.id, ok: false, error: 'no labels' });
            continue;
          }
          const modified = await gmailModify(accessToken, gid, add, remove);
          const labels = (modified.labelIds || []) as string[];
          const isSentOnly = labels.includes('SENT') && !labels.includes('INBOX');
          await sb
            .from('mail_messages')
            .update({
              gmail_label_ids: labels,
              is_sent: isSentOnly,
              is_starred: labels.includes('STARRED'),
              updated_at: now,
            })
            .eq('id', row.id);
        } else {
          results.push({ id: row.id, ok: false, error: 'unknown action' });
          continue;
        }
        results.push({ id: row.id, ok: true });
      } catch (e) {
        results.push({ id: row.id, ok: false, error: String(e).slice(0, 200) });
      }
    }

    const okCount = results.filter(r => r.ok).length;
    return json({ ok: okCount === results.length, action, okCount, results });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
