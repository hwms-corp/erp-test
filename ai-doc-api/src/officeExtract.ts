/**
 * Office / text 첨부 → 평문 추출 (mail-ai-api 전용)
 * PDF·이미지는 Vision 경로 유지
 */
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

export function isOfficeOrTextFile(filename?: string, mime?: string): boolean {
  const f = (filename || '').toLowerCase();
  const m = (mime || '').toLowerCase();
  if (/\.(zip|exe|dll|bat|cmd|msi)$/i.test(f)) return false;
  return (
    /\.(docx|xlsx|xlsm|xls|eml|txt|csv)$/i.test(f)
    || m.includes('wordprocessingml')
    || m.includes('spreadsheetml')
    || m.includes('ms-excel')
    || m.startsWith('text/')
    || m.includes('message/rfc822')
  );
}

export async function extractOfficeOrText(
  filename: string,
  mime: string | undefined,
  contentBase64: string,
): Promise<{ text: string | null; error?: string }> {
  const f = filename.toLowerCase();
  const m = (mime || '').toLowerCase();
  let buf: Buffer;
  try {
    buf = Buffer.from(contentBase64, 'base64');
  } catch {
    return { text: null, error: 'base64 decode failed' };
  }
  if (buf.length > 8 * 1024 * 1024) {
    return { text: null, error: 'file too large (>8MB)' };
  }

  try {
    if (f.endsWith('.docx') || m.includes('wordprocessingml')) {
      const r = await mammoth.extractRawText({ buffer: buf });
      const text = (r.value || '').trim();
      return text ? { text } : { text: null, error: 'docx empty' };
    }

    if (f.endsWith('.xlsx') || f.endsWith('.xlsm') || m.includes('spreadsheetml')) {
      const wb = new ExcelJS.Workbook();
      // exceljs typings expect Buffer-like
      await wb.xlsx.load(buf as never);
      const lines: string[] = [];
      wb.eachSheet(sheet => {
        lines.push(`## Sheet: ${sheet.name}`);
        sheet.eachRow(row => {
          const raw = row.values;
          const vals = Array.isArray(raw)
            ? raw.slice(1).map(v => (v == null ? '' : String(typeof v === 'object' && v && 'text' in (v as object) ? (v as { text: string }).text : v)))
            : [];
          if (vals.some(x => String(x).trim())) lines.push(vals.join('\t'));
        });
      });
      const text = lines.join('\n').trim();
      return text ? { text } : { text: null, error: 'xlsx empty' };
    }

    if (f.endsWith('.xls')) {
      return { text: null, error: 'legacy .xls not supported — convert to .xlsx' };
    }

    if (f.endsWith('.eml') || f.endsWith('.txt') || f.endsWith('.csv') || m.startsWith('text/')) {
      return { text: buf.toString('utf8') };
    }
  } catch (e) {
    return { text: null, error: (e as Error).message };
  }

  return { text: null };
}
