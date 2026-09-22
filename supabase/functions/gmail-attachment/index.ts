/**
 * Gmail attachment on-demand proxy (no Supabase Storage)
 *
 * GET /gmail-attachment?id=<mail_attachments.id>
 *   → streams file bytes from Gmail API
 *
 * Auth: Authorization Bearer <user JWT>
 * Secrets: same Gmail OAuth as gmail-watch
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

function b64urlToBytes(data: string): Uint8Array {
  const pad = '='.repeat((4 - (data.length % 4)) % 4);
  const b64 = (data + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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

function dispositionFilename(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const supabaseUrl = requireEnv('SUPABASE_URL');
    const anon = requireEnv('SUPABASE_ANON_KEY');
    const service = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const id = Number(new URL(req.url).searchParams.get('id') || '');
    if (!id) {
      return new Response(JSON.stringify({ error: 'id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, service, { auth: { persistSession: false } });
    const { data: att, error: attErr } = await admin
      .from('mail_attachments')
      .select('id, filename, mime_type, gmail_attachment_id, mail_message_id, mail_messages!inner(gmail_message_id, deleted_at)')
      .eq('id', id)
      .maybeSingle();

    if (attErr || !att) {
      return new Response(JSON.stringify({ error: 'attachment not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const mail = att.mail_messages as unknown as { gmail_message_id: string; deleted_at: string | null };
    if (mail?.deleted_at) {
      return new Response(JSON.stringify({ error: 'mail deleted' }), {
        status: 404,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const gmailAttId = att.gmail_attachment_id as string | null;
    if (!gmailAttId) {
      return new Response(
        JSON.stringify({
          error: 'gmail_attachment_id missing — 이 메일은 재수신/재동기화 후 미리보기가 가능합니다',
        }),
        { status: 409, headers: { ...corsHeaders, 'content-type': 'application/json' } },
      );
    }

    const accessToken = await getAccessToken();
    const gmailMsgId = mail.gmail_message_id;
    const attRes = await fetch(
      `${GMAIL_API}/users/${gmailUser()}/messages/${gmailMsgId}/attachments/${gmailAttId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const attJson = await attRes.json();
    if (!attRes.ok || !attJson.data) {
      return new Response(JSON.stringify({ error: 'gmail fetch failed', detail: attJson }), {
        status: 502,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const bytes = b64urlToBytes(String(attJson.data));
    const mime = (att.mime_type as string) || 'application/octet-stream';
    const filename = (att.filename as string) || 'attachment';

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'content-type': mime,
        'content-disposition': dispositionFilename(filename),
        'cache-control': 'private, max-age=60',
      },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
