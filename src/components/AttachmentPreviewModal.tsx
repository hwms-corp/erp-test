import { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import * as XLSX from 'xlsx';

export type AttachmentPreviewKind = 'image' | 'pdf' | 'excel' | 'text' | 'other';

export function detectPreviewKind(mime: string, filename: string): AttachmentPreviewKind {
  const m = (mime || '').toLowerCase();
  const f = filename.toLowerCase();
  if (m.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(f)) return 'image';
  if (m.includes('pdf') || f.endsWith('.pdf')) return 'pdf';
  if (
    f.endsWith('.xlsx') ||
    f.endsWith('.xlsm') ||
    f.endsWith('.xls') ||
    f.endsWith('.csv') ||
    m.includes('spreadsheet') ||
    m.includes('excel') ||
    m === 'text/csv'
  ) {
    return 'excel';
  }
  if (m.startsWith('text/') || f.endsWith('.txt') || f.endsWith('.eml')) return 'text';
  return 'other';
}

type Props = {
  filename: string;
  mimeType: string;
  blob: Blob;
  url: string;
  onClose: () => void;
  onDownload?: () => void;
};

type SheetView = {
  name: string;
  rows: string[][];
};

export function AttachmentPreviewModal({ filename, mimeType, blob, url, onClose, onDownload }: Props) {
  const kind = useMemo(() => detectPreviewKind(mimeType, filename), [mimeType, filename]);
  const [sheets, setSheets] = useState<SheetView[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [loadingExcel, setLoadingExcel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (kind !== 'excel') {
      setSheets([]);
      setExcelError(null);
      return;
    }
    setLoadingExcel(true);
    setExcelError(null);
    (async () => {
      try {
        const buf = await blob.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const parsed: SheetView[] = wb.SheetNames.map(name => {
          const sheet = wb.Sheets[name];
          const rows = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(sheet, {
            header: 1,
            defval: '',
            raw: false,
          }) as unknown as string[][];
          // 빈 행 정리: 전부 빈 문자열인 행은 끝에서 제거
          const trimmed = [...rows];
          while (trimmed.length && trimmed[trimmed.length - 1].every(c => String(c ?? '').trim() === '')) {
            trimmed.pop();
          }
          return { name, rows: trimmed };
        });
        if (!cancelled) {
          setSheets(parsed);
          setActiveSheet(0);
        }
      } catch (e) {
        if (!cancelled) setExcelError((e as Error).message || '엑셀 파싱 실패');
      } finally {
        if (!cancelled) setLoadingExcel(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, blob]);

  useEffect(() => {
    let cancelled = false;
    if (kind !== 'text') {
      setTextContent(null);
      return;
    }
    blob.text().then(t => {
      if (!cancelled) setTextContent(t);
    }).catch(() => {
      if (!cancelled) setTextContent('(텍스트를 읽을 수 없습니다)');
    });
    return () => {
      cancelled = true;
    };
  }, [kind, blob]);

  const current = sheets[activeSheet];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <h3 className="font-medium text-slate-800 truncate">{filename}</h3>
            <p className="text-xs text-slate-400 truncate">{mimeType || detectPreviewKind(mimeType, filename)}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" /> 다운로드
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {kind === 'excel' && sheets.length > 1 && (
          <div className="flex gap-1 px-3 pt-2 pb-1 overflow-x-auto border-b border-slate-100 shrink-0 bg-slate-50">
            {sheets.map((s, i) => (
              <button
                key={s.name}
                type="button"
                onClick={() => setActiveSheet(i)}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                  i === activeSheet
                    ? 'bg-white text-indigo-700 font-medium shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 bg-slate-100 overflow-auto p-2 sm:p-3">
          {kind === 'image' && (
            <img src={url} alt={filename} className="max-w-full max-h-[80vh] mx-auto object-contain rounded-lg bg-white" />
          )}

          {kind === 'pdf' && (
            <iframe
              title={filename}
              src={`${url}#toolbar=1&navpanes=0`}
              className="w-full h-[80vh] rounded-lg bg-white border border-slate-200"
            />
          )}

          {kind === 'text' && (
            <pre className="bg-white rounded-lg border border-slate-200 p-4 text-xs sm:text-sm text-slate-800 whitespace-pre-wrap break-words min-h-[40vh]">
              {textContent ?? '로딩 중…'}
            </pre>
          )}

          {kind === 'excel' && (
            <>
              {loadingExcel && (
                <div className="flex items-center justify-center h-48 text-sm text-slate-500">엑셀 불러오는 중…</div>
              )}
              {excelError && (
                <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
                  엑셀 미리보기 실패: {excelError}
                  <p className="mt-1 text-xs text-red-600">다운로드 후 Excel에서 열어 주세요.</p>
                </div>
              )}
              {!loadingExcel && !excelError && current && (
                <div className="bg-white rounded-lg border border-slate-200 overflow-auto max-h-[78vh]">
                  {current.rows.length === 0 ? (
                    <p className="p-6 text-sm text-slate-400 text-center">시트가 비어 있습니다.</p>
                  ) : (
                    <table className="w-full text-xs sm:text-sm border-collapse min-w-max">
                      <tbody>
                        {current.rows.map((row, ri) => (
                          <tr key={ri} className={ri === 0 ? 'bg-slate-50 font-medium sticky top-0' : 'hover:bg-slate-50/80'}>
                            <td className="px-2 py-1 border border-slate-100 text-slate-400 tabular-nums text-right w-10 sticky left-0 bg-inherit">
                              {ri + 1}
                            </td>
                            {row.map((cell, ci) => (
                              <td
                                key={ci}
                                className="px-2.5 py-1.5 border border-slate-100 text-slate-800 whitespace-pre-wrap max-w-[28rem] align-top"
                              >
                                {cell == null ? '' : String(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}

          {kind === 'other' && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
              <p className="text-sm text-slate-600">이 파일 형식은 브라우저에서 미리볼 수 없습니다.</p>
              {onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <Download className="w-4 h-4" /> 다운로드
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
