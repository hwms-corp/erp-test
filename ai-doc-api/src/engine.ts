import {
  classifyWithOpenAI,
  extractWithOpenAI,
  hasOpenAI,
  type InputFile,
} from './openai.js';
import { extractOfficeOrText, isOfficeOrTextFile } from './officeExtract.js';
import type { CanonicalExtraction, DocumentLanguage, ExtractedField } from './types.js';

function emptyField<T>(value: T): ExtractedField<T> {
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
    source_file: 'body',
    source_page: null,
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
    if (m?.[1]) return { key: (m[0].split(/[:：]/)[0] || 'matched').trim(), value: m[1].trim() };
  }
  return null;
}

export function classifyTextHeuristic(text: string) {
  const language = detectLanguage(text);
  if (isRfq(text)) return { document_type: 'quotation_request' as const, confidence: 0.92, language };
  return { document_type: 'other' as const, confidence: 0.7, language };
}

export function extractTextHeuristic(text: string): CanonicalExtraction {
  const lang = detectLanguage(text);
  const out: CanonicalExtraction = {
    document_type: isRfq(text) ? 'quotation_request' : 'other',
    language: lang,
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

  const docNo = pick(text, [
    /(?:문서번호|견적번호|의뢰번호|Doc(?:ument)?\s*No\.?|RFQ\s*No\.?|询价单号|詢價單號)\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]*)/i,
    /(?:견적의뢰|RFQ)\s*#\s*([A-Za-z0-9][A-Za-z0-9\-_/]*)/i,
  ]);
  if (docNo) out.request.document_no = f(docNo.value, docNo.key, docNo.value, 0.95, lang);

  const cust = pick(text, [/(?:거래처|회사명|Customer|Company|公司)\s*[:：]\s*(.+)/i]);
  if (cust) out.customer.name = f(cust.value, cust.key, cust.value, 0.9, lang);

  const contact = pick(text, [/(?:담당|Contact)\s*[:：]\s*(.+)/i]);
  if (contact) {
    out.customer.contact_name = f(contact.value, contact.key, contact.value, 0.85, lang);
    out.request.contact_person = f(contact.value, contact.key, contact.value, 0.85, lang);
  }

  const email = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (email) out.customer.email = f(email[0], 'email', email[0], 0.95, 'en');

  const delivery = pick(text, [
    /(?:납기|납품요청일|Required Date|Delivery Date|交货日期)\s*[:：]\s*(\d{4}-\d{2}-\d{2})/i,
  ]);
  if (delivery) out.request.delivery_date = f(delivery.value, delivery.key, delivery.value, 0.92, lang);

  const vessel = pick(text, [/(?:선명|Vessel|船名)\s*[:：]\s*(.+)/i]);
  if (vessel) out.request.vessel = f(vessel.value, vessel.key, vessel.value, 0.9, lang);

  const remarks = pick(text, [/(?:비고|Remark|备注)\s*[:：]\s*(.+)/i]);
  if (remarks) out.remarks = f(remarks.value, remarks.key, remarks.value, 0.8, lang);

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
  out.overall_confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return out;
}

/** ChatGPT 우선(텍스트+첨부 OCR), 실패/미설정 시 휴리스틱 폴백 */
export async function classifyText(text: string, files?: InputFile[]) {
  const enriched = await enrichFiles(files);
  if (hasOpenAI()) {
    try {
      const r = await classifyWithOpenAI(text, enriched);
      if (r) return r;
    } catch (e) {
      console.error('[openai classify fallback]', (e as Error).message);
    }
  }
  return classifyTextHeuristic(collectInputText({ text, files: enriched }));
}

/** 본문만으로 필수 정보가 충분하면 첨부 OCR 생략 */
function isBodySufficient(ex: CanonicalExtraction): boolean {
  const hasCustomer = !!ex.customer?.name?.value?.toString().trim();
  const hasItems = (ex.items || []).some(it => !!it.product_name?.value?.toString().trim());
  const hasDoc = !!ex.request?.document_no?.value?.toString().trim();
  const hits = [hasCustomer, hasItems, hasDoc].filter(Boolean).length;
  return hits >= 2 && (ex.overall_confidence ?? 0) >= 0.75;
}

async function enrichFiles(files?: InputFile[]): Promise<InputFile[] | undefined> {
  if (!files?.length) return files;
  const out: InputFile[] = [];
  for (const file of files) {
    const next: InputFile = { ...file };
    if (
      !next.text
      && next.content_base64
      && isOfficeOrTextFile(next.filename, next.mime_type)
    ) {
      const r = await extractOfficeOrText(next.filename, next.mime_type, next.content_base64);
      if (r.text) {
        next.text = r.text;
        // Vision에 바이너리 재전송 불필요 — 토큰 절약
        next.content_base64 = undefined;
      } else if (r.error) {
        console.warn('[officeExtract]', next.filename, r.error);
      }
    }
    out.push(next);
  }
  return out;
}

export async function extractText(text: string, files?: InputFile[]): Promise<CanonicalExtraction> {
  const enriched = await enrichFiles(files);
  const hasAtt = (enriched?.length ?? 0) > 0;

  if (hasOpenAI()) {
    try {
      // Wave D: 제목·본문 우선 — 충분하면 첨부 스킵
      if (hasAtt && (text || '').trim()) {
        const first = await extractWithOpenAI(text);
        if (first && isBodySufficient(first)) {
          console.log('[extract] body-first sufficient — skip attachment OCR');
          return first;
        }
        console.log('[extract] body insufficient — include attachments');
      }
      const r = await extractWithOpenAI(text, enriched);
      if (r) return r;
    } catch (e) {
      console.error('[openai extract fallback]', (e as Error).message);
    }
  }
  return extractTextHeuristic(collectInputText({ text, files: enriched }));
}

export function collectInputText(input: {
  text?: string;
  files?: InputFile[];
}): string {
  const parts: string[] = [];
  if (input.text) parts.push(input.text);
  for (const file of input.files ?? []) {
    if (file.text) {
      parts.push(`\n--- ${file.filename} ---\n${file.text}`);
      continue;
    }
    if (
      file.content_base64 &&
      (file.mime_type?.startsWith('text/') ||
        file.filename.endsWith('.txt') ||
        file.filename.endsWith('.eml') ||
        file.filename.endsWith('.csv'))
    ) {
      try {
        parts.push(
          `\n--- ${file.filename} ---\n${Buffer.from(file.content_base64, 'base64').toString('utf8')}`,
        );
      } catch {
        /* ignore */
      }
    } else if (file.filename && file.content_base64) {
      parts.push(
        `\n[attachment:${file.filename} mime=${file.mime_type ?? 'unknown'} — binary OCR via Vision]`,
      );
    } else if (file.filename) {
      parts.push(`\n[attachment:${file.filename} mime=${file.mime_type ?? 'unknown'}]`);
    }
  }
  return parts.join('\n');
}
