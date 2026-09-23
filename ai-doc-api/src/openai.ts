import './env.js';
import OpenAI from 'openai';
import type { CanonicalExtraction, DocumentLanguage, ExtractedField } from './types.js';

function modelName(): string {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

function client(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export function hasOpenAI(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}

type RawField = {
  value?: unknown;
  original_key?: string | null;
  original_value?: string | null;
  confidence?: number | null;
  evidence_text?: string | null;
  source_file?: string | null;
  source_page?: number | null;
} | null | undefined;

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

function normalizeSourceFile(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (['subject', 'mail_subject', 'title', '제목', '메일제목'].includes(lower)) return 'subject';
  if (['body', 'body.txt', 'mail_body', 'email', 'text', 'mail', 'input', '본문', '메일본문'].includes(lower)) {
    return 'body';
  }
  return s;
}

function asField<T>(raw: RawField, language: DocumentLanguage): ExtractedField<T | null> {
  if (!raw || raw.value === undefined || raw.value === null || raw.value === '') {
    return emptyField(null);
  }
  return {
    value: raw.value as T,
    original_key: raw.original_key ?? null,
    original_value: raw.original_value ?? String(raw.value),
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.8,
    source_file: normalizeSourceFile(raw.source_file),
    source_page: typeof raw.source_page === 'number' ? raw.source_page : null,
    evidence_text: raw.evidence_text ?? raw.original_value ?? null,
    language,
  };
}

function asNumberField(raw: RawField, language: DocumentLanguage): ExtractedField<number | null> {
  if (!raw || raw.value === undefined || raw.value === null || raw.value === '') {
    return emptyField(null);
  }
  const n = typeof raw.value === 'number' ? raw.value : Number(raw.value);
  if (Number.isNaN(n)) return emptyField(null);
  return {
    value: n,
    original_key: raw.original_key ?? null,
    original_value: raw.original_value ?? String(raw.value),
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.8,
    source_file: normalizeSourceFile(raw.source_file),
    source_page: typeof raw.source_page === 'number' ? raw.source_page : null,
    evidence_text: raw.evidence_text ?? raw.original_value ?? null,
    language,
  };
}

const FIELD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: ['string', 'number', 'null'] },
    original_key: { type: ['string', 'null'] },
    original_value: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    evidence_text: { type: ['string', 'null'] },
    source_file: { type: ['string', 'null'] },
    source_page: { type: ['number', 'null'] },
  },
  required: [
    'value',
    'original_key',
    'original_value',
    'confidence',
    'evidence_text',
    'source_file',
    'source_page',
  ],
} as const;

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    document_type: { type: 'string', enum: ['quotation_request', 'other', 'unknown'] },
    language: { type: 'string', enum: ['ko', 'en', 'zh', 'mixed', 'unknown'] },
    overall_confidence: { type: 'number' },
    customer: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: FIELD_SCHEMA,
        contact_name: FIELD_SCHEMA,
        email: FIELD_SCHEMA,
        tel: FIELD_SCHEMA,
        biz_no: FIELD_SCHEMA,
        addr: FIELD_SCHEMA,
      },
      required: ['name', 'contact_name', 'email', 'tel', 'biz_no', 'addr'],
    },
    request: {
      type: 'object',
      additionalProperties: false,
      properties: {
        document_no: FIELD_SCHEMA,
        request_date: FIELD_SCHEMA,
        delivery_date: FIELD_SCHEMA,
        currency: FIELD_SCHEMA,
        vessel: FIELD_SCHEMA,
        contact_person: FIELD_SCHEMA,
      },
      required: ['document_no', 'request_date', 'delivery_date', 'currency', 'vessel', 'contact_person'],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          product_name: FIELD_SCHEMA,
          product_code: FIELD_SCHEMA,
          specification: FIELD_SCHEMA,
          quantity: FIELD_SCHEMA,
          unit: FIELD_SCHEMA,
          requested_price: FIELD_SCHEMA,
          remark: FIELD_SCHEMA,
        },
        required: [
          'product_name',
          'product_code',
          'specification',
          'quantity',
          'unit',
          'requested_price',
          'remark',
        ],
      },
    },
    remarks: FIELD_SCHEMA,
  },
  required: ['document_type', 'language', 'overall_confidence', 'customer', 'request', 'items', 'remarks'],
} as const;

const SYSTEM_EXTRACT = `You extract RFQ / quotation-request fields from multilingual email/document text (Korean, English, Chinese, mixed).
Rules:
- Map meaning to the given canonical schema even if labels differ (문서번호/Doc No/RFQ No/询价单号 → document_no, 품명/Item/产品名称 → product_name, etc.).
- If a value is not clearly present in the text, set value to null. Do NOT invent values.
- Keep original_key/original_value/evidence_text from the source language when possible.
- evidence_text MUST be the exact short quote/snippet from the source where the value was found (not a paraphrase of the whole document).
- source_file MUST be one of:
  - "subject" if taken from the email subject / [제목] section
  - "body" if taken from the email body / [본문] section or plain email text
  - the exact attachment filename (e.g. RFQ.pdf, quote.xlsx) if taken from that attachment's content
- Never use "input" as source_file.
- source_page: PDF/image page number (1-based) when from an attachment; otherwise null.
- confidence is 0~1 for each field. If value is guessed or weakly supported, keep confidence ≤ 0.5.
- Prefer fields that appear in [제목]/[본문] over attachments when both exist.
- document_no must come from the RFQ document number in the text when present; never invent fake numbers like AI-123.
- Dates as YYYY-MM-DD when possible.
- quantity/requested_price as numbers when possible.
- Return overall_confidence as the average of non-null important fields.`;

export type InputFile = {
  filename: string;
  mime_type?: string;
  content_base64?: string;
  text?: string;
};

const MAX_OCR_FILES = 5;
const MAX_OCR_BYTES = 8 * 1024 * 1024;

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

function isImage(mime?: string, filename?: string): boolean {
  const m = (mime || '').toLowerCase();
  const f = (filename || '').toLowerCase();
  return m.startsWith('image/') || /\.(png|jpe?g|webp|gif|tiff?)$/i.test(f);
}

function isPdf(mime?: string, filename?: string): boolean {
  const m = (mime || '').toLowerCase();
  const f = (filename || '').toLowerCase();
  return m.includes('pdf') || f.endsWith('.pdf');
}

function imageMime(mime?: string, filename?: string): string {
  if (mime?.startsWith('image/')) return mime;
  const f = (filename || '').toLowerCase();
  if (f.endsWith('.png')) return 'image/png';
  if (f.endsWith('.webp')) return 'image/webp';
  if (f.endsWith('.gif')) return 'image/gif';
  if (f.endsWith('.tif') || f.endsWith('.tiff')) return 'image/tiff';
  return 'image/jpeg';
}

/** Build multimodal user content: labeled subject/body text + image/PDF attachments (OCR/Vision). */
export function buildMultimodalContent(text: string, files?: InputFile[]): ChatContentPart[] {
  const parts: ChatContentPart[] = [];
  const body = (text || '').trim();
  const fileNames = (files ?? [])
    .map(f => f.filename)
    .filter(Boolean)
    .slice(0, MAX_OCR_FILES);
  const guide = fileNames.length
    ? `\n\nAttachments available (use exact filename in source_file when extracting from them): ${fileNames.join(', ')}`
    : '';
  parts.push({
    type: 'text',
    text: body
      ? `${body.slice(0, 16000)}${guide}`
      : `Extract RFQ fields from the attached document image(s)/PDF. If not an RFQ, still return schema with nulls.${guide}`,
  });

  let used = 0;
  for (const file of files ?? []) {
    if (used >= MAX_OCR_FILES) break;
    if (!file.content_base64) continue;
    const approxBytes = Math.floor((file.content_base64.length * 3) / 4);
    if (approxBytes <= 0 || approxBytes > MAX_OCR_BYTES) continue;

    if (isImage(file.mime_type, file.filename)) {
      const mime = imageMime(file.mime_type, file.filename);
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${file.content_base64}` },
      });
      used += 1;
      continue;
    }

    if (isPdf(file.mime_type, file.filename)) {
      parts.push({
        type: 'file',
        file: {
          filename: file.filename || 'attachment.pdf',
          file_data: `data:application/pdf;base64,${file.content_base64}`,
        },
      });
      used += 1;
    }
  }

  return parts;
}

function hasBinaryAttachments(files?: InputFile[]): boolean {
  return (files ?? []).some(
    f =>
      !!f.content_base64 &&
      (isImage(f.mime_type, f.filename) || isPdf(f.mime_type, f.filename)),
  );
}

function parseExtractionJson(raw: string): CanonicalExtraction {
  const parsed = JSON.parse(raw) as {
    document_type: CanonicalExtraction['document_type'];
    language: DocumentLanguage;
    overall_confidence: number;
    customer: Record<string, RawField>;
    request: Record<string, RawField>;
    items: Array<Record<string, RawField>>;
    remarks: RawField;
  };

  const lang = parsed.language || 'unknown';

  return {
    document_type: parsed.document_type || 'unknown',
    language: lang,
    overall_confidence: Number(parsed.overall_confidence) || 0,
    customer: {
      name: asField<string>(parsed.customer?.name, lang),
      contact_name: asField<string>(parsed.customer?.contact_name, lang),
      email: asField<string>(parsed.customer?.email, lang),
      tel: asField<string>(parsed.customer?.tel, lang),
      biz_no: asField<string>(parsed.customer?.biz_no, lang),
      addr: asField<string>(parsed.customer?.addr, lang),
    },
    request: {
      document_no: asField<string>(parsed.request?.document_no, lang),
      request_date: asField<string>(parsed.request?.request_date, lang),
      delivery_date: asField<string>(parsed.request?.delivery_date, lang),
      currency: asField<string>(parsed.request?.currency, lang),
      vessel: asField<string>(parsed.request?.vessel, lang),
      contact_person: asField<string>(parsed.request?.contact_person, lang),
    },
    items: (parsed.items || []).map(it => ({
      product_name: asField<string>(it.product_name, lang),
      product_code: asField<string>(it.product_code, lang),
      specification: asField<string>(it.specification, lang),
      quantity: asNumberField(it.quantity, lang),
      unit: asField<string>(it.unit, lang),
      requested_price: asNumberField(it.requested_price, lang),
      remark: asField<string>(it.remark, lang),
    })),
    remarks: asField<string>(parsed.remarks, lang),
  };
}

export async function classifyWithOpenAI(
  text: string,
  files?: InputFile[],
): Promise<{
  document_type: 'quotation_request' | 'other' | 'unknown';
  confidence: number;
  language: DocumentLanguage;
} | null> {
  const openai = client();
  if (!openai) return null;

  const multimodal = hasBinaryAttachments(files);
  const userContent = multimodal
    ? buildMultimodalContent(text, files)
    : text.slice(0, 12000);

  try {
    const res = await openai.chat.completions.create({
      model: modelName(),
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'rfq_classify',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              document_type: { type: 'string', enum: ['quotation_request', 'other', 'unknown'] },
              confidence: { type: 'number' },
              language: { type: 'string', enum: ['ko', 'en', 'zh', 'mixed', 'unknown'] },
            },
            required: ['document_type', 'confidence', 'language'],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'Classify whether the email/document (including attached PDF/images via OCR) is a quotation request / RFQ (견적의뢰). Return JSON only.',
        },
        { role: 'user', content: userContent as never },
      ],
    });

    const raw = res.choices[0]?.message?.content;
    if (!raw) return null;
    return JSON.parse(raw) as {
      document_type: 'quotation_request' | 'other' | 'unknown';
      confidence: number;
      language: DocumentLanguage;
    };
  } catch (e) {
    // PDF file modality unsupported → text-only retry
    if (multimodal) {
      console.warn('[openai classify multimodal fallback]', (e as Error).message);
      return classifyWithOpenAI(text);
    }
    throw e;
  }
}

export async function extractWithOpenAI(
  text: string,
  files?: InputFile[],
): Promise<CanonicalExtraction | null> {
  const openai = client();
  if (!openai) return null;

  const multimodal = hasBinaryAttachments(files);
  const userContent = multimodal
    ? buildMultimodalContent(text, files)
    : text.slice(0, 20000);

  try {
    const res = await openai.chat.completions.create({
      model: modelName(),
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'canonical_rfq_extraction',
          strict: true,
          schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            SYSTEM_EXTRACT +
            '\n- Attached images/PDFs may contain the RFQ; OCR/read them and extract the same schema.',
        },
        { role: 'user', content: userContent as never },
      ],
    });

    const raw = res.choices[0]?.message?.content;
    if (!raw) return null;
    return parseExtractionJson(raw);
  } catch (e) {
    if (multimodal) {
      console.warn('[openai extract multimodal fallback]', (e as Error).message);
      return extractWithOpenAI(text);
    }
    throw e;
  }
}
