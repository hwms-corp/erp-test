/**
 * PoC 추출기 — 규칙 기반 (API 키 없이도 KPI 측정 가능)
 * 실제 운영은 ai-doc-api multimodal LLM이 담당
 */
import type {
  CanonicalExtraction,
  DocumentLanguage,
  ExtractedField,
} from '../../src/types/aiMail.ts';
import { emptyCanonicalExtraction, emptyField } from '../../src/types/aiMail.ts';

function f<T>(
  value: T,
  original_key: string | null,
  original_value: string | null,
  confidence: number,
  language: DocumentLanguage,
): ExtractedField<T> {
  return {
    ...emptyField(value),
    original_key,
    original_value,
    confidence,
    evidence_text: original_value,
    language,
    source_file: 'body.txt',
    source_page: 1,
  };
}

function detectLanguage(text: string): DocumentLanguage {
  const hasKo = /[가-힣]/.test(text);
  const hasZh = /[\u4e00-\u9fff]/.test(text);
  const hasEn = /[A-Za-z]{3,}/.test(text);
  const n = [hasKo, hasZh, hasEn].filter(Boolean).length;
  if (n > 1) return 'mixed';
  if (hasKo) return 'ko';
  if (hasZh) return 'zh';
  if (hasEn) return 'en';
  return 'unknown';
}

function isRfq(text: string): boolean {
  return /견적의뢰|견적\s*요청|RFQ|quotation\s*request|询价|詢價/i.test(text);
}

function pick(text: string, patterns: RegExp[]): { key: string; value: string } | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return { key: m[0].split(/[:：]/)[0]?.trim() || 'matched', value: m[1].trim() };
  }
  return null;
}

export function extractFromText(text: string): CanonicalExtraction {
  const lang = detectLanguage(text);
  const out = emptyCanonicalExtraction();
  out.language = lang;
  out.document_type = isRfq(text) ? 'quotation_request' : 'other';

  const docNo = pick(text, [
    /(?:문서번호|견적번호|의뢰번호|Doc(?:ument)?\s*No\.?|RFQ\s*No\.?|询价单号)\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]*)/i,
    /(?:견적의뢰|RFQ)\s*#\s*([A-Za-z0-9][A-Za-z0-9\-_/]*)/i,
  ]);
  if (docNo) {
    out.request.document_no = f(docNo.value, docNo.key, docNo.value, 0.95, lang);
  }

  const cust = pick(text, [
    /(?:거래처|회사명|Customer|Company|公司)\s*[:：]\s*(.+)/i,
  ]);
  if (cust) {
    out.customer.name = f(cust.value, cust.key, cust.value, 0.9, lang);
  }

  const contact = pick(text, [/(?:담당|Contact)\s*[:：]\s*(.+)/i]);
  if (contact) {
    out.customer.contact_name = f(contact.value, contact.key, contact.value, 0.85, lang);
    out.request.contact_person = f(contact.value, contact.key, contact.value, 0.85, lang);
  }

  const email = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (email) {
    out.customer.email = f(email[0], 'email', email[0], 0.95, 'en');
  }

  const delivery = pick(text, [
    /(?:납기|납품요청일|Required Date|Delivery Date|交货日期)\s*[:：]\s*(\d{4}-\d{2}-\d{2})/i,
  ]);
  if (delivery) {
    out.request.delivery_date = f(delivery.value, delivery.key, delivery.value, 0.92, lang);
  }

  const vessel = pick(text, [/(?:선명|Vessel|船名)\s*[:：]\s*(.+)/i]);
  if (vessel) {
    out.request.vessel = f(vessel.value, vessel.key, vessel.value, 0.9, lang);
  }

  const remarks = pick(text, [/(?:비고|Remark|备注)\s*[:：]\s*(.+)/i]);
  if (remarks) {
    out.remarks = f(remarks.value, remarks.key, remarks.value, 0.8, lang);
  }

  const itemLineRe =
    /^\s*\d+\.\s*(?:품명|Item|产品名称)\s*[:：]\s*(.+?)\s*\/\s*(?:사양|Spec|规格)\s*[:：]\s*(.+?)\s*\/\s*(?:수량|Qty|数量)\s*[:：]\s*(\d+(?:\.\d+)?)\s*(\w+)?/gim;

  let m: RegExpExecArray | null;
  while ((m = itemLineRe.exec(text)) !== null) {
    const qty = Number(m[3]);
    out.items.push({
      product_name: f(m[1].trim(), '품명', m[1].trim(), 0.9, lang),
      product_code: emptyField(null),
      specification: f(m[2].trim(), '사양', m[2].trim(), 0.9, lang),
      quantity: f(qty, '수량', m[3], 0.9, lang),
      unit: f((m[4] || 'EA').trim(), 'unit', (m[4] || 'EA').trim(), 0.85, 'en'),
      requested_price: emptyField(null),
      remark: emptyField(null),
    });
  }

  const confs: number[] = [];
  if (out.customer.name.value) confs.push(out.customer.name.confidence);
  for (const it of out.items) {
    if (it.product_name.value) confs.push(it.product_name.confidence);
    if (it.quantity.value != null) confs.push(it.quantity.confidence);
  }
  out.overall_confidence = confs.length
    ? confs.reduce((a, b) => a + b, 0) / confs.length
    : 0;

  return out;
}

export function classifyDocument(text: string): {
  document_type: 'quotation_request' | 'other' | 'unknown';
  confidence: number;
  language: DocumentLanguage;
} {
  const language = detectLanguage(text);
  if (isRfq(text)) return { document_type: 'quotation_request', confidence: 0.92, language };
  return { document_type: 'other', confidence: 0.7, language };
}
