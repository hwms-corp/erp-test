import { useEffect, useRef, useState } from 'react';
import { MailPlus, Paperclip, Reply, Forward, Send, X } from 'lucide-react';
import { sendGmailMessage, type SendAttachment } from '@/lib/gmailMirror';

export type ComposeMode = 'compose' | 'reply' | 'forward';

export type ComposeDraft = {
  mode?: ComposeMode;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSent?: (info?: { subject: string; to: string }) => void;
  draft?: ComposeDraft | null;
};

const MAX_ATTACH_BYTES = 18 * 1024 * 1024;

async function fileToAttachment(file: File): Promise<SendAttachment> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    filename: file.name,
    mime_type: file.type || 'application/octet-stream',
    content_base64: btoa(binary),
  };
}

function titleFor(mode: ComposeMode) {
  if (mode === 'reply') return '답장';
  if (mode === 'forward') return '전달';
  return '새 메일 작성';
}

export function MailComposeModal({ open, onClose, onSent, draft }: Props) {
  const mode = draft?.mode || 'compose';
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTo(draft?.to || '');
    setCc(draft?.cc || '');
    setSubject(draft?.subject || '');
    setBody(draft?.body || '');
    setFiles([]);
    setError(null);
  }, [open, draft]);

  if (!open) return null;

  const reset = () => {
    setTo('');
    setCc('');
    setSubject('');
    setBody('');
    setFiles([]);
    setError(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files, ...Array.from(list)];
    const total = next.reduce((s, f) => s + f.size, 0);
    if (total > MAX_ATTACH_BYTES) {
      setError('첨부 합계는 약 18MB 이하로 해 주세요.');
      return;
    }
    setFiles(next);
    setError(null);
  };

  const submit = async () => {
    const toTrim = to.trim();
    if (!toTrim && mode !== 'forward') {
      // forward도 To 필요
    }
    if (!toTrim) {
      setError('받는 사람(To)을 입력하세요.');
      return;
    }
    if (!subject.trim() && !body.trim() && files.length === 0) {
      setError('제목·본문 또는 첨부를 입력하세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const attachments = files.length
        ? await Promise.all(files.map(fileToAttachment))
        : undefined;
      const { ok, error: err } = await sendGmailMessage({
        to: toTrim,
        cc: cc.trim() || undefined,
        subject: subject.trim(),
        body,
        threadId: draft?.threadId || undefined,
        inReplyTo: draft?.inReplyTo || undefined,
        references: draft?.references || undefined,
        attachments,
      });
      if (!ok) {
        setError(err || '발송 실패');
        setBusy(false);
        return;
      }
      reset();
      onClose();
      onSent?.({ subject: subject.trim() || '(제목 없음)', to: toTrim });
    } catch (e) {
      setError((e as Error).message || '발송 실패');
    } finally {
      setBusy(false);
    }
  };

  const Icon = mode === 'reply' ? Reply : mode === 'forward' ? Forward : MailPlus;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="닫기" onClick={close} />
      <div
        role="dialog"
        aria-labelledby="mail-compose-title"
        className="relative w-full sm:max-w-xl max-h-[min(92vh,42rem)] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl flex flex-col"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
          <Icon className="w-5 h-5 text-indigo-600 shrink-0" />
          <h3 id="mail-compose-title" className="text-sm font-bold text-slate-900">
            {titleFor(mode)}
          </h3>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="ml-auto p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/80"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">To (받는 사람)</span>
            <input
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              placeholder="email@example.com"
              value={to}
              onChange={e => setTo(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 tracking-wide">참조</span>
            <input
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              placeholder="같이 받을 사람 (선택)"
              value={cc}
              onChange={e => setCc(e.target.value)}
              disabled={busy}
            />
            <span className="mt-1 block text-[11px] text-slate-400">
              참조: 본 수신자 외에 내용을 같이 볼 사람에게 보냅니다.
            </span>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">제목</span>
            <input
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">본문</span>
            <textarea
              className="mt-1 w-full min-h-[9rem] px-3 py-2 border border-slate-300 rounded-lg text-sm resize-y"
              value={body}
              onChange={e => setBody(e.target.value)}
              disabled={busy}
            />
          </label>

          <div>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => {
                onPickFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Paperclip className="w-4 h-4" />
              파일 첨부
            </button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5"
                  >
                    <Paperclip className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="tabular-nums text-slate-400 shrink-0">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      className="text-slate-400 hover:text-red-600"
                      onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                      aria-label="첨부 제거"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-white">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="px-3 py-2 rounded-xl text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {busy ? '발송 중…' : '보내기'}
          </button>
        </div>
      </div>
    </div>
  );
}
