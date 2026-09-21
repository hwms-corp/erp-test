// ─── DB Row Types ─────────────────────────────────────────────

export type RoleCode = 'admin' | 'sales' | 'purchasing' | 'support';
export type PartnerType = 'sales' | 'purchasing' | 'both';
export type BizType = 'individual' | 'corporate';
export type OrderStatus = 'draft' | 'confirmed';
export type DeliveryStatus = 'pending' | 'completed';
export type TaxInvoiceIssuedStatus = 'issued';
export type POStatus = 'ordered' | 'partial_received' | 'received';
export type RemittanceStatus = 'completed';
export type ExpectedReceiptStatus = 'scheduled';
export type PaymentTerms = 'immediate' | 'settlement';

export interface AppUser {
  id: number;
  auth_uid: string;
  name: string;
  email: string | null;
  role: RoleCode | null;
  dept: string | null;
  active: boolean;
  created_at: string;
}

export interface Company {
  id: number;
  name: string;
  biz_no: string;
  rep: string;
  addr: string | null;
  tel: string | null;
  fax: string | null;
}

export interface Partner {
  id: number;
  code: string;
  name: string;
  type: PartnerType;
  biz_no: string;
  biz_type: BizType;
  rep: string;
  tel: string | null;
  fax: string | null;
  addr: string | null;
  bank: string | null;
  account: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type OrderSource = 'manual' | 'ai_mail';
export type AiReviewStatus = 'pending_review' | 'reviewed';

export interface Order {
  id: number;
  doc_no: string;
  order_date: string;
  partner_id: number;
  contact_person: string | null;
  vessel: string | null;
  status: OrderStatus;
  delivery_status: DeliveryStatus | null;
  delivery_date: string | null;
  tax_invoice_issued_status: TaxInvoiceIssuedStatus | null;
  tax_invoice_issued_date: string | null;
  origin_order_id: number | null;
  /** 수동 작성 | AI 메일 자동등록 */
  source?: OrderSource | string | null;
  /** AI 건만: 검토대기 | 검토완료. 수동 견적은 null */
  ai_review_status?: AiReviewStatus | string | null;
  ai_mail_message_id?: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  seq: number;
  name: string;
  spec: string | null;
  qty: number;
  unit: string;
  price: number;
  remark: string | null;
  deleted_at: string | null;
}

export interface PO {
  id: number;
  doc_no: string;
  po_date: string;
  partner_id: number;
  order_id: number | null;
  required_date: string | null;
  payment_terms: PaymentTerms;
  remark: string | null;
  status: POStatus;
  remittance_status: RemittanceStatus | null;
  remittance_date: string | null;
  expected_receipt_status: ExpectedReceiptStatus | null;
  expected_receipt_date: string | null;
  received_date: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface POItem {
  id: number;
  po_id: number;
  order_item_id: number | null;
  seq: number;
  name: string;
  spec: string | null;
  qty: number;
  unit: string;
  price: number;
  remark: string | null;
  received_qty: number;
  deleted_at: string | null;
}

// ─── View Types ───────────────────────────────────────────────

export interface OrderWithPartner extends Order {
  partner_code: string;
  partner_name: string;
  partner_biz_no: string;
  partner_rep: string;
  partner_addr: string | null;
  partner_tel: string | null;
  supply_amount: number;
  tax_amount: number;
  total_amount: number;
}

export interface POWithDetail extends PO {
  partner_code: string;
  partner_name: string;
  partner_biz_no: string;
  partner_rep: string;
  partner_addr: string | null;
  order_doc_no: string | null;
  po_amount: number;
  received_amount: number;
}

export interface PartnerDeliverySummary {
  partner_id: number;
  partner_code: string;
  partner_name: string;
  month: string;
  delivery_count: number;
  supply_amount: number;
  tax_amount: number;
  total_amount: number;
}

// ─── Form types (for creating new records) ────────────────────

export interface MaterialLine {
  name: string;
  spec: string;
  qty: number;
  unit: string;
  price: number;
  remark: string;
}

export interface POLine extends MaterialLine {
  received_qty: number;
  order_item_id?: number;
}

// ─── Code → Label mappings ────────────────────────────────────

export const ROLE_LABELS: Record<RoleCode, string> = {
  admin: '관리자',
  sales: '영업팀',
  purchasing: '구매팀',
  support: '경영지원',
};

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  sales: '영업',
  purchasing: '구매',
  both: '영업/구매',
};

export const BIZ_TYPE_LABELS: Record<BizType, string> = {
  individual: '개인',
  corporate: '법인',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: '견적',
  confirmed: '수주',
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: '납품대기',
  completed: '납품완료',
};

export const PO_STATUS_LABELS: Record<POStatus, string> = {
  ordered: '발주',
  partial_received: '부분입고',
  received: '입고완료',
};

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  immediate: '즉시정산',
  settlement: '후정산',
};

export function statusLabel(status: string): string {
  return (ORDER_STATUS_LABELS as Record<string, string>)[status]
    ?? (DELIVERY_STATUS_LABELS as Record<string, string>)[status]
    ?? (PO_STATUS_LABELS as Record<string, string>)[status]
    ?? status;
}

// ─── Role-based access ────────────────────────────────────────

export type ViewPath =
  | '/dashboard' | '/partners' | '/orders' | '/confirmed' | '/pos' | '/receiving' | '/delivery' | '/mail';

export const ROLE_ACCESS: Record<RoleCode, ViewPath[]> = {
  admin: ['/dashboard', '/partners', '/orders', '/confirmed', '/pos', '/receiving', '/delivery', '/mail'],
  sales: ['/dashboard', '/partners', '/orders', '/confirmed', '/delivery', '/mail'],
  purchasing: ['/dashboard', '/partners', '/pos', '/receiving'],
  support: ['/dashboard', '/partners', '/orders', '/confirmed', '/pos', '/receiving', '/delivery', '/mail'],
};

export const ROLE_COLORS: Record<RoleCode, { bg: string; text: string }> = {
  admin: { bg: 'bg-red-50', text: 'text-red-700' },
  sales: { bg: 'bg-blue-50', text: 'text-blue-700' },
  purchasing: { bg: 'bg-orange-50', text: 'text-orange-700' },
  support: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

// ─── Utility ──────────────────────────────────────────────────

export const emptyMaterialLine = (): MaterialLine => ({
  name: '', spec: '', qty: 1, unit: 'EA', price: 0, remark: '',
});

export const emptyPOLine = (): POLine => ({
  ...emptyMaterialLine(), received_qty: 0,
});

export const fmt = (n: number) => new Intl.NumberFormat('ko-KR').format(n);
export const fmtW = (n: number) => `₩${fmt(n)}`;

// 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC 기준이라 KST 새벽엔 전날이 나오는 문제가 있어 사용 금지)
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const today = () => ymd(new Date());

/** YYYY-MM-DD → YYYY/MM/DD (화면 표시용) */
export const formatYmdSlash = (dateStr: string) => dateStr.replace(/-/g, '/');

export const monthStart = () => {
  const d = new Date();
  const prevMonthFirstDay = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return ymd(prevMonthFirstDay);
};

export const monthEnd = () => {
  const d = new Date();
  // 다음달 0일 = 이번달 말일
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return ymd(last);
};
