/**
 * 견적서(orders) ↔ 원본 메일 1:1 고정밀 매칭
 * - 금액/단가(price)는 견적 후입력 값이므로 매칭 제외
 * - 제목·본문·스니펫·AI추출·첨부파일명 텍스트를 코퍼스로 사용
 */

import type { MailAttachment, MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';

export type MatchFieldKey =
  | 'doc_no'
  | 'partner_name'
  | 'partner_email'
  | 'contact_person'
  | 'vessel'
  | 'item_name'
  | 'item_spec'
  | 'item_qty'
  | 'item_unit'
  | 'linked_id';

export interface FieldMatchEvidence {
  key: MatchFieldKey;
  label: string;
  orderValue: string;
  matched: boolean;
  /** 메일에서 찾은 근거 조각 */
  mailEvidence: string | null;
  weight: number;
}

export interface OrderMailScore {
  orderId: number;
  mailId: number;
  score: number;
  requiredOk: boolean;
  evidences: FieldMatchEvidence[];
}

export interface OrderMailMatchRow {
  order: OrderWithPartner;
  items: OrderItem[];
  partnerEmail: string | null;
  status: 'matched' | 'unmatched';
  mail: MailMessage | null;
  score: number | null;
  evidences: FieldMatchEvidence[];
  matchMethod: 'ai_link' | 'registered_link' | 'content' | null;
}

export interface MailCorpus {
  mail: MailMessage;
  /** 검색용 정규화 텍스트 */
  normText: string;
  /** 원문(대소문자 유지) — evidence 추출용 */
  rawText: string;
  attachmentNames: string[];
}

const MATCH_THRESHOLD = 0.92;

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeMatchText(s: string): string {
  return collapseWs(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._\-+/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractionPlain(mail: MailMessage): string {
  const ex = mail.extraction;
  if (!ex) return '';
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (v == null || v === '') return;
    parts.push(String(v));
  };
  push(ex.customer?.name?.value);
  push(ex.customer?.contact_name?.value);
  push(ex.customer?.email?.value);
  push(ex.customer?.biz_no?.value);
  push(ex.request?.document_no?.value);
  push(ex.request?.vessel?.value);
  push(ex.request?.contact_person?.value);
  push(ex.request?.request_date?.value);
  for (const it of ex.items || []) {
    push(it.product_name?.value);
    push(it.specification?.value);
    push(it.quantity?.value);
    push(it.unit?.value);
    push(it.remark?.value);
  }
  push(ex.remarks?.value);
  return parts.join('\n');
}

export function buildMailCorpus(
  mail: MailMessage,
  attachments: Pick<MailAttachment, 'filename'>[] = [],
): MailCorpus {
  const names = attachments.map(a => a.filename || '').filter(Boolean);
  const raw = [
    mail.subject || '',
    mail.from_addr || '',
    mail.to_addr || '',
    mail.snippet || '',
    mail.body_text || '',
    extractionPlain(mail),
    names.join('\n'),
  ].join('\n');
  return {
    mail,
    rawText: raw,
    normText: normalizeMatchText(raw),
    attachmentNames: names,
  };
}

/** 원문에서 needle에 해당하는 짧은 evidence 클립 */
export function findEvidenceClip(rawText: string, needle: string, radius = 42): string | null {
  const n = needle.trim();
  if (!n || n.length < 2) return null;
  const lower = rawText.toLowerCase();
  const idx = lower.indexOf(n.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(rawText.length, idx + n.length + radius);
  let clip = rawText.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) clip = '…' + clip;
  if (end < rawText.length) clip = clip + '…';
  return clip;
}

function tokenPresent(normCorpus: string, value: string): boolean {
  const n = normalizeMatchText(value);
  if (!n || n.length < 2) return false;
  // 짧은 토큰은 단어 경계 유사 체크
  if (n.length <= 3) {
    return new RegExp(`(?:^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(normCorpus);
  }
  return normCorpus.includes(n);
}

function qtyPresent(normCorpus: string, qty: number): boolean {
  if (!Number.isFinite(qty)) return false;
  const variants = new Set<string>([
    String(qty),
    String(Math.trunc(qty)),
    qty.toLocaleString('en-US'),
    normalizeMatchText(String(qty)),
  ]);
  for (const v of variants) {
    if (v && tokenPresent(normCorpus, v)) return true;
  }
  return false;
}

export function scoreOrderAgainstMail(input: {
  order: OrderWithPartner;
  items: OrderItem[];
  partnerEmail: string | null;
  corpus: MailCorpus;
}): OrderMailScore {
  const { order, items, partnerEmail, corpus } = input;
  const evidences: FieldMatchEvidence[] = [];
  let weighted = 0;
  let weightSum = 0;

  const add = (
    key: MatchFieldKey,
    label: string,
    orderValue: string | null | undefined,
    weight: number,
    matched: boolean,
    required = false,
  ) => {
    const val = (orderValue || '').trim();
    if (!val) return { skipped: true as const, matched: true, required: false };
    const hit = matched;
    evidences.push({
      key,
      label,
      orderValue: val,
      matched: hit,
      mailEvidence: hit ? findEvidenceClip(corpus.rawText, val) : null,
      weight,
    });
    weighted += hit ? weight : 0;
    weightSum += weight;
    return { skipped: false as const, matched: hit, required };
  };

  const docNo = order.doc_no?.trim() || '';
  const docHit = docNo ? tokenPresent(corpus.normText, docNo) : true;
  if (docNo) {
    add('doc_no', '견적번호', docNo, 3.0, docHit, true);
  }

  const partnerHit = order.partner_name
    ? tokenPresent(corpus.normText, order.partner_name)
    : true;
  if (order.partner_name) {
    add('partner_name', '거래처', order.partner_name, 2.2, partnerHit, true);
  }

  const email = (partnerEmail || '').trim();
  let emailHit = true;
  if (email) {
    emailHit = tokenPresent(corpus.normText, email) || tokenPresent(corpus.normText, email.split('@')[0] || '');
    // from_addr 직접 비교
    const from = (corpus.mail.from_addr || '').toLowerCase();
    if (!emailHit && from.includes(email.toLowerCase())) emailHit = true;
    add('partner_email', '거래처 이메일', email, 1.6, emailHit, false);
  }

  if (order.contact_person?.trim()) {
    const hit = tokenPresent(corpus.normText, order.contact_person);
    add('contact_person', '담당자', order.contact_person, 1.0, hit, false);
  }

  const vessel = order.vessel?.trim() || '';
  const vesselHit = vessel ? tokenPresent(corpus.normText, vessel) : true;
  if (vessel) {
    add('vessel', 'Vessel', vessel, 2.4, vesselHit, true);
  }

  const usableItems = items.filter(it => (it.name || '').trim());
  let itemNameHits = 0;
  let itemSpecHits = 0;
  let itemQtyHits = 0;
  let itemUnitHits = 0;
  let itemNameWeight = 0;
  let itemSpecWeight = 0;
  let itemQtyWeight = 0;
  let itemUnitWeight = 0;

  for (const it of usableItems) {
    const name = it.name.trim();
    const nameHit = tokenPresent(corpus.normText, name);
    evidences.push({
      key: 'item_name',
      label: '품명',
      orderValue: name,
      matched: nameHit,
      mailEvidence: nameHit ? findEvidenceClip(corpus.rawText, name) : null,
      weight: 1.2,
    });
    itemNameWeight += 1.2;
    if (nameHit) {
      itemNameHits += 1;
      weighted += 1.2;
    }
    weightSum += 1.2;

    const spec = (it.spec || '').trim();
    if (spec.length >= 2) {
      const specHit = tokenPresent(corpus.normText, spec);
      evidences.push({
        key: 'item_spec',
        label: '사양',
        orderValue: spec,
        matched: specHit,
        mailEvidence: specHit ? findEvidenceClip(corpus.rawText, spec) : null,
        weight: 0.8,
      });
      itemSpecWeight += 0.8;
      if (specHit) {
        itemSpecHits += 1;
        weighted += 0.8;
      }
      weightSum += 0.8;
    }

    if (it.qty != null && Number(it.qty) > 0) {
      const qHit = qtyPresent(corpus.normText, Number(it.qty));
      evidences.push({
        key: 'item_qty',
        label: '수량',
        orderValue: String(it.qty),
        matched: qHit,
        mailEvidence: qHit ? findEvidenceClip(corpus.rawText, String(it.qty)) : null,
        weight: 0.5,
      });
      itemQtyWeight += 0.5;
      if (qHit) {
        itemQtyHits += 1;
        weighted += 0.5;
      }
      weightSum += 0.5;
    }

    const unit = (it.unit || '').trim();
    if (unit) {
      const uHit = tokenPresent(corpus.normText, unit);
      evidences.push({
        key: 'item_unit',
        label: '단위',
        orderValue: unit,
        matched: uHit,
        mailEvidence: uHit ? findEvidenceClip(corpus.rawText, unit) : null,
        weight: 0.3,
      });
      itemUnitWeight += 0.3;
      if (uHit) {
        itemUnitHits += 1;
        weighted += 0.3;
      }
      weightSum += 0.3;
    }
  }

  // 필수: 견적번호(있으면)·거래처·Vessel(있으면)·품명 커버리지
  const itemNameCoverage = usableItems.length
    ? itemNameHits / usableItems.length
    : 1;
  const requiredOk =
    docHit &&
    partnerHit &&
    vesselHit &&
    (usableItems.length === 0 || itemNameCoverage >= 0.9);

  const score = weightSum > 0 ? weighted / weightSum : 0;

  // silence unused (kept for future tuning / debug)
  void itemSpecHits;
  void itemQtyHits;
  void itemUnitHits;
  void itemNameWeight;
  void itemSpecWeight;
  void itemQtyWeight;
  void itemUnitWeight;

  return {
    orderId: order.id,
    mailId: corpus.mail.id,
    score,
    requiredOk,
    evidences,
  };
}

/** 1:1 배정 — 점수 높은 쌍부터, 임계값 미만은 비매칭 */
export function assignOrderMailMatches(input: {
  orders: OrderWithPartner[];
  itemsByOrderId: Map<number, OrderItem[]>;
  partnerEmailById: Map<number, string | null>;
  corpora: MailCorpus[];
}): OrderMailMatchRow[] {
  const mailById = new Map(input.corpora.map(c => [c.mail.id, c]));
  const usedMails = new Set<number>();
  const resultMap = new Map<number, OrderMailMatchRow>();

  // 1) 명시 링크 우선 (orders.ai_mail_message_id / mail.registered_order_id)
  for (const order of input.orders) {
    const items = input.itemsByOrderId.get(order.id) || [];
    const partnerEmail = input.partnerEmailById.get(order.partner_id) ?? null;
    const linkedMailId = order.ai_mail_message_id ?? null;
    if (linkedMailId && mailById.has(linkedMailId) && !usedMails.has(linkedMailId)) {
      const corpus = mailById.get(linkedMailId)!;
      const scored = scoreOrderAgainstMail({ order, items, partnerEmail, corpus });
      usedMails.add(linkedMailId);
      resultMap.set(order.id, {
        order,
        items,
        partnerEmail,
        status: 'matched',
        mail: corpus.mail,
        score: Math.max(scored.score, 0.99),
        evidences: [
          {
            key: 'linked_id',
            label: 'AI메일 링크',
            orderValue: String(linkedMailId),
            matched: true,
            mailEvidence: `mail#${linkedMailId}`,
            weight: 5,
          },
          ...scored.evidences,
        ],
        matchMethod: 'ai_link',
      });
    }
  }

  for (const corpus of input.corpora) {
    const reg = corpus.mail.registered_order_id;
    if (!reg || usedMails.has(corpus.mail.id) || resultMap.has(reg)) continue;
    const order = input.orders.find(o => o.id === reg);
    if (!order) continue;
    const items = input.itemsByOrderId.get(order.id) || [];
    const partnerEmail = input.partnerEmailById.get(order.partner_id) ?? null;
    const scored = scoreOrderAgainstMail({ order, items, partnerEmail, corpus });
    usedMails.add(corpus.mail.id);
    resultMap.set(order.id, {
      order,
      items,
      partnerEmail,
      status: 'matched',
      mail: corpus.mail,
      score: Math.max(scored.score, 0.99),
      evidences: [
        {
          key: 'linked_id',
          label: '견적등록 링크',
          orderValue: String(reg),
          matched: true,
          mailEvidence: `mail#${corpus.mail.id}`,
          weight: 5,
        },
        ...scored.evidences,
      ],
      matchMethod: 'registered_link',
    });
  }

  // 2) 콘텐츠 매칭 후보
  type Pair = OrderMailScore & { method: 'content' };
  const pairs: Pair[] = [];
  for (const order of input.orders) {
    if (resultMap.has(order.id)) continue;
    const items = input.itemsByOrderId.get(order.id) || [];
    const partnerEmail = input.partnerEmailById.get(order.partner_id) ?? null;
    const docNo = order.doc_no?.trim() || '';
    const partnerName = order.partner_name?.trim() || '';
    const vessel = order.vessel?.trim() || '';

    // 후보 축소: 견적번호·거래처·Vessel 중 하나라도 본문에 있는 메일만 정밀 채점
    const candidates = input.corpora.filter(corpus => {
      if (usedMails.has(corpus.mail.id)) return false;
      if (corpus.mail.is_sent) return false;
      if (docNo && tokenPresent(corpus.normText, docNo)) return true;
      if (partnerName && tokenPresent(corpus.normText, partnerName)) return true;
      if (vessel && tokenPresent(corpus.normText, vessel)) return true;
      return false;
    });

    for (const corpus of candidates) {
      const scored = scoreOrderAgainstMail({ order, items, partnerEmail, corpus });
      if (!scored.requiredOk) continue;
      if (scored.score < MATCH_THRESHOLD) continue;
      pairs.push({ ...scored, method: 'content' });
    }
  }

  pairs.sort((a, b) => b.score - a.score || a.orderId - b.orderId);

  for (const p of pairs) {
    if (resultMap.has(p.orderId) || usedMails.has(p.mailId)) continue;
    const order = input.orders.find(o => o.id === p.orderId);
    if (!order) continue;
    const corpus = mailById.get(p.mailId);
    if (!corpus) continue;
    usedMails.add(p.mailId);
    resultMap.set(p.orderId, {
      order,
      items: input.itemsByOrderId.get(order.id) || [],
      partnerEmail: input.partnerEmailById.get(order.partner_id) ?? null,
      status: 'matched',
      mail: corpus.mail,
      score: p.score,
      evidences: p.evidences,
      matchMethod: 'content',
    });
  }

  // 3) 나머지 비매칭
  const rows: OrderMailMatchRow[] = input.orders.map(order => {
    const existing = resultMap.get(order.id);
    if (existing) return existing;
    return {
      order,
      items: input.itemsByOrderId.get(order.id) || [],
      partnerEmail: input.partnerEmailById.get(order.partner_id) ?? null,
      status: 'unmatched',
      mail: null,
      score: null,
      evidences: [],
      matchMethod: null,
    };
  });

  // 매칭 우선, 그다음 견적일 최신
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'matched' ? -1 : 1;
    return (b.order.order_date || '').localeCompare(a.order.order_date || '');
  });

  return rows;
}

export const ORDER_MAIL_MATCH_THRESHOLD = MATCH_THRESHOLD;
