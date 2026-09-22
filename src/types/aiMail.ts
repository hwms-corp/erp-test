/**
 * AI 메일 자동분류 — Canonical Schema
 * ERP orders / order_items / partners 필드와 1:1 매핑
 */

export type DocumentLanguage = 'ko' | 'en' | 'zh' | 'mixed' | 'unknown';
export type DocumentType = 'quotation_request' | 'other' | 'unknown';

export type MailProcessStatus =
  | 'received'
  | 'classifying'
  | 'extracting'
  | 'review_required'
  | 'ready_auto'
  | 'registered'
  | 'rejected'
  | 'failed';

/** 필드 단위 추출 메타 (Evidence + Confidence) */
export interface ExtractedField<T = string | number | null> {
  value: T;
  original_key: string | null;
  original_value: string | null;
  confidence: number;
  source_file: string | null;
  source_page: number | null;
  evidence_text: string | null;
  language: DocumentLanguage | null;
}

export interface CanonicalCustomer {
  name: ExtractedField<string | null>;
  contact_name: ExtractedField<string | null>;
  email: ExtractedField<string | null>;
  tel: ExtractedField<string | null>;
  biz_no: ExtractedField<string | null>;
  addr: ExtractedField<string | null>;
}

export interface CanonicalRequest {
  document_no: ExtractedField<string | null>;
  request_date: ExtractedField<string | null>;
  delivery_date: ExtractedField<string | null>;
  currency: ExtractedField<string | null>;
  vessel: ExtractedField<string | null>;
  contact_person: ExtractedField<string | null>;
}

export interface CanonicalLineItem {
  product_name: ExtractedField<string | null>;
  product_code: ExtractedField<string | null>;
  specification: ExtractedField<string | null>;
  quantity: ExtractedField<number | null>;
  unit: ExtractedField<string | null>;
  requested_price: ExtractedField<number | null>;
  remark: ExtractedField<string | null>;
}

/** AI Document Intelligence 표준 출력 */
export interface CanonicalExtraction {
  document_type: DocumentType;
  language: DocumentLanguage;
  overall_confidence: number;
  customer: CanonicalCustomer;
  request: CanonicalRequest;
  items: CanonicalLineItem[];
  remarks: ExtractedField<string | null>;
}

/** Canonical → ERP 매핑 가이드 */
export const CANONICAL_TO_ERP = {
  'customer.name': 'partners.name (매칭) → orders.partner_id',
  'customer.contact_name': 'orders.contact_person',
  'customer.email': 'partners.email (참고)',
  'customer.tel': 'partners.tel (참고)',
  'customer.biz_no': 'partners.biz_no (매칭)',
  'request.document_no': 'orders.doc_no (견적의뢰서 문서번호 — AI 채번 금지)',
  'request.request_date': 'orders.order_date',
  'request.delivery_date': '(참고, 납기 — 견적 헤더에 별도 컬럼 없음)',
  'request.vessel': 'orders.vessel',
  'request.contact_person': 'orders.contact_person',
  'items[].product_name': 'order_items.name',
  'items[].specification': 'order_items.spec',
  'items[].quantity': 'order_items.qty',
  'items[].unit': 'order_items.unit',
  'items[].requested_price': 'order_items.price',
  'items[].remark': 'order_items.remark',
  'remarks': '(비고 — 첫 품목 remark 또는 별도 보존)',
} as const;

export const REQUIRED_FIELDS_FOR_AUTO = [
  'customer.name',
  'items[].product_name',
  'items[].quantity',
] as const;

export const CONFIDENCE_THRESHOLDS = {
  autoCandidate: 0.95,
  quickReview: 0.8,
} as const;

export function emptyField<T = null>(value: T = null as T): ExtractedField<T> {
  return {
    value,
    original_key: null,
    original_value: null,
    confidence: 0,
    source_file: null,
    source_page: null,
    evidence_text: null,
    language: null,
  };
}

export function emptyCanonicalExtraction(): CanonicalExtraction {
  return {
    document_type: 'unknown',
    language: 'unknown',
    overall_confidence: 0,
    customer: {
      name: emptyField(null),
      contact_name: emptyField(null),
      email: emptyField(null),
      tel: emptyField(null),
      biz_no: emptyField(null),
      addr: emptyField(null),
    },
    request: {
      document_no: emptyField(null),
      request_date: emptyField(null),
      delivery_date: emptyField(null),
      currency: emptyField(null),
      vessel: emptyField(null),
      contact_person: emptyField(null),
    },
    items: [],
    remarks: emptyField(null),
  };
}

// ─── ERP Mail tables ──────────────────────────────────────────

export interface MailMessage {
  id: number;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  history_id: string | null;
  subject: string | null;
  from_addr: string | null;
  to_addr: string | null;
  received_at: string;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  is_rfq: boolean | null;
  classify_confidence: number | null;
  process_status: MailProcessStatus;
  ai_job_id: string | null;
  extraction: CanonicalExtraction | null;
  matched_partner_id: number | null;
  registered_order_id: number | null;
  error_message: string | null;
  /** 자동등록 스킵/실패·검토 사유 (한글). AI error_message와 별도 */
  status_reason?: string | null;
  is_starred?: boolean;
  starred_at?: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MailAttachment {
  id: number;
  mail_message_id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  gmail_attachment_id?: string | null;
  content_id?: string | null;
  sha256: string | null;
  created_at: string;
}

export interface PartnerMatchCandidate {
  partner_id: number;
  partner_code: string;
  partner_name: string;
  score: number;
  reason: string;
}
