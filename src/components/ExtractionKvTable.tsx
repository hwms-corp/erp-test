import type { ReactNode } from 'react';
import type { CanonicalExtraction, ExtractedField, MailMessage } from '@/types/aiMail';
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

function sourceKindLabel(sourceFile: string | null, subject: string | null): string {
  if (!sourceFile || sourceFile === 'body' || sourceFile === 'mail_body' || sourceFile === 'email') {
    return '메일본문';
  }
  if (sourceFile === 'subject' || sourceFile === 'mail_subject') {
    return '메일제목';
  }
  return `첨부파일: ${sourceFile}`;
}

function SourceTooltip({
  mail,
  field,
  children,
}: {
  mail: MailMessage;
  field: ExtractedField;
  children: ReactNode;
}) {
  const bodyPreview = displayMailBody(mail).replace(/\s+/g, ' ').trim().slice(0, 220);
  const evidence = (field.evidence_text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const source = sourceKindLabel(field.source_file, mail.subject);

  return (
    <span className="relative group/value inline-block max-w-full">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 bottom-full z-30 mb-2 hidden w-80 max-w-[min(20rem,70vw)] rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-700 shadow-lg group-hover/value:block"
      >
        <div className="space-y-1.5">
          <p>
            <span className="text-slate-400">메일제목</span>
            <br />
            <span className="font-medium text-slate-800">{mail.subject || '(제목 없음)'}</span>
          </p>
          <p>
            <span className="text-slate-400">출처</span>
            <br />
            <span className="font-medium text-slate-800">{source}</span>
            {field.source_page != null && (
              <span className="text-slate-500"> · {field.source_page}페이지</span>
            )}
          </p>
          {field.original_key && (
            <p>
              <span className="text-slate-400">원문 키</span>
              <br />
              <span className="font-mono text-[11px] text-slate-700">{field.original_key}</span>
              {field.original_value != null && field.original_value !== '' && (
                <span className="text-slate-500"> → {String(field.original_value)}</span>
              )}
            </p>
          )}
          {evidence && (
            <p>
              <span className="text-slate-400">근거 문구</span>
              <br />
              <span className="text-slate-700">{evidence}{evidence.length >= 220 ? '…' : ''}</span>
            </p>
          )}
          {bodyPreview && (
            <p>
              <span className="text-slate-400">메일본문 (일부)</span>
              <br />
              <span className="text-slate-600">{bodyPreview}{bodyPreview.length >= 220 ? '…' : ''}</span>
            </p>
          )}
        </div>
      </span>
    </span>
  );
}

export function ExtractionKvTable({
  extraction,
  mail,
}: {
  extraction: CanonicalExtraction;
  mail: MailMessage;
}) {
  const rows = flattenExtractionRows(extraction);
  const withValue = rows.filter(r => r.valueDisplay !== '—');
  const display = withValue.length ? withValue : rows;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-800">추출 상세 (키 · 값)</h3>
        <p className="text-xs text-slate-400">값에 마우스를 올리면 출처를 볼 수 있습니다</p>
      </div>
      <div className="overflow-x-auto border border-slate-100 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left w-24">구분</th>
              <th className="px-3 py-2 text-left w-[30%]">키</th>
              <th className="px-3 py-2 text-left">값</th>
              <th className="px-3 py-2 text-right w-20">신뢰도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {display.map(row => (
              <tr key={row.id} className="hover:bg-slate-50/80">
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{row.group}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{row.keyLabel}</div>
                  {row.originalKey && (
                    <div className="text-[11px] text-slate-400 font-mono truncate" title={row.originalKey}>
                      {row.originalKey}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-800">
                  <SourceTooltip mail={mail} field={row.field}>
                    <span className="border-b border-dotted border-slate-300 cursor-help">
                      {row.valueDisplay}
                    </span>
                  </SourceTooltip>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
