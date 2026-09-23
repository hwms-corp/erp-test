/** Shared types for AI Document Intelligence API (duplicated lightly for package isolation) */

export type DocumentLanguage = 'ko' | 'en' | 'zh' | 'mixed' | 'unknown';
export type DocumentType = 'quotation_request' | 'other' | 'unknown';

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

export interface CanonicalExtraction {
  document_type: DocumentType;
  language: DocumentLanguage;
  overall_confidence: number;
  customer: {
    name: ExtractedField<string | null>;
    contact_name: ExtractedField<string | null>;
    email: ExtractedField<string | null>;
    tel: ExtractedField<string | null>;
    biz_no: ExtractedField<string | null>;
    addr: ExtractedField<string | null>;
  };
  request: {
    document_no: ExtractedField<string | null>;
    request_date: ExtractedField<string | null>;
    delivery_date: ExtractedField<string | null>;
    currency: ExtractedField<string | null>;
    vessel: ExtractedField<string | null>;
    contact_person: ExtractedField<string | null>;
  };
  items: Array<{
    product_name: ExtractedField<string | null>;
    product_code: ExtractedField<string | null>;
    specification: ExtractedField<string | null>;
    quantity: ExtractedField<number | null>;
    unit: ExtractedField<string | null>;
    requested_price: ExtractedField<number | null>;
    remark: ExtractedField<string | null>;
  }>;
  remarks: ExtractedField<string | null>;
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface DocumentJob {
  id: string;
  tenant_id: string;
  status: JobStatus;
  schema_id: string;
  created_at: string;
  updated_at: string;
  input: {
    text?: string;
    filename?: string;
    mime_type?: string;
    files?: { filename: string; mime_type?: string; content_base64?: string; text?: string }[];
  };
  result?: CanonicalExtraction;
  classify?: { document_type: DocumentType; confidence: number; language: DocumentLanguage };
  error?: string;
}

export interface Tenant {
  id: string;
  name: string;
  plan: 'starter' | 'standard' | 'business' | 'enterprise';
  monthly_doc_limit: number;
  active: boolean;
  created_at: string;
}

export interface ApiKeyRecord {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  raw_key_once?: string;
  created_at: string;
  revoked_at: string | null;
}

export interface UsageEvent {
  id: string;
  tenant_id: string;
  kind: 'classify' | 'extract' | 'job';
  units: number;
  meta?: Record<string, unknown>;
  created_at: string;
}

export interface Subscription {
  tenant_id: string;
  plan: Tenant['plan'];
  status: 'active' | 'past_due' | 'canceled';
  period_start: string;
  period_end: string;
}

export const CORE_SCHEMA_ID = 'core.quotation_request.v1';

export const PLAN_LIMITS: Record<Tenant['plan'], number> = {
  starter: 500,
  standard: 3000,
  business: 10000,
  enterprise: 100000,
};
