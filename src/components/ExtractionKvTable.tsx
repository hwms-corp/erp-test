import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { CanonicalExtraction, ExtractedField, MailAttachment, MailMessage } from '@/types/aiMail';
import { displayMailBody } from '@/lib/mailBody';

type KvRow = {
  id: string;
  group: string;
  keyLabel: string;
  originalKey: string | null;
  valueDisplay: string;
  confidence: number | null;
  field: ExtractedField;
};

const FIELD_LABELS: Record<string, string> = {
  'customer.name': '거래처명',
  'customer.contact_name': '거래처 담당자',
  'customer.email': '거래처 이메일',
  'customer.tel': '거래처 전화',
  'customer.biz_no': '사업자번호',
  'customer.addr': '거래처 주소',
  'request.document_no': '문서번호',
  'request.request_date': '의뢰일',
  'request.delivery_date': '납기',
  'request.currency': '통화',
  'request.vessel': '선명',
  'request.contact_person': '담당자',
  'remarks': '비고',
  'product_name': '품명',
  'product_code': '품번',
  'specification': '사양',
  'quantity': '수량',
  'unit': '단위',
  'requested_price': '요청단가',
  'remark': '품목비고',
};

const BODY_SOURCE_TOKENS = new Set([
  '',
  'body',
  'body.txt',
  'mail_body',
  'email',
  'text',
  'mail',
  'input',
  '본문',
  '메일본문',
]);

const SUBJECT_SOURCE_TOKENS = new Set([
  'subject',
  'mail_subject',
  'title',
  '제목',
  '메일제목',
]);

function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function pushField(
  rows: KvRow[],
  group: string,
  path: string,
  keyLabel: string,
  field: ExtractedField | null | undefined,
) {
  if (!field) return;
  rows.push({
    id: path,
    group,
    keyLabel,
    originalKey: field.original_key,
    valueDisplay: fmtValue(field.value),
    confidence: typeof field.confidence === 'number' ? field.confidence : null,
    field,
  });
}

export function flattenExtractionRows(extraction: CanonicalExtraction): KvRow[] {
  const rows: KvRow[] = [];
  pushField(rows, '거래처', 'customer.name', FIELD_LABELS['customer.name'], extraction.customer.name);
  pushField(rows, '거래처', 'customer.contact_name', FIELD_LABELS['customer.contact_name'], extraction.customer.contact_name);
  pushField(rows, '거래처', 'customer.email', FIELD_LABELS['customer.email'], extraction.customer.email);
  pushField(rows, '거래처', 'customer.tel', FIELD_LABELS['customer.tel'], extraction.customer.tel);
  pushField(rows, '거래처', 'customer.biz_no', FIELD_LABELS['customer.biz_no'], extraction.customer.biz_no);
  pushField(rows, '거래처', 'customer.addr', FIELD_LABELS['customer.addr'], extraction.customer.addr);

  pushField(rows, '의뢰', 'request.document_no', FIELD_LABELS['request.document_no'], extraction.request.document_no);
  pushField(rows, '의뢰', 'request.request_date', FIELD_LABELS['request.request_date'], extraction.request.request_date);
  pushField(rows, '의뢰', 'request.delivery_date', FIELD_LABELS['request.delivery_date'], extraction.request.delivery_date);
  pushField(rows, '의뢰', 'request.currency', FIELD_LABELS['request.currency'], extraction.request.currency);
  pushField(rows, '의뢰', 'request.vessel', FIELD_LABELS['request.vessel'], extraction.request.vessel);
  pushField(rows, '의뢰', 'request.contact_person', FIELD_LABELS['request.contact_person'], extraction.request.contact_person);

  extraction.items.forEach((item, i) => {
    const g = `품목 ${i + 1}`;
    const p = `items[${i}]`;
    pushField(rows, g, `${p}.product_name`, FIELD_LABELS.product_name, item.product_name);
    pushField(rows, g, `${p}.product_code`, FIELD_LABELS.product_code, item.product_code);
    pushField(rows, g, `${p}.specification`, FIELD_LABELS.specification, item.specification);
    pushField(rows, g, `${p}.quantity`, FIELD_LABELS.quantity, item.quantity);
    pushField(rows, g, `${p}.unit`, FIELD_LABELS.unit, item.unit);
    pushField(rows, g, `${p}.requested_price`, FIELD_LABELS.requested_price, item.requested_price);
    pushField(rows, g, `${p}.remark`, FIELD_LABELS.remark, item.remark);
  });

  pushField(rows, '기타', 'remarks', FIELD_LABELS.remarks, extraction.remarks);
  return rows;
}

function compact(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

function containsLoose(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n || n.length < 2) return false;
  if (haystack.includes(n)) return true;
  const h = compact(haystack);
  const c = compact(n);
  return c.length >= 2 && h.includes(c);
}

/** 모델 source_file + 근거문구로 메일제목/본문/첨부를 판별 */
export function resolveFieldSource(
  field: ExtractedField,
  mail: MailMessage,
  attachments: MailAttachment[] = [],
): string {
  const raw = (field.source_file || '').trim();
  const token = raw.toLowerCase();
  const evidence = (
    field.evidence_text
    || field.original_value
    || (field.value != null && field.value !== '' ? String(field.value) : '')
  ).trim();
  const subject = (mail.subject || '').trim();
  const body = displayMailBody(mail);
  const pageSuffix = field.source_page != null && field.source_page > 0
    ? ` · ${field.source_page}페이지`
    : '';

  const namedAtt = attachments.find(a => {
    const fn = (a.filename || '').trim();
    if (!fn) return false;
    return fn === raw || fn.toLowerCase() === token;
  });
  if (namedAtt) {
    return `첨부파일: ${namedAtt.filename}${pageSuffix}`;
  }

  if (SUBJECT_SOURCE_TOKENS.has(token)) {
    return '메일제목';
  }

  // 명시적 파일명(구 토큰 제외) → 첨부
  if (raw && !BODY_SOURCE_TOKENS.has(token) && !SUBJECT_SOURCE_TOKENS.has(token)) {
    return `첨부파일: ${raw}${pageSuffix}`;
  }

  // source_file이 비어 있거나 input/body 등 모호한 경우 → 근거문구로 위치 추론
  if (evidence) {
    if (subject && containsLoose(subject, evidence)) return '메일제목';
    if (body && containsLoose(body, evidence)) return '메일본문';
  }

  if (BODY_SOURCE_TOKENS.has(token) || !raw) {
    if (body.trim()) return '메일본문';
    if (attachments.length === 1) {
      return `첨부파일: ${attachments[0].filename || '첨부'}${pageSuffix}`;
    }
    if (attachments.length > 1) return `첨부파일${pageSuffix}`;
    return '메일본문';
  }

  return raw ? `첨부파일: ${raw}${pageSuffix}` : '출처 미상';
}

function evidenceSnippet(field: ExtractedField): string {
  const e = (field.evidence_text || '').trim();
  if (e) return e;
  const ov = (field.original_value || '').trim();
  if (ov) return ov;
  if (field.value != null && field.value !== '') return String(field.value);
  return '';
}

function SourceEvidenceModal({
  mail,
  row,
  attachments,
  onClose,
}: {
  mail: MailMessage;
  row: KvRow;
  attachments: MailAttachment[];
  onClose: () => void;
}) {
  const field = row.field;
  const source = resolveFieldSource(field, mail, attachments);
  const evidence = evidenceSnippet(field);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[85vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-400">{row.group} · {row.keyLabel}</p>
            <h3 className="font-semibold text-slate-900 truncate">출처 · 매칭 근거</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2">
            <p className="text-[11px] text-indigo-500 mb-0.5">추출 값</p>
            <p className="font-medium text-indigo-950 break-words">{row.valueDisplay}</p>
          </div>

          <div>
            <p className="text-[11px] text-slate-400 mb-0.5">출처</p>
            <p className="text-slate-800 font-medium">{source}</p>
          </div>

          <div>
            <p className="text-[11px] text-slate-400 mb-0.5">근거 문구</p>
            <p className="text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded-xl p-3 text-xs leading-relaxed">
              {evidence || '(근거 문구 없음 — 모델이 evidence를 비웠을 수 있습니다)'}
            </p>
          </div>

          <div>
            <p className="text-[11px] text-slate-400 mb-0.5">필드 신뢰도</p>
            <p className="text-slate-800 tabular-nums">
              {row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '—'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExtractionKvTable({
  extraction,
  mail,
  attachments = [],
  className = '',
}: {
  extraction: CanonicalExtraction;
  mail: MailMessage;
  attachments?: MailAttachment[];
  className?: string;
}) {
  const rows = useMemo(() => flattenExtractionRows(extraction), [extraction]);
  const withValue = rows.filter(r => r.valueDisplay !== '—');
  const display = withValue.length ? withValue : rows;
  const [active, setActive] = useState<KvRow | null>(null);

  return (
    <section className={`bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 space-y-3 min-w-0 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <h3 className="font-semibold text-slate-800 text-sm sm:text-base">키 · 값 매칭</h3>
        <p className="text-[11px] sm:text-xs text-slate-400">값을 클릭하면 출처·근거를 봅니다</p>
      </div>
      <div className="overflow-x-auto border border-slate-100 rounded-xl -mx-0.5">
        {/* 모바일: table-fixed로 키 폭 확보 / lg+: 자동 배분 */}
        <table className="w-full text-xs sm:text-sm max-lg:table-fixed">
          <colgroup>
            <col className="max-lg:w-[16%]" />
            <col className="max-lg:w-[36%]" />
            <col className="max-lg:w-[30%]" />
            <col className="max-lg:w-[18%]" />
          </colgroup>
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 sm:px-3 py-2 text-left whitespace-nowrap">구분</th>
              <th className="px-2.5 sm:px-3 py-2 text-left">키</th>
              <th className="px-2 sm:px-3 py-2 text-left">값</th>
              <th className="px-1.5 sm:px-3 py-2 text-right whitespace-nowrap">신뢰도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {display.map(row => (
              <tr key={row.id} className="hover:bg-slate-50/80">
                <td className="px-2 sm:px-3 py-2 text-slate-400 align-top break-keep">{row.group}</td>
                <td className="px-2.5 sm:px-3 py-2 align-top min-w-0">
                  <div className="font-medium text-slate-800 break-keep">{row.keyLabel}</div>
                  {row.originalKey && (
                    <div className="mt-0.5 text-[10px] sm:text-[11px] text-slate-400 font-mono truncate" title={row.originalKey}>
                      {row.originalKey}
                    </div>
                  )}
                </td>
                <td className="px-2 sm:px-3 py-2 text-slate-800 align-top min-w-0">
                  <button
                    type="button"
                    onClick={() => setActive(row)}
                    className="text-left border-b border-dotted border-indigo-300 text-indigo-800 hover:text-indigo-950 break-words max-w-full"
                  >
                    {row.valueDisplay}
                  </button>
                </td>
                <td className="px-1.5 sm:px-3 py-2 text-right tabular-nums text-slate-500 align-top whitespace-nowrap">
                  {row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {active && (
        <SourceEvidenceModal
          mail={mail}
          row={active}
          attachments={attachments}
          onClose={() => setActive(null)}
        />
      )}
    </section>
  );
}
