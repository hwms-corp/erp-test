import { supabase } from '@/lib/supabase';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type GmailAttachmentFetchResult =
  | { ok: true; blob: Blob; filename: string; mimeType: string }
  | { ok: false; status: number; error: string };

/** Gmail 첨부 on-demand (Supabase Storage 없음 — Edge → Gmail API) */
export async function fetchGmailAttachment(attachmentId: number): Promise<GmailAttachmentFetchResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return { ok: false, status: 401, error: '로그인이 필요합니다' };
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, status: 500, error: 'Supabase 환경변수 없음' };
  }

  const url = `${supabaseUrl}/functions/v1/gmail-attachment?id=${attachmentId}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
    },
  });

  if (!res.ok) {
    let error = `첨부 조회 실패 (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) error = String(j.error);
    } catch {
      /* ignore */
    }
    return { ok: false, status: res.status, error };
  }

  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const mimeType = res.headers.get('content-type') || blob.type || 'application/octet-stream';
  let filename = 'attachment';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="([^"]+)"/i.exec(cd);
  if (star?.[1]) filename = decodeURIComponent(star[1]);
  else if (plain?.[1]) filename = plain[1];

  return { ok: true, blob, filename, mimeType };
}

export function isPreviewableMime(mime: string | null | undefined, filename: string): boolean {
  const m = (mime || '').toLowerCase();
  const f = filename.toLowerCase();
  if (m.startsWith('image/')) return true;
  if (m === 'application/pdf' || f.endsWith('.pdf')) return true;
  if (m.startsWith('text/') || f.endsWith('.txt') || f.endsWith('.csv')) return true;
  return false;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function isOcrCandidate(filename: string, mime: string | null | undefined): boolean {
  const m = (mime || '').toLowerCase();
  const f = filename.toLowerCase();
  if (/\.(zip|exe|dll|bat|cmd|msi|js|vbs)$/i.test(f)) return false;
  return (
    m.includes('pdf') ||
    f.endsWith('.pdf') ||
    m.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|tiff?)$/i.test(f) ||
    /\.(docx|xlsx|xlsm|xls|doc|eml|txt|csv)$/i.test(f) ||
    m.includes('spreadsheet') ||
    m.includes('wordprocessingml') ||
    m.includes('msword') ||
    m.includes('officedocument')
  );
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const MAX_OCR_FILES = 5;
const MAX_OCR_BYTES = 8 * 1024 * 1024;

/** 재실행용: Gmail에서 OCR 후보 첨부만 base64로 수집 */
export async function collectOcrFilesFromAttachments(
  attachments: { id: number; filename: string; mime_type: string | null; size_bytes: number | null; gmail_attachment_id?: string | null }[],
): Promise<{ filename: string; mime_type?: string; content_base64: string }[]> {
  const files: { filename: string; mime_type?: string; content_base64: string }[] = [];
  for (const att of attachments) {
    if (files.length >= MAX_OCR_FILES) break;
    if (!att.gmail_attachment_id) continue;
    if (!isOcrCandidate(att.filename, att.mime_type)) continue;
    if (att.size_bytes != null && att.size_bytes > MAX_OCR_BYTES) continue;
    const result = await fetchGmailAttachment(att.id);
    if (!result.ok) continue;
    if (result.blob.size > MAX_OCR_BYTES) continue;
    const content_base64 = await blobToBase64(result.blob);
    files.push({
      filename: result.filename || att.filename,
      mime_type: result.mimeType || att.mime_type || undefined,
      content_base64,
    });
  }
  return files;
}
