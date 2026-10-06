/**
 * Learning GT payloads for mail-ai-api Admin「기존데이터 학습」(B안)
 *
 * ERP가 matched 정답 + 메일 텍스트 + 첨부 files[](content_base64) 를 조립해 돌려준다.
 * mail-ai-api는 Gmail/첨부 URL을 몰라도 되고, 받은 payload로 기존 classify/extract만 돌린다.
 *
 * GET|POST /learning-gt-payloads
 * Auth: X-Internal-Key: <LEARNING_INTERNAL_KEY>
 *        또는 Authorization: Bearer <LEARNING_INTERNAL_KEY>
 *
 * Query/body:
 *   limit?: number (default 30, max 100)
 *   exclude_gt_ids?: string[]  — 이미 학습한 gt_id 스킵 (order:123|mail:456)
 *
 * Secrets: LEARNING_INTERNAL_KEY, SUPABASE_*, GMAIL_* (gmail-attachment/watch 과 동일)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const MAX_OCR_FILES = 5;
const MAX_OCR_BYTES = 8 * 1024 * 1024;
const MIN_CID_IMAGE_OCR_BYTES = 5 * 1024;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-internal-key',
};

function requireEnv(name: string): string {
  const v = Deno.env.get(name)?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

function authorize(req: Request): boolean {
  const expected = Deno.env.get('LEARNING_INTERNAL_KEY')?.trim();
  if (!expected) return false;
  const headerKey = req.headers.get('x-internal-key')?.trim();
  if (headerKey && headerKey === expected) return true;
  const auth = req.headers.get('authorization')?.trim() || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token === expected) return true;
  }
  return false;
}

function gmailUser(): string {
  return encodeURIComponent(Deno.env.get('GMAIL_USER')?.trim() || 'me');
}

function b64urlToStd(data: string): string {
  const pad = '='.repeat((4 - (data.length % 4)) % 4);
  return (data + pad).replace(/-/g, '+').replace(/_/g, '/');
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

function isOcrCandidate(filename: string, mime: string | null | undefined): boolean {
  const m = (mime || '').toLowerCase();
  const f = filename.toLowerCase();
  if (/\.(zip|exe|dll|bat|cmd|msi|js|vbs)$/i.test(f)) return false;
  return (
    m.includes('pdf') ||
    f.endsWith('.pdf') ||
    m.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|tiff?)$/i.test(f) ||
    /\.(docx|xlsx|xlsm|xls|doc|eml|txt|csv)$/i.test(f) ||
    m.includes('spreadsheet') ||
    m.includes('wordprocessingml') ||
    m.includes('msword') ||
    m.includes('officedocument')
  );
}

function ocrCandidatePriority(
  filename: string,
  mime: string | null | undefined,
  contentId?: string | null,
  sizeBytes?: number | null,
): number {
  const m = (mime || '').toLowerCase();
  const f = filename.toLowerCase();
  const isImage = m.startsWith('image/') || /\.(png|jpe?g|webp|gif|tiff?)$/i.test(f);
  if (contentId && isImage) {
    if (sizeBytes != null && sizeBytes < MIN_CID_IMAGE_OCR_BYTES) return -1;
    if (sizeBytes == null) return 35;
    return 40;
  }
  if (m.includes('pdf') || f.endsWith('.pdf')) return 100;
  if (/\.(xlsx|xlsm|xls)$/i.test(f) || m.includes('spreadsheet')) return 90;
  if (/\.(docx|doc)$/i.test(f) || m.includes('wordprocessing') || m.includes('msword')) return 80;
  if (/\.(csv|txt|eml)$/i.test(f) || m.startsWith('text/')) return 70;
  if (isImage) return 20;
  return 10;
}

type AttRow = {
  id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  gmail_attachment_id: string | null;
  content_id: string | null;
  mail_message_id: number;
};

async function loadAttachmentBase64(
  gmailMessageId: string,
  gmailAttId: string,
  accessToken: string,
): Promise<string | null> {
  const res = await fetch(
    `${GMAIL_API}/users/${gmailUser()}/messages/${gmailMessageId}/attachments/${gmailAttId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  if (!res.ok || !data.data) return null;
  return b64urlToStd(String(data.data));
}

async function collectFilesForMail(
  gmailMessageId: string,
  atts: AttRow[],
  accessToken: string,
): Promise<{
  files: { filename: string; mime_type?: string; content_base64: string }[];
  skipped: { attachment_id: number; filename: string; reason: string }[];
}> {
  const skipped: { attachment_id: number; filename: string; reason: string }[] = [];
  const ranked = [...atts]
    .map(att => ({
      att,
      priority: ocrCandidatePriority(
        att.filename,
        att.mime_type,
        att.content_id,
        att.size_bytes,
      ),
    }))
    .filter(x => {
      if (x.priority < 0) {
        skipped.push({
          attachment_id: x.att.id,
          filename: x.att.filename,
          reason: 'low_priority_cid_image',
        });
        return false;
      }
      if (!isOcrCandidate(x.att.filename, x.att.mime_type)) {
        skipped.push({
          attachment_id: x.att.id,
          filename: x.att.filename,
          reason: 'not_ocr_candidate',
        });
        return false;
      }
      if (!x.att.gmail_attachment_id) {
        skipped.push({
          attachment_id: x.att.id,
          filename: x.att.filename,
          reason: 'missing_gmail_attachment_id',
        });
        return false;
      }
      if (x.att.size_bytes != null && x.att.size_bytes > MAX_OCR_BYTES) {
        skipped.push({
          attachment_id: x.att.id,
          filename: x.att.filename,
          reason: 'too_large',
        });
        return false;
      }
      return true;
    })
    .sort((a, b) => b.priority - a.priority || a.att.filename.localeCompare(b.att.filename));

  const files: { filename: string; mime_type?: string; content_base64: string }[] = [];
  for (const { att } of ranked) {
    if (files.length >= MAX_OCR_FILES) {
      skipped.push({
        attachment_id: att.id,
        filename: att.filename,
        reason: 'max_files',
      });
      continue;
    }
    try {
      const b64 = await loadAttachmentBase64(
        gmailMessageId,
        att.gmail_attachment_id as string,
        accessToken,
      );
      if (!b64) {
        skipped.push({
          attachment_id: att.id,
          filename: att.filename,
          reason: 'gmail_fetch_empty',
        });
        continue;
      }
      const approx = Math.floor((b64.length * 3) / 4);
      if (approx > MAX_OCR_BYTES) {
        skipped.push({
          attachment_id: att.id,
          filename: att.filename,
          reason: 'decoded_too_large',
        });
        continue;
      }
      files.push({
        filename: att.filename,
        mime_type: att.mime_type ?? undefined,
        content_base64: b64,
      });
    } catch {
      skipped.push({
        attachment_id: att.id,
        filename: att.filename,
        reason: 'gmail_fetch_error',
      });
    }
  }
  return { files, skipped };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return json(405, { error: 'method not allowed' });
    }
    if (!authorize(req)) {
      return json(401, {
        error: 'unauthorized',
        detail: 'X-Internal-Key or Authorization Bearer must match LEARNING_INTERNAL_KEY',
      });
    }

    const url = new URL(req.url);
    let limit = Number(url.searchParams.get('limit') || '30');
    if (!Number.isFinite(limit) || limit <= 0) limit = 30;
    limit = Math.min(100, Math.floor(limit));

    let exclude = new Set<string>();
    const excludeQ = url.searchParams.get('exclude_gt_ids');
    if (excludeQ) {
      for (const part of excludeQ.split(',')) {
        const t = part.trim();
        if (t) exclude.add(t);
      }
    }
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (typeof body?.limit === 'number') {
          limit = Math.min(100, Math.max(1, Math.floor(body.limit)));
        }
        if (Array.isArray(body?.exclude_gt_ids)) {
          for (const id of body.exclude_gt_ids) {
            if (typeof id === 'string' && id.trim()) exclude.add(id.trim());
          }
        }
      } catch {
        /* empty body ok */
      }
    }

    const supabaseUrl = requireEnv('SUPABASE_URL');
    const service = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(supabaseUrl, service, { auth: { persistSession: false } });

    // pull more than limit then filter excludes
    const fetchN = Math.min(500, limit + exclude.size + 50);
    const { data: matches, error: mErr } = await admin
      .from('order_mail_learning_matches')
      .select('id, order_id, mail_message_id, score, matched_at, engine_version, match_reasons, evidence')
      .eq('status', 'matched')
      .not('mail_message_id', 'is', null)
      .order('matched_at', { ascending: false })
      .limit(fetchN);
    if (mErr) throw mErr;

    const selected = [];
    for (const row of matches || []) {
      const gtId = `order:${row.order_id}|mail:${row.mail_message_id}`;
      if (exclude.has(gtId)) continue;
      selected.push(row);
      if (selected.length >= limit) break;
    }

    if (selected.length === 0) {
      return json(200, {
        ok: true,
        schema_version: '1.0.0',
        mode: 'erp_assembles_files',
        sample_count: 0,
        samples: [],
        note: 'no matched samples (or all excluded)',
      });
    }

    const orderIds = [...new Set(selected.map(r => r.order_id as number))];
    const mailIds = [...new Set(selected.map(r => r.mail_message_id as number))];

    const { data: orders, error: oErr } = await admin
      .from('orders')
      .select('id, doc_no, order_date, partner_id, contact_person, vessel, created_at')
      .in('id', orderIds)
      .is('deleted_at', null);
    if (oErr) throw oErr;

    const partnerIds = [...new Set((orders || []).map(o => o.partner_id).filter(Boolean))];
    const { data: partners } = partnerIds.length
      ? await admin.from('partners').select('id, name, email').in('id', partnerIds)
      : { data: [] as { id: number; name: string; email: string | null }[] };

    const { data: items, error: iErr } = await admin
      .from('order_items')
      .select('order_id, seq, name, spec, qty, unit, remark')
      .in('order_id', orderIds)
      .is('deleted_at', null)
      .order('seq', { ascending: true });
    if (iErr) throw iErr;

    const { data: mails, error: mailErr } = await admin
      .from('mail_messages')
      .select(
        'id, subject, from_addr, to_addr, snippet, body_text, received_at, gmail_message_id, deleted_at',
      )
      .in('id', mailIds);
    if (mailErr) throw mailErr;

    const { data: atts, error: aErr } = await admin
      .from('mail_attachments')
      .select(
        'id, mail_message_id, filename, mime_type, size_bytes, gmail_attachment_id, content_id',
      )
      .in('mail_message_id', mailIds)
      .order('id', { ascending: true });
    if (aErr) throw aErr;

    const orderById = new Map((orders || []).map(o => [o.id as number, o]));
    const partnerById = new Map((partners || []).map(p => [p.id as number, p]));
    const itemsByOrder = new Map<number, typeof items>();
    for (const it of items || []) {
      const oid = it.order_id as number;
      const list = itemsByOrder.get(oid) || [];
      list.push(it);
      itemsByOrder.set(oid, list);
    }
    const mailById = new Map((mails || []).map(m => [m.id as number, m]));
    const attsByMail = new Map<number, AttRow[]>();
    for (const a of (atts || []) as AttRow[]) {
      const mid = a.mail_message_id;
      const list = attsByMail.get(mid) || [];
      list.push(a);
      attsByMail.set(mid, list);
    }

    let accessToken: string | null = null;
    const needsGmail = [...attsByMail.values()].some(list =>
      list.some(a => a.gmail_attachment_id),
    );
    if (needsGmail) {
      try {
        accessToken = await getAccessToken();
      } catch (e) {
        console.error('Gmail token failed', e);
      }
    }

    const samples = [];
    let filesTotal = 0;
    let filesSkipped = 0;

    for (const row of selected) {
      const order = orderById.get(row.order_id as number);
      const mail = mailById.get(row.mail_message_id as number);
      if (!order || !mail || mail.deleted_at) continue;

      const partner = partnerById.get(order.partner_id as number);
      const orderItems = itemsByOrder.get(order.id as number) || [];
      const mailAtts = attsByMail.get(mail.id as number) || [];

      let files: { filename: string; mime_type?: string; content_base64: string }[] = [];
      let skipped: { attachment_id: number; filename: string; reason: string }[] = [];

      if (mailAtts.length && accessToken && mail.gmail_message_id) {
        const packed = await collectFilesForMail(
          String(mail.gmail_message_id),
          mailAtts,
          accessToken,
        );
        files = packed.files;
        skipped = packed.skipped;
      } else if (mailAtts.length && !accessToken) {
        skipped = mailAtts.map(a => ({
          attachment_id: a.id,
          filename: a.filename,
          reason: 'gmail_token_unavailable',
        }));
      }

      filesTotal += files.length;
      filesSkipped += skipped.length;

      const text = [mail.subject, mail.from_addr, mail.body_text || mail.snippet]
        .filter(Boolean)
        .join('\n');

      samples.push({
        gt_id: `order:${order.id}|mail:${mail.id}`,
        matched_at: row.matched_at,
        match: {
          id: row.id,
          score: row.score,
          engine_version: row.engine_version,
        },
        mail: {
          id: mail.id,
          subject: mail.subject,
          from_addr: mail.from_addr,
          to_addr: mail.to_addr,
          snippet: mail.snippet,
          body_text: mail.body_text,
          received_at: mail.received_at,
        },
        text,
        files,
        files_skipped: skipped,
        gold: {
          document_type: 'quotation_request',
          customer: {
            name: partner?.name || '',
            contact_name: order.contact_person,
            email: partner?.email ?? null,
          },
          request: {
            document_no: order.doc_no,
            request_date: order.order_date,
            vessel: order.vessel,
            contact_person: order.contact_person,
          },
          items: orderItems.map(it => ({
            product_name: it.name,
            specification: it.spec,
            quantity: Number(it.qty),
            unit: it.unit,
            remark: it.remark,
            seq: it.seq,
          })),
        },
        order: {
          id: order.id,
          doc_no: order.doc_no,
          order_date: order.order_date,
          partner_id: order.partner_id,
          partner_name: partner?.name || '',
        },
      });
    }

    return json(200, {
      ok: true,
      schema_version: '1.0.0',
      mode: 'erp_assembles_files',
      sample_count: samples.length,
      files_attached_total: filesTotal,
      files_skipped_total: filesSkipped,
      samples,
      note:
        'mail-ai-api: run existing classify/extract on text+files; compare to gold.items; do not fetch Gmail yourself',
    });
  } catch (e) {
    console.error(e);
    return json(500, { error: String(e) });
  }
});
