/**
 * Gmail Watch + Pub/Sub push receiver (Supabase Edge Function)
 *
 * Endpoints:
 *   GET  /gmail-watch           → health
 *   POST /gmail-watch           → Pub/Sub push (new mail) + AI classify/extract (parallel per push)
 *   POST /gmail-watch?action=watch → register/renew Gmail users.watch
 *
 * Required secrets:
 *   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
 *   GMAIL_TOPIC_NAME          projects/.../topics/gmail-push
 *   GMAIL_USER                me  or  rfq@company.com
 *   AI_DOC_API_URL            public URL to ai-doc-api (not localhost)
 *   AI_DOC_API_KEY            Bearer key for ai-doc-api
 *   MAIL_AI_CONCURRENCY       optional, default 5 (max parallel mails per push)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

type PubSubPush = {
  message?: { data?: string; messageId?: string };
  subscription?: string;
};

type GmailHeader = { name: string; value: string };
type GmailPayload = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayload[];
  headers?: GmailHeader[];
};

type FieldVal<T = string | null> = { value?: T | null };
type CanonicalExtraction = {
  document_type: string;
  language: string;
  overall_confidence: number;
  customer: {
    name?: FieldVal;
    contact_name?: FieldVal;
    email?: FieldVal;
    tel?: FieldVal;
    biz_no?: FieldVal;
    addr?: FieldVal;
  };
  request: {
    document_no?: FieldVal;
    request_date?: FieldVal;
    delivery_date?: FieldVal;
    currency?: FieldVal;
    vessel?: FieldVal;
    contact_person?: FieldVal;
  };
  items: {
    product_name?: FieldVal;
    product_code?: FieldVal;
    specification?: FieldVal;
    quantity?: FieldVal<number | null>;
    unit?: FieldVal;
    requested_price?: FieldVal<number | null>;
    remark?: FieldVal;
  }[];
  remarks?: FieldVal;
};

type PartnerRow = {
  id: number;
  code: string;
  name: string;
  biz_no: string | null;
  email: string | null;
  type: string | null;
  deleted_at: string | null;
};

type MatchCandidate = {
  partner_id: number;
  partner_code: string;
  partner_name: string;
  score: number;
  reason: string;
};

const MATCH_SAVE_MIN = 0.3;
const MATCH_AUTO_MIN = 0.5;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

function matchPartners(extraction: CanonicalExtraction, partners: PartnerRow[], limit = 5): MatchCandidate[] {
  const name = extraction.customer?.name?.value?.trim() || '';
  const bizNo = (extraction.customer?.biz_no?.value || '').replace(/\D/g, '');
  const email = extraction.customer?.email?.value?.trim().toLowerCase() || '';
  const scored: MatchCandidate[] = [];

  for (const p of partners) {
    if (p.deleted_at) continue;
    if (p.type && p.type !== 'sales' && p.type !== 'both') continue;
    let score = 0;
    const reasons: string[] = [];

    if (bizNo && (p.biz_no || '').replace(/\D/g, '') === bizNo) {
      score += 0.6;
      reasons.push('biz_no exact');
    }
    if (email && p.email?.toLowerCase() === email) {
      score += 0.35;
      reasons.push('email exact');
    }
    if (name) {
      const pn = norm(p.name);
      const nn = norm(name);
      if (pn === nn) {
        score += 0.5;
        reasons.push('name exact');
      } else if (pn.includes(nn) || nn.includes(pn)) {
        score += 0.3;
        reasons.push('name partial');
      }
    }

    if (score > 0) {
      scored.push({
        partner_id: p.id,
        partner_code: p.code,
        partner_name: p.name,
        score: Math.min(1, score),
        reason: reasons.join(', '),
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function extractionLines(extraction: CanonicalExtraction) {
  return (extraction.items || [])
    .filter(it => it.product_name?.value)
    .map(it => ({
      name: String(it.product_name?.value || ''),
      spec: String(it.specification?.value || ''),
      qty: Number(it.quantity?.value ?? 1) || 1,
      unit: String(it.unit?.value || 'EA'),
      price: Number(it.requested_price?.value ?? 0) || 0,
      remark: String(it.remark?.value || extraction.remarks?.value || ''),
    }));
}

function todayYmd(): string {
  // Asia/Seoul date
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function getAutoRegisterCreatedBy(
  sb: ReturnType<typeof adminClient>,
  settingsUpdatedBy: number | null | undefined,
): Promise<number | null> {
  if (settingsUpdatedBy) return settingsUpdatedBy;
  const { data } = await sb
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .eq('active', true)
    .order('id')
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/** 추출 후: 거래처 매칭(항상) + 설정 ON이면 draft 자동등록 → registered */
async function matchAndMaybeAutoRegister(
  sb: ReturnType<typeof adminClient>,
  mailId: number,
  extraction: CanonicalExtraction,
  status: 'ready_auto' | 'review_required',
): Promise<string> {
  const { data: partners } = await sb
    .from('partners')
    .select('id, code, name, biz_no, email, type, deleted_at')
    .is('deleted_at', null);

  const candidates = matchPartners(extraction, (partners || []) as PartnerRow[]);
  const best = candidates[0];
  const patch: Record<string, unknown> = {
    extraction,
    process_status: status,
    error_message: null,
    status_reason: null as string | null,
  };

  if (best && best.score >= MATCH_SAVE_MIN) {
    patch.matched_partner_id = best.partner_id;
  }

  const { data: settings } = await sb
    .from('mail_ai_settings')
    .select('auto_register_draft, updated_by')
    .eq('id', 1)
    .maybeSingle();

  const autoOn = !!settings?.auto_register_draft;
  const docNo = (extraction.request?.document_no?.value || '').toString().trim();
  const lines = extractionLines(extraction);

  if (status === 'review_required') {
    patch.status_reason = '자동등록 조건 미충족 (신뢰도 또는 필수항목 부족) — 검토 필요';
  }

  if (!autoOn) {
    if (status === 'ready_auto') {
      patch.status_reason = '자동등록 꺼짐 — 자동후보만 저장됨';
    }
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return String(patch.process_status);
  }

  // autoOn
  if (status !== 'ready_auto') {
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return String(patch.process_status);
  }

  if (!best || best.score < MATCH_AUTO_MIN) {
    patch.status_reason = best
      ? `거래처 자동매칭 점수 부족 (${Math.round(best.score * 100)}% < ${Math.round(MATCH_AUTO_MIN * 100)}%)`
      : '거래처 자동매칭 실패 (유사 거래처 없음)';
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return String(patch.process_status);
  }

  if (!docNo) {
    patch.status_reason = '자동등록 실패 — 문서번호 없음';
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return String(patch.process_status);
  }

  if (lines.length === 0) {
    patch.status_reason = '자동등록 실패 — 추출된 품목 없음';
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return String(patch.process_status);
  }

  const { data: existingOrder } = await sb
    .from('orders')
    .select('id')
    .eq('ai_mail_message_id', mailId)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingOrder?.id) {
    patch.process_status = 'registered';
    patch.registered_order_id = existingOrder.id;
    patch.matched_partner_id = best.partner_id;
    patch.status_reason = null;
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return 'registered';
  }

  const createdBy = await getAutoRegisterCreatedBy(sb, settings?.updated_by);
  if (!createdBy) {
    patch.status_reason = '자동등록 실패 — 등록 사용자(created_by)를 찾을 수 없음';
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return String(patch.process_status);
  }

  const orderDate =
    (extraction.request?.request_date?.value || '').toString().trim() || todayYmd();
  const { data: order, error: orderErr } = await sb
    .from('orders')
    .insert({
      doc_no: docNo,
      order_date: orderDate,
      partner_id: best.partner_id,
      contact_person:
        extraction.request?.contact_person?.value
        ?? extraction.customer?.contact_name?.value
        ?? null,
      vessel: extraction.request?.vessel?.value ?? null,
      status: 'draft',
      source: 'ai_mail',
      ai_review_status: 'pending_review',
      ai_mail_message_id: mailId,
      created_by: createdBy,
    })
    .select('id')
    .single();

  if (orderErr || !order) {
    console.error('auto-register order failed', mailId, orderErr);
    const detail = (orderErr as { message?: string } | null)?.message || '알 수 없는 오류';
    patch.status_reason = `자동등록 실패 — 견적 draft 생성 오류 (${detail.slice(0, 120)})`;
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return String(patch.process_status);
  }

  const { error: itemErr } = await sb.from('order_items').insert(
    lines.map((item, i) => ({
      order_id: order.id,
      seq: i + 1,
      name: item.name,
      spec: item.spec || null,
      qty: item.qty,
      unit: item.unit,
      price: item.price,
      remark: item.remark || null,
    })),
  );

  if (itemErr) {
    console.error('auto-register items failed', mailId, itemErr);
    await sb.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', order.id);
    const detail = (itemErr as { message?: string } | null)?.message || '알 수 없는 오류';
    patch.status_reason = `자동등록 실패 — 품목 저장 오류, draft 롤백됨 (${detail.slice(0, 120)})`;
    await sb.from('mail_messages').update(patch).eq('id', mailId);
    return String(patch.process_status);
  }

  patch.process_status = 'registered';
  patch.registered_order_id = order.id;
  patch.matched_partner_id = best.partner_id;
  patch.status_reason = null;
  console.log(`AI mail ${mailId} auto-registered order ${order.id}`);
  await sb.from('mail_messages').update(patch).eq('id', mailId);
  return 'registered';
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name)?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function b64urlDecode(data: string): string {
  const pad = '='.repeat((4 - (data.length % 4)) % 4);
  const b64 = (data + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const h = headers?.find(x => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function collectText(payload: GmailPayload | undefined): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;

  const walk = (p?: GmailPayload) => {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    if (p.body?.data) {
      const decoded = b64urlDecode(p.body.data);
      if (mt === 'text/plain' && !text) text = decoded;
      if (mt === 'text/html' && !html) html = decoded;
    }
    for (const part of p.parts || []) walk(part);
  };
  walk(payload);

  if (!text && html) {
    text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return { text, html };
}

/** 답장/전달에 붙은 이전 메일 인용 제거 — 이번 수신분만 유지 */
function stripQuotedReplyText(text: string | null | undefined): string {
  if (!text) return '';
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const headerRe = [
    /^On .+ wrote:\s*$/i,
    /^.*님이 작성한 내용:\s*$/,
    /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일.+(작성|씀)\s*:\s*$/,
    /^-----Original Message-----/i,
    /^---------- Forwarded message ---------/i,
    /^Begin forwarded message:\s*$/i,
    /^________________________________\s*$/,
    /^From:\s.+/i,
    /^보낸 사람\s*:\s*.+$/,
  ];

  let cutAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (i === 0 && /^From:\s/i.test(t)) continue;
    if (headerRe.some(p => p.test(t))) {
      cutAt = i;
      break;
    }
  }

  if (cutAt < 0) {
    let seenContent = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t && !t.startsWith('>')) seenContent = true;
      if (seenContent && t.startsWith('>') && i > 0 && !lines[i - 1].trim()) {
        cutAt = i - 1;
        break;
      }
    }
  }

  const kept = cutAt >= 0 ? lines.slice(0, cutAt) : lines;
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripQuotedReplyHtml(html: string | null | undefined): string {
  if (!html) return '';
  let out = html;
  out = out.replace(/<div[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>[\s\S]*$/i, '');
  out = out.replace(/<div[^>]*class="[^"]*gmail_extra[^"]*"[^>]*>[\s\S]*$/i, '');
  out = out.replace(/<div[^>]*class="[^"]*gmail_attr[^"]*"[^>]*>[\s\S]*$/i, '');
  return out.trim();
}

/** INBOX만 동기화 — SENT/DRAFT/SPAM/TRASH 제외 */
function isInboxMessage(labelIds: string[] | undefined): boolean {
  const labels = labelIds || [];
  if (!labels.includes('INBOX')) return false;
  if (labels.includes('DRAFT') || labels.includes('SPAM') || labels.includes('TRASH')) return false;
  // SENT만 있고 INBOX가 없는 경우는 위에서 걸러짐. INBOX+SENT 동시(드묾)는 수신으로 허용.
  return true;
}

function collectAttachmentMeta(payload: GmailPayload | undefined) {
  const out: {
    filename: string;
    mime_type: string | null;
    size_bytes: number | null;
    attachment_id: string | null;
    data_b64url: string | null;
    content_id: string | null;
  }[] = [];
  const walk = (p?: GmailPayload) => {
    if (!p) return;
    const cidRaw = headerValue(p.headers, 'Content-ID');
    const contentId = cidRaw ? cidRaw.replace(/^<|>$/g, '').trim() : null;
    const hasFile = !!(p.filename && p.filename.trim());
    const hasInline = !!(contentId && (p.body?.attachmentId || p.body?.data));
    if (hasFile || hasInline) {
      out.push({
        filename: hasFile ? p.filename! : `inline-${contentId}`,
        mime_type: p.mimeType ?? null,
        size_bytes: p.body?.size ?? null,
        attachment_id: p.body?.attachmentId ?? null,
        data_b64url: p.body?.data ?? null,
        content_id: contentId,
      });
    }
    for (const part of p.parts || []) walk(part);
  };
  walk(payload);
  return out;
}

function isOcrCandidate(filename: string, mime: string | null): boolean {
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

function b64urlToStd(data: string): string {
  const pad = '='.repeat((4 - (data.length % 4)) % 4);
  return (data + pad).replace(/-/g, '+').replace(/_/g, '/');
}

async function loadAttachmentBase64(
  messageId: string,
  att: {
    attachment_id: string | null;
    data_b64url: string | null;
  },
  accessToken: string,
): Promise<string | null> {
  if (att.data_b64url) return b64urlToStd(att.data_b64url);
  if (!att.attachment_id) return null;
  const data = await gmailGet(
    `/users/${gmailUser()}/messages/${messageId}/attachments/${att.attachment_id}`,
    accessToken,
  );
  if (!data?.data) return null;
  return b64urlToStd(String(data.data));
}

const MAX_OCR_FILES = 5;
const MAX_OCR_BYTES = 8 * 1024 * 1024;

async function collectOcrFiles(
  messageId: string,
  attachments: ReturnType<typeof collectAttachmentMeta>,
  accessToken: string,
): Promise<{ filename: string; mime_type?: string; content_base64: string }[]> {
  const files: { filename: string; mime_type?: string; content_base64: string }[] = [];
  for (const att of attachments) {
    if (files.length >= MAX_OCR_FILES) break;
    if (!isOcrCandidate(att.filename, att.mime_type)) continue;
    if (att.size_bytes != null && att.size_bytes > MAX_OCR_BYTES) continue;
    try {
      const b64 = await loadAttachmentBase64(messageId, att, accessToken);
      if (!b64) continue;
      const approx = Math.floor((b64.length * 3) / 4);
      if (approx > MAX_OCR_BYTES) continue;
      files.push({
        filename: att.filename,
        mime_type: att.mime_type ?? undefined,
        content_base64: b64,
      });
    } catch (e) {
      console.error('attachment download failed', att.filename, e);
    }
  }
  return files;
}

async function getAccessToken(): Promise<string> {
  const clientId = requireEnv('GMAIL_CLIENT_ID');
  const clientSecret = requireEnv('GMAIL_CLIENT_SECRET');
  const refreshToken = requireEnv('GMAIL_REFRESH_TOKEN');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
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

function gmailUser(): string {
  return encodeURIComponent(Deno.env.get('GMAIL_USER')?.trim() || 'me');
}

async function gmailGet(path: string, accessToken: string) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail GET ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function gmailPost(path: string, accessToken: string, body: unknown) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail POST ${path}: ${JSON.stringify(data)}`);
  return data;
}

function adminClient() {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function decideProcessStatus(extraction: CanonicalExtraction): 'ready_auto' | 'review_required' {
  const conf = extraction.overall_confidence;
  const hasCustomer = !!extraction.customer?.name?.value;
  const hasItems = (extraction.items || []).some(
    i => i.product_name?.value && i.quantity?.value != null,
  );
  const hasDocNo = !!extraction.request?.document_no?.value?.toString().trim();
  if (conf >= 0.95 && hasCustomer && hasItems && hasDocNo) return 'ready_auto';
  return 'review_required';
}

function aiApiConfigured(): boolean {
  return !!(Deno.env.get('AI_DOC_API_URL')?.trim() && Deno.env.get('AI_DOC_API_KEY')?.trim());
}

async function aiDocRequest<T>(path: string, body: unknown): Promise<T> {
  const base = requireEnv('AI_DOC_API_URL').replace(/\/$/, '');
  const key = requireEnv('AI_DOC_API_KEY');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const jsonBody = await res.json();
  if (!res.ok) throw new Error(jsonBody.error || `AI API ${path} ${res.status}`);
  return jsonBody as T;
}

/** Classify + extract; updates mail_messages. Skips if AI secrets missing. */
async function runAiForMail(
  sb: ReturnType<typeof adminClient>,
  mailId: number,
  text: string,
  files?: { filename: string; mime_type?: string; content_base64: string }[],
): Promise<{ status: string; skipped?: boolean; error?: string }> {
  if (!aiApiConfigured()) {
    console.log('AI skipped: AI_DOC_API_URL/KEY not set');
    return { status: 'received', skipped: true };
  }
  const hasFiles = (files?.length ?? 0) > 0;
  if (!text.trim() && !hasFiles) {
    await sb
      .from('mail_messages')
      .update({ process_status: 'failed', error_message: 'empty body' })
      .eq('id', mailId);
    return { status: 'failed', error: 'empty body' };
  }

  await sb.from('mail_messages').update({ process_status: 'classifying' }).eq('id', mailId);

  try {
    const payload = { text, files: files?.length ? files : undefined };
    const cls = await aiDocRequest<{
      data: { document_type: string; confidence: number; language: string };
    }>('/v1/documents/classify', payload);

    const isRfq = cls.data.document_type === 'quotation_request';
    await sb
      .from('mail_messages')
      .update({
        is_rfq: isRfq,
        classify_confidence: cls.data.confidence,
        process_status: isRfq ? 'extracting' : 'rejected',
      })
      .eq('id', mailId);

    if (!isRfq) return { status: 'rejected' };

    const extracted = await aiDocRequest<{ data: CanonicalExtraction }>(
      '/v1/documents/extract',
      payload,
    );
    const status = decideProcessStatus(extracted.data);
    const finalStatus = await matchAndMaybeAutoRegister(sb, mailId, extracted.data, status);

    console.log(`AI mail ${mailId} → ${finalStatus} (files=${files?.length ?? 0})`);
    return { status: finalStatus };
  } catch (e) {
    const msg = String(e);
    console.error('AI pipeline failed', mailId, msg);
    await sb
      .from('mail_messages')
      .update({ process_status: 'failed', error_message: msg.slice(0, 500) })
      .eq('id', mailId);
    return { status: 'failed', error: msg };
  }
}

async function registerWatch(accessToken: string) {
  const topicName = requireEnv('GMAIL_TOPIC_NAME');
  const mailbox = Deno.env.get('GMAIL_USER')?.trim() || 'me';
  const sb = adminClient();

  const watch = await gmailPost(`/users/${gmailUser()}/watch`, accessToken, {
    topicName,
    labelIds: ['INBOX'],
  });

  const historyId = String(watch.historyId ?? '');
  const expirationMs = watch.expiration ? Number(watch.expiration) : null;
  const watchExpiration = expirationMs ? new Date(expirationMs).toISOString() : null;

  // Preserve last_history_id if we already have one — only update expiration/topic
  const { data: prev } = await sb
    .from('gmail_sync_state')
    .select('last_history_id')
    .eq('mailbox', mailbox)
    .maybeSingle();

  await sb.from('gmail_sync_state').upsert(
    {
      mailbox,
      last_history_id: prev?.last_history_id || historyId || null,
      watch_expiration: watchExpiration,
      topic_name: topicName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'mailbox' },
  );

  return {
    historyId: prev?.last_history_id || historyId,
    watchHistoryId: historyId,
    expiration: watchExpiration,
    topicName,
  };
}

/** Renew if missing expiration or within `withinHours` of expiry (default 48h). */
async function maybeRenewWatch(accessToken: string, withinHours = 48) {
  const mailbox = Deno.env.get('GMAIL_USER')?.trim() || 'me';
  const sb = adminClient();
  const { data: state } = await sb
    .from('gmail_sync_state')
    .select('watch_expiration')
    .eq('mailbox', mailbox)
    .maybeSingle();

  const exp = state?.watch_expiration ? new Date(state.watch_expiration).getTime() : 0;
  const dueAt = Date.now() + withinHours * 60 * 60 * 1000;
  if (exp && exp > dueAt) {
    return { renewed: false, expiration: state?.watch_expiration ?? null };
  }
  const watch = await registerWatch(accessToken);
  return { renewed: true, ...watch };
}

async function syncFromHistory(accessToken: string, incomingHistoryId?: string) {
  const mailbox = Deno.env.get('GMAIL_USER')?.trim() || 'me';
  const sb = adminClient();

  const { data: state } = await sb
    .from('gmail_sync_state')
    .select('*')
    .eq('mailbox', mailbox)
    .maybeSingle();

  const startHistoryId = state?.last_history_id as string | null | undefined;

  // First push / empty state: seed with incoming historyId (no backlog fetch)
  if (!startHistoryId) {
    if (incomingHistoryId) {
      await sb.from('gmail_sync_state').upsert(
        {
          mailbox,
          last_history_id: incomingHistoryId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'mailbox' },
      );
    }
    return { synced: 0, ai: [], seeded: true, historyId: incomingHistoryId ?? null };
  }

  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let newestHistoryId = startHistoryId;

  do {
    const qs = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
    });
    if (pageToken) qs.set('pageToken', pageToken);

    let hist: {
      history?: { messagesAdded?: { message?: { id?: string } }[]; id?: string }[];
      historyId?: string;
      nextPageToken?: string;
    };
    try {
      hist = await gmailGet(`/users/${gmailUser()}/history?${qs}`, accessToken);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('404') || msg.includes('historyId')) {
        if (incomingHistoryId) {
          await sb.from('gmail_sync_state').upsert(
            {
              mailbox,
              last_history_id: incomingHistoryId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'mailbox' },
          );
        }
        return { synced: 0, ai: [], reseeding: true, error: msg };
      }
      throw e;
    }

    for (const h of hist.history || []) {
      if (h.id) newestHistoryId = h.id;
      for (const m of h.messagesAdded || []) {
        if (m.message?.id) messageIds.add(m.message.id);
      }
    }
    if (hist.historyId) newestHistoryId = String(hist.historyId);
    pageToken = hist.nextPageToken;
  } while (pageToken);

  const MAIL_CONCURRENCY = Math.max(1, Math.min(10, Number(Deno.env.get('MAIL_AI_CONCURRENCY') || 5)));

  /** 동시성 제한 병렬 실행 — 같은 push 안 여러 메일 AI를 동시에 돌림 */
  async function mapPool<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await worker(items[i], i);
      }
    });
    await Promise.all(runners);
    return results;
  }

  const messageIdList = [...messageIds];
  const outcomes = await mapPool(messageIdList, MAIL_CONCURRENCY, async (id) => {
    try {
      const msg = await gmailGet(
        `/users/${gmailUser()}/messages/${id}?format=full`,
        accessToken,
      );

      const labels = (msg.labelIds || []) as string[];
      if (!isInboxMessage(labels)) {
        console.log('skip non-inbox message', msg.id, labels.join(','));
        return { synced: 0 as const, ai: null as { mailId: number; status: string } | null };
      }

      const headers = (msg.payload?.headers || []) as GmailHeader[];
      const collected = collectText(msg.payload as GmailPayload);
      const textRaw = collected.text;
      const htmlRaw = collected.html;
      // DB에는 HTML 원문 최대한 보존 (인용 제거는 화면에서)
      const text = stripQuotedReplyText(textRaw) || null;
      const html = htmlRaw || null;
      const attachments = collectAttachmentMeta(msg.payload as GmailPayload);
      const internalDate = msg.internalDate
        ? new Date(Number(msg.internalDate)).toISOString()
        : new Date().toISOString();

      const { data: existing } = await sb
        .from('mail_messages')
        .select('id, process_status')
        .eq('gmail_message_id', msg.id)
        .maybeSingle();

      if (
        existing &&
        existing.process_status &&
        !['received', 'failed', 'classifying', 'extracting'].includes(existing.process_status)
      ) {
        console.log('skip already processed', msg.id, existing.process_status);
        return { synced: 0 as const, ai: null as { mailId: number; status: string } | null };
      }

      // 신규는 insert(Realtime INSERT→토스트), 기존은 update(UPDATE만)
      const mailPayload = {
        gmail_message_id: msg.id,
        gmail_thread_id: msg.threadId ?? null,
        history_id: newestHistoryId,
        subject: headerValue(headers, 'Subject'),
        from_addr: headerValue(headers, 'From'),
        to_addr: headerValue(headers, 'To'),
        received_at: internalDate,
        snippet: msg.snippet ?? null,
        body_text: text,
        body_html: html,
        process_status: existing?.process_status === 'failed' ? 'received' : (existing?.process_status || 'received'),
      };

      const { data: row, error } = existing
        ? await sb
            .from('mail_messages')
            .update(mailPayload)
            .eq('id', existing.id)
            .select('id, process_status')
            .single()
        : await sb
            .from('mail_messages')
            .insert(mailPayload)
            .select('id, process_status')
            .single();

      if (error || !row) {
        console.error('save mail failed', msg.id, error);
        return { synced: 0 as const, ai: null };
      }

      if (attachments.length) {
        await sb.from('mail_attachments').delete().eq('mail_message_id', row.id);
        await sb.from('mail_attachments').insert(
          attachments.map(a => ({
            mail_message_id: row.id,
            filename: a.filename,
            mime_type: a.mime_type,
            size_bytes: a.size_bytes,
            gmail_attachment_id: a.attachment_id,
            content_id: a.content_id,
          })),
        );
      }

      const subjectLine = headerValue(headers, 'Subject');
      const bodyForAi = [
        subjectLine ? `[제목]\n${subjectLine}` : '',
        text ? `[본문]\n${text}` : '',
        !text && msg.snippet ? `[스니펫]\n${msg.snippet}` : '',
      ].filter(Boolean).join('\n\n');
      const ocrFiles = await collectOcrFiles(String(msg.id), attachments, accessToken);
      const ai = await runAiForMail(sb, row.id, bodyForAi, ocrFiles);
      return {
        synced: 1 as const,
        ai: { mailId: row.id, status: ai.status },
      };
    } catch (e) {
      console.error('parallel mail process failed', id, e);
      return { synced: 0 as const, ai: null };
    }
  });

  const synced = outcomes.reduce((n, o) => n + o.synced, 0);
  const aiResults = outcomes
    .map(o => o.ai)
    .filter((x): x is { mailId: number; status: string } => !!x);

  console.log(`push parallel done: synced=${synced} concurrency=${MAIL_CONCURRENCY} total=${messageIdList.length}`);

  await sb.from('gmail_sync_state').upsert(
    {
      mailbox,
      last_history_id: incomingHistoryId || newestHistoryId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'mailbox' },
  );

  return {
    synced,
    ai: aiResults,
    historyId: incomingHistoryId || newestHistoryId,
    concurrency: MAIL_CONCURRENCY,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'GET') {
      return json({
        ok: true,
        service: 'gmail-watch',
        ai_configured: aiApiConfigured(),
      });
    }

    if (req.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const accessToken = await getAccessToken();

    // Force renew (cron / manual)
    if (action === 'watch' || action === 'renew') {
      const result = await registerWatch(accessToken);
      return json({ ok: true, watch: result });
    }

    // Renew only if expiring soon
    if (action === 'renew-if-needed') {
      const result = await maybeRenewWatch(accessToken, 48);
      return json({ ok: true, ...result });
    }

    const body = (await req.json()) as PubSubPush;
    const dataB64 = body?.message?.data;
    const decoded = dataB64
      ? JSON.parse(atob(dataB64)) as { emailAddress?: string; historyId?: string }
      : (body as { emailAddress?: string; historyId?: string });

    const historyId = decoded?.historyId ? String(decoded.historyId) : undefined;
    const result = await syncFromHistory(accessToken, historyId);

    // Keep watch alive while mail traffic exists
    let renew: Awaited<ReturnType<typeof maybeRenewWatch>> | null = null;
    try {
      renew = await maybeRenewWatch(accessToken, 48);
    } catch (e) {
      console.error('watch renew skipped', e);
    }

    return json({
      ok: true,
      emailAddress: decoded?.emailAddress ?? null,
      historyId: historyId ?? null,
      result,
      watch: renew,
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
