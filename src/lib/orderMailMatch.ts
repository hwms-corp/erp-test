/**
 * 견적서 → 메일 학습매칭 (ERP)
 * - 후보: Gmail 라벨 「1-1. 견적서」만 (기간·첨부 없음)
 * - 키: 견적번호(doc_no) ↔ 메일 제목/본문 Ref
 * - 다중 후보 + 사람 확정
 */

import type { MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';

/** DB gmail_labels.name (공백 포함) */
export const QUOTE_MAIL_LABEL_NAME = '1-1. 견적서';

export type LearningMatchStatus =
  | 'candidate'
  | 'matched'
  | 'rejected'
  | 'unmatched'
  | 'failed';

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
  /** 해당 견적의 모든 매칭 행 */
  matches: OrderMailLearningMatchRow[];
  /** 목록 대표 행 (matched > 최고점 candidate > unmatched/failed) */
  match: OrderMailLearningMatchRow | null;
  mail: MailMessage | null;
  candidateCount: number;
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
};

export type LocalMailMatchHit = {
  mail: MailMessage;
  score: number;
  extracted_ref: string | null;
  reasons: string[];
  evidence: Record<string, unknown>;
};

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
  const d = new Date(`${order.order_date}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** 라벨명 느슨 비교: "1-1.견적서" ≈ "1-1. 견적서" */
export function labelNamesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return norm(a) === norm(b);
}

/** Ref/견적번호 정규화: 대문자 + 영숫자만 */
export function normalizeRef(s: string | null | undefined): string {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * 제목/본문에서 Ref·문서번호 후보 추출.
 * 완전 동일 문자열이 아니어도 ERP doc_no와 비교할 토큰을 뽑음.
 */
export function extractRefCandidates(text: string): string[] {
  const out = new Set<string>();
  const src = text || '';
  const push = (raw: string | undefined) => {
    const t = (raw || '').trim();
    if (t.length < 4 || t.length > 40) return;
    if (!/[0-9]/.test(t)) return;
    out.add(t);
  };

  const labeled = [
    /\bREF\.?\s*NO\.?\s*[:\-]?\s*\[?\s*([A-Za-z0-9][A-Za-z0-9\-\/_]{2,})\s*\]?/gi,
    /\b(?:DOC|RFQ|QUOT(?:E|ATION)?)\s*(?:NO|NUMBER|#)?\.?\s*[:\-]?\s*\[?\s*([A-Za-z0-9][A-Za-z0-9\-\/_]{2,})\s*\]?/gi,
    /(?:견적\s*번호|문서\s*번호|의뢰\s*번호|참조\s*번호|Ref\.?\s*No\.?)\s*[:\-]?\s*\[?\s*([A-Za-z0-9][A-Za-z0-9\-\/_]{2,})\s*\]?/gi,
  ];
  for (const re of labeled) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) push(m[1]);
  }

  // "JN260923001", [GMS2609-0628], QS260922-007
  const quoted = /["“”'【\[\()]([A-Za-z]{1,8}\d[\w\-\/]{2,})["”'】\]\)]/g;
  let qm: RegExpExecArray | null;
  while ((qm = quoted.exec(src))) push(qm[1]);

  const bare = /\b([A-Za-z]{1,8}\d{2,}[A-Za-z0-9\-\/]{0,24})\b/g;
  let bm: RegExpExecArray | null;
  while ((bm = bare.exec(src))) push(bm[1]);

  return [...out];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = cur;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/** 정규화 Ref vs ERP doc_no 유사도 0~1 */
export function scoreRefAgainstDocNo(extracted: string, docNo: string): number {
  const a = normalizeRef(extracted);
  const b = normalizeRef(docNo);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.85 + 0.1 * ratio;
  }
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const sim = 1 - dist / maxLen;
  if (sim >= 0.82) return sim;
  return 0;
}

function includesLoose(hay: string, needle: string): boolean {
  const n = (needle || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n || n.length < 2) return false;
  return hay.includes(n);
}

/**
 * 로컬 Ref 매칭 (첨부·기간 없음).
 * score = Ref 유사도(주) + 거래처/담당 가산(최대 ~0.15)
 * onProgress(checked, total) 로 실시간 00/00 보고. 매 N통마다 yield해 UI 갱신.
 */
export async function localMatchOrderToMails(
  order: Pick<OrderWithPartner, 'doc_no' | 'partner_name' | 'contact_person'>,
  partnerEmail: string | null,
  mails: MailMessage[],
  opts?: {
    minRefScore?: number;
    maxCandidates?: number;
    signal?: AbortSignal;
    onProgress?: (checked: number, total: number, hitCount: number) => void;
    /** UI yield 주기 (메일 수). 기본 25 */
    yieldEvery?: number;
  },
): Promise<LocalMailMatchHit[]> {
  const minRef = opts?.minRefScore ?? 0.82;
  const maxN = opts?.maxCandidates ?? 20;
  const yieldEvery = opts?.yieldEvery ?? 25;
  const docNo = (order.doc_no || '').trim();
  if (!docNo) {
    opts?.onProgress?.(0, mails.length, 0);
    return [];
  }

  const hints = buildPartnerNameHints(order.partner_name, partnerEmail);
  const contact = (order.contact_person || '').trim();
  const hits: LocalMailMatchHit[] = [];
  const total = mails.length;

  for (let i = 0; i < mails.length; i += 1) {
    if (opts?.signal?.aborted) {
      const err = new Error('사용자가 매칭을 중단했습니다');
      err.name = 'AbortError';
      throw err;
    }
    const mail = mails[i];
    const hay = [mail.subject, mail.snippet, mail.body_text, mail.from_addr].filter(Boolean).join('\n');
    const refs = extractRefCandidates(hay);
    let bestRef: string | null = null;
    let bestRefScore = 0;
    for (const ref of refs) {
      const s = scoreRefAgainstDocNo(ref, docNo);
      if (s > bestRefScore) {
        bestRefScore = s;
        bestRef = ref;
      }
    }
    // 추출 실패 시 doc_no 부분문자열이 제목/본문에 직접 있는 경우
    if (bestRefScore < minRef) {
      const normHay = normalizeRef(hay);
      const normDoc = normalizeRef(docNo);
      if (normDoc.length >= 5 && normHay.includes(normDoc)) {
        bestRefScore = 0.92;
        bestRef = docNo;
      }
    }

    if (bestRefScore >= minRef) {
      let bonus = 0;
      const reasons = ['ref_match'];
      const fromHay = (mail.from_addr || '').toLowerCase();
      const hayLow = hay.toLowerCase();
      const email = (partnerEmail || '').trim().toLowerCase();
      if (email && fromHay.includes(email)) {
        bonus += 0.08;
        reasons.push('partner_email_from');
      } else {
        for (const h of hints) {
          if (h.includes('@')) continue;
          if (includesLoose(hayLow, h) || includesLoose(fromHay, h)) {
            bonus += 0.05;
            reasons.push('partner_hint');
            break;
          }
        }
      }
      if (contact.length >= 2 && includesLoose(hayLow, contact)) {
        bonus += 0.04;
        reasons.push('contact');
      }

      const score = Math.min(1, bestRefScore + bonus);
      hits.push({
        mail,
        score,
        extracted_ref: bestRef,
        reasons,
        evidence: {
          extracted_ref: bestRef,
          ref_score: bestRefScore,
          order_doc_no: docNo,
          normalized_ref: normalizeRef(bestRef),
          normalized_doc_no: normalizeRef(docNo),
        },
      });
    }

    const checked = i + 1;
    if (checked === 1 || checked === total || checked % yieldEvery === 0) {
      opts?.onProgress?.(checked, total, hits.length);
      // React setState가 그려지도록 양보
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.mail.received_at).getTime() - new Date(a.mail.received_at).getTime();
  });
  return hits.slice(0, maxN);
}

export function derivePrimaryMatch(matches: OrderMailLearningMatchRow[]): {
  match: OrderMailLearningMatchRow | null;
  candidateCount: number;
} {
  const candidateCount = matches.filter(
    m => m.status === 'candidate' || m.status === 'matched',
  ).length;
  const selected = matches.find(m => m.status === 'matched');
  if (selected) return { match: selected, candidateCount };
  const candidates = matches
    .filter(m => m.status === 'candidate')
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  if (candidates[0]) return { match: candidates[0], candidateCount };
  const empty = matches.find(m => m.status === 'unmatched' || m.status === 'failed');
  return { match: empty || null, candidateCount };
}

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

export function buildMatchMailPayload(mail: MailMessage): MatchApiCandidatePayload {
  return {
    mail_id: mail.id,
    subject: mail.subject,
    from_addr: mail.from_addr,
    to_addr: mail.to_addr,
    received_at: mail.received_at,
    body_text: mail.body_text,
    snippet: mail.snippet,
  };
}
