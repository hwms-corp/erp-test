import { useState } from 'react';
import { MailPlus, Send, X } from 'lucide-react';
import { sendGmailMessage } from '@/lib/gmailMirror';

type Props = {
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
};

export function MailComposeModal({ open, onClose, onSent }: Props) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setTo('');
    setCc('');
    setSubject('');
    setBody('');
    setError(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    const toTrim = to.trim();
    if (!toTrim) {
      setError('받는 사람(To)을 입력하세요.');
      return;
    }
    if (!subject.trim() && !body.trim()) {
      setError('제목 또는 본문을 입력하세요.');
      return;
    }
    setBusy(true);
    setError(null);
    const { ok, error: err } = await sendGmailMessage({
      to: toTrim,
      cc: cc.trim() || undefined,
      subject: subject.trim(),
      body: body,
    });
    setBusy(false);
    if (!ok) {
      setError(err || '발송 실패');
      return;
    }
    reset();
    onClose();
    onSent?.();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="닫기" onClick={close} />
      <div
        role="dialog"
        aria-labelledby="mail-compose-title"
        className="relative w-full sm:max-w-xl max-h-[min(92vh,40rem)] overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl flex flex-col"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
          <MailPlus className="w-5 h-5 text-indigo-600 shrink-0" />
          <h3 id="mail-compose-title" className="text-sm font-bold text-slate-900">
            새 메일 작성
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
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">To</span>
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
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Cc</span>
            <input
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              placeholder="선택"
              value={cc}
              onChange={e => setCc(e.target.value)}
              disabled={busy}
            />
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
              className="mt-1 w-full min-h-[10rem] px-3 py-2 border border-slate-300 rounded-lg text-sm resize-y"
              value={body}
              onChange={e => setBody(e.target.value)}
              disabled={busy}
            />
          </label>
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
