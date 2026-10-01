/**
 * 견적서 → 메일 학습매칭: 후보 필터·한영 거래처 힌트 (ERP 측)
 * 실제 첨부 OCR/정밀 매칭은 match API 엔진이 수행
 */

import type { MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';

/** 견적 작성시각 기준 과거 15일 ~ 작성시각 직전 */
export const CANDIDATE_LOOKBACK_DAYS = 15;

const HANGUL_TO_LATIN: Record<string, string> = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp',
  ㅅ: 's', ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h',
  ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo', ㅔ: 'e', ㅕ: 'yeo', ㅖ: 'ye',
  ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae', ㅚ: 'oe', ㅛ: 'yo', ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we', ㅟ: 'wi',
  ㅠ: 'yu', ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i',
};

const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function romanizeHangulChar(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return ch;
  const s = code - 0xac00;
  const cho = CHO[Math.floor(s / 588)];
  const jung = JUNG[Math.floor((s % 588) / 28)];
  const jong = JONG[s % 28];
  return (
    (HANGUL_TO_LATIN[cho] ?? '') +
    (HANGUL_TO_LATIN[jung] ?? '') +
    (HANGUL_TO_LATIN[jong] ?? '')
  );
}

/** 한글 거래처명 → 로마자 힌트 (느슨한 표기). 엔진이 한·영 동등 매칭에 사용 */
export function romanizePartnerHint(name: string): string {
  return [...name].map(romanizeHangulChar).join('').replace(/\s+/g, ' ').trim();
}

export function buildPartnerNameHints(partnerName: string, partnerEmail?: string | null): string[] {
  const hints = new Set<string>();
  const name = (partnerName || '').trim();
  if (name) {
    hints.add(name);
    const roman = romanizePartnerHint(name);
    if (roman && roman.toLowerCase() !== name.toLowerCase()) hints.add(roman);
    // 공백 제거·괄호 제거 변형
    hints.add(name.replace(/\s+/g, ''));
    const noParen = name.replace(/[()（）\[\]].*$/, '').trim();
    if (noParen && noParen !== name) hints.add(noParen);
  }
  const email = (partnerEmail || '').trim().toLowerCase();
  if (email) {
    hints.add(email);
    const local = email.split('@')[0];
    if (local) hints.add(local);
  }
  return [...hints].filter(Boolean);
}

export function getOrderCreatedAt(order: Pick<OrderWithPartner, 'created_at' | 'order_date'>): Date {
  if (order.created_at) {
    const d = new Date(order.created_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // fallback: 견적일 끝시각(UTC) — 작성시각 없을 때
  const d = new Date(`${order.order_date}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** 후보 구간: [createdAt-15d, createdAt) */
export function candidateReceivedWindow(order: Pick<OrderWithPartner, 'created_at' | 'order_date'>): {
  fromIso: string;
  toIsoExclusive: string;
  createdAt: Date;
} {
  const createdAt = getOrderCreatedAt(order);
  const from = new Date(createdAt.getTime() - CANDIDATE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return {
    fromIso: from.toISOString(),
    toIsoExclusive: createdAt.toISOString(),
    createdAt,
  };
}

export function filterCandidateMails(
  mails: MailMessage[],
  order: Pick<OrderWithPartner, 'created_at' | 'order_date'>,
  usedMailIds: Set<number>,
): MailMessage[] {
  const { fromIso, toIsoExclusive } = candidateReceivedWindow(order);
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIsoExclusive).getTime();
  return mails.filter(m => {
    if (m.is_sent) return false;
    if (m.deleted_at) return false;
    if (usedMailIds.has(m.id)) return false;
    const t = new Date(m.received_at).getTime();
    if (Number.isNaN(t)) return false;
    return t >= fromMs && t < toMs;
  });
}

/**
 * 첨부 base64/OCR 전에 ERP가 텍스트로 후보를 줄임.
 * ~200통 전량 첨부 다운로드를 막기 위한 1차 게이트 — mail-ai-api가 아님.
 */
export const TEXT_PREFILTER_TOP_N = 20;

function normText(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function includesLoose(hay: string, needle: string): boolean {
  const n = normText(needle);
  if (!n || n.length < 2) return false;
  return hay.includes(n);
}

export type TextPrefilterHit = {
  mail: MailMessage;
  score: number;
  reasons: string[];
};

/**
 * subject/from/body/snippet(+첨부 파일명)만으로 견적 힌트와 느슨히 점수.
 * OCR·정밀 매칭은 엔진 몫.
 */
export function scoreMailTextAgainstOrder(
  mail: MailMessage,
  order: Pick<OrderWithPartner, 'doc_no' | 'partner_name' | 'contact_person' | 'vessel'>,
  items: Pick<OrderItem, 'name'>[],
  partnerEmail: string | null,
  attachmentFilenames?: string[],
): TextPrefilterHit {
  const hay = normText(
    [
      mail.subject,
      mail.from_addr,
      mail.to_addr,
      mail.snippet,
      mail.body_text,
      ...(attachmentFilenames || []),
    ].join('\n'),
  );
  const fromHay = normText(mail.from_addr);
  let score = 0;
  const reasons: string[] = [];

  const docNo = (order.doc_no || '').trim();
  if (docNo && includesLoose(hay, docNo)) {
    score += 100;
    reasons.push('doc_no');
  }

  const email = (partnerEmail || '').trim().toLowerCase();
  if (email && fromHay.includes(email)) {
    score += 50;
    reasons.push('partner_email_from');
  } else if (email && hay.includes(email)) {
    score += 30;
    reasons.push('partner_email_body');
  }

  const hints = buildPartnerNameHints(order.partner_name, partnerEmail);
  for (const h of hints) {
    if (h.includes('@')) continue; // 이메일은 위에서 처리
    if (includesLoose(hay, h) || includesLoose(fromHay, h)) {
      score += 25;
      reasons.push('partner_hint');
      break;
    }
  }

  const vessel = (order.vessel || '').trim();
  if (vessel.length >= 3 && includesLoose(hay, vessel)) {
    score += 35;
    reasons.push('vessel');
  }

  const contact = (order.contact_person || '').trim();
  if (contact.length >= 2 && includesLoose(hay, contact)) {
    score += 15;
    reasons.push('contact');
  }

  // 품명 토큰(앞 몇 개만) — 너무 짧은 일반어는 스킵
  let itemHits = 0;
  for (const it of items.slice(0, 12)) {
    const name = (it.name || '').trim();
    if (name.length < 4) continue;
    // 너무 긴 품명은 앞 구간만
    const token = name.length > 40 ? name.slice(0, 40) : name;
    if (includesLoose(hay, token)) {
      itemHits += 1;
      if (itemHits >= 3) break;
    }
  }
  if (itemHits > 0) {
    score += itemHits * 8;
    reasons.push(`item_name×${itemHits}`);
  }

  return { mail, score, reasons };
}

/**
 * 15일 윈도우 후보 → 텍스트 점수 상위 topN만 남김 (첨부 다운로드 전).
 * 점수가 전부 0이어도 최신순 topN은 통과(첨부만 RFQ인 케이스 대비 폴백).
 */
export function prefilterCandidatesByText(
  mails: MailMessage[],
  order: Pick<OrderWithPartner, 'doc_no' | 'partner_name' | 'contact_person' | 'vessel'>,
  items: Pick<OrderItem, 'name'>[],
  partnerEmail: string | null,
  opts?: {
    topN?: number;
    attachmentFilenamesByMailId?: Map<number, string[]>;
  },
): { kept: MailMessage[]; ranked: TextPrefilterHit[]; dropped: number } {
  const topN = opts?.topN ?? TEXT_PREFILTER_TOP_N;
  const ranked = mails
    .map(m =>
      scoreMailTextAgainstOrder(
        m,
        order,
        items,
        partnerEmail,
        opts?.attachmentFilenamesByMailId?.get(m.id),
      ),
    )
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.mail.received_at).getTime() - new Date(a.mail.received_at).getTime();
    });

  const keptHits = ranked.slice(0, Math.max(1, topN));
  return {
    kept: keptHits.map(h => h.mail),
    ranked: keptHits,
    dropped: Math.max(0, mails.length - keptHits.length),
  };
}

export type LearningMatchStatus = 'matched' | 'unmatched' | 'failed';

export interface OrderMailLearningMatchRow {
  id?: number;
  order_id: number;
  mail_message_id: number | null;
  status: LearningMatchStatus;
  score: number | null;
  match_reasons: unknown;
  evidence: unknown;
  engine_version: string | null;
  error_message: string | null;
  matched_at: string;
}

export interface LearningOrderListItem {
  order: OrderWithPartner;
  items: OrderItem[];
  partnerEmail: string | null;
  match: OrderMailLearningMatchRow | null;
  mail: MailMessage | null;
}

export type MatchApiOrderPayload = {
  id: number;
  doc_no: string;
  order_date: string;
  created_at: string;
  partner_name: string;
  partner_name_hints: string[];
  partner_email: string | null;
  contact_person: string | null;
  vessel: string | null;
  items: { name: string; spec: string | null; qty: number; unit: string; remark: string | null }[];
};

export type MatchApiCandidatePayload = {
  mail_id: number;
  subject: string | null;
  from_addr: string | null;
  to_addr: string | null;
  received_at: string;
  body_text: string | null;
  snippet: string | null;
  attachments: {
    id: number;
    filename: string;
    mime_type: string | null;
    size_bytes: number | null;
    content_base64?: string;
  }[];
};

export function buildMatchOrderPayload(
  order: OrderWithPartner,
  items: OrderItem[],
  partnerEmail: string | null,
): MatchApiOrderPayload {
  return {
    id: order.id,
    doc_no: order.doc_no,
    order_date: order.order_date,
    created_at: getOrderCreatedAt(order).toISOString(),
    partner_name: order.partner_name,
    partner_name_hints: buildPartnerNameHints(order.partner_name, partnerEmail),
    partner_email: partnerEmail,
    contact_person: order.contact_person,
    vessel: order.vessel,
    items: items.map(it => ({
      name: it.name,
      spec: it.spec,
      qty: Number(it.qty),
      unit: it.unit,
      remark: it.remark,
    })),
  };
}
