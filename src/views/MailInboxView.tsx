import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Mail, RefreshCw, Inbox, X } from 'lucide-react';
import { Pagination, usePagination } from '@/components/Pagination';
import { useMail } from '@/hooks/useMail';
import { supabase } from '@/lib/supabase';
import type { MailMessage, MailProcessStatus } from '@/types/aiMail';
import { formatYmdSlash } from '@/types';

const STATUS_LABEL: Record<MailProcessStatus, string> = {
  received: '수신',
  classifying: '분류중',
  extracting: '추출중',
  review_required: '검토필요',
  ready_auto: '자동후보',
  registered: '견적등록',
  rejected: '비견적',
  failed: '실패',
};

const STATUS_TONE: Record<MailProcessStatus, string> = {
  received: 'bg-slate-100 text-slate-700',
  classifying: 'bg-amber-50 text-amber-700',
  extracting: 'bg-amber-50 text-amber-700',
  review_required: 'bg-orange-50 text-orange-700',
  ready_auto: 'bg-emerald-50 text-emerald-700',
  registered: 'bg-indigo-50 text-indigo-700',
  rejected: 'bg-slate-100 text-slate-500',
  failed: 'bg-red-50 text-red-700',
};

/** 알림 카드 약 높이 + gap — 보이는 칸 3개 */
const TOAST_VISIBLE = 3;
const TOAST_CARD_H = 78;
const TOAST_GAP = 8;

type MailToast = {
  key: string;
  mailId: number;
  subject: string;
  fromAddr?: string;
};

export function MailInboxView() {
  const { fetchMails } = useMail();
  const [mails, setMails] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  /** 세션 중 막 도착한 메일 — 짧은 arrive 애니메이션용 */
  const [justArrivedIds, setJustArrivedIds] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<MailToast[]>([]);
  const toastScrollRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const status = searchParams.get('status') || '';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);

  const dismissToast = useCallback((key: string) => {
    setToasts(prev => prev.filter(t => t.key !== key));
  }, []);

  const pushToast = useCallback((mailId: number, subject?: string | null, fromAddr?: string | null) => {
    setToasts(prev => {
      if (prev.some(t => t.mailId === mailId)) return prev;
      return [...prev, {
        key: `${mailId}-${Date.now()}`,
        mailId,
        subject: subject?.trim() || '제목 없는 메일',
        fromAddr: fromAddr || undefined,
      }];
    });
  }, []);

  const markArrived = useCallback((id: number, subject?: string | null, fromAddr?: string | null) => {
    setJustArrivedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    pushToast(id, subject, fromAddr);
    window.setTimeout(() => {
      setJustArrivedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 1400);
  }, [pushToast]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const { data } = await fetchMails({ status: status || undefined, q: q || undefined });
    setMails(data ?? []);
    if (!opts?.silent) setLoading(false);
  }, [fetchMails, status, q]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('mail_inbox_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mail_messages' },
        payload => {
          const row = payload.new as MailMessage;
          if (row?.id != null) markArrived(Number(row.id), row.subject, row.from_addr);
          void load({ silent: true });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mail_messages' },
        () => { void load({ silent: true }); },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'mail_messages' },
        () => { void load({ silent: true }); },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, markArrived]);

  // 새 알림이 붙으면 맨 아래(최신)가 보이도록 스크롤
  useEffect(() => {
    const el = toastScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }, [toasts.length]);

  const { totalItems, totalPages, pageSize, getPage } = usePagination(mails, 15);
  const paged = getPage(page);

  const statuses = useMemo(
    () => ['', 'received', 'review_required', 'ready_auto', 'registered', 'rejected', 'failed'],
    [],
  );

  const toastMaxH = TOAST_VISIBLE * TOAST_CARD_H + (TOAST_VISIBLE - 1) * TOAST_GAP;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 relative">
      {/* 우하단 알림 스택: 아래=최신, 위=오래됨. 3칸 초과 시 스크롤 */}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 w-[22rem] max-w-[calc(100vw-2rem)]">
          <div
            ref={toastScrollRef}
            className="mail-toast-scroll pointer-events-auto flex flex-col justify-end gap-2 overflow-y-auto overscroll-contain pr-0.5"
            style={{ maxHeight: toastMaxH }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {toasts.map(t => (
                <motion.div
                  key={t.key}
                  layout
                  initial={{ opacity: 0, y: 28, filter: 'blur(2px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -18, filter: 'blur(2px)' }}
                  transition={{
                    layout: { type: 'spring', stiffness: 420, damping: 32 },
                    opacity: { duration: 0.28 },
                    y: { type: 'spring', stiffness: 380, damping: 28 },
                  }}
                  className="shrink-0 overflow-hidden rounded-xl border border-orange-200/80 bg-white/95 shadow-lg backdrop-blur-sm"
                  style={{ minHeight: TOAST_CARD_H - 6 }}
                >
                  <div className="flex items-start gap-2 px-4 py-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 flex items-start gap-2 text-left hover:opacity-90"
                      onClick={() => {
                        dismissToast(t.key);
                        navigate(`/mail/${t.mailId}`);
                      }}
                    >
                      <Mail className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-orange-700">새 메일 도착</p>
                        <p className="text-xs text-slate-800 mt-0.5 truncate font-medium">{t.subject}</p>
                        {t.fromAddr && (
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">{t.fromAddr}</p>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="p-0.5 text-slate-400 hover:text-slate-600 shrink-0"
                      aria-label="알림 닫기"
                      onClick={() => dismissToast(t.key)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-7 h-7 text-indigo-600" /> AI 메일함
          </h2>
          <p className="text-sm text-slate-500 mt-1">Gmail 견적의뢰 수집 · AI 분류/추출 · 견적 초안 등록</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white hover:bg-slate-50"
        >
          <RefreshCw className="w-4 h-4" /> 새로고침
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {statuses.map(s => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setSearchParams(prev => {
              const n = new URLSearchParams(prev);
              if (s) n.set('status', s); else n.delete('status');
              n.set('page', '1');
              return n;
            })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
              status === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {s ? STATUS_LABEL[s as MailProcessStatus] : '전체'}
          </button>
        ))}
        <input
          className="ml-auto px-3 py-2 border border-slate-300 rounded-lg text-sm w-56"
          placeholder="제목/발신자 검색"
          defaultValue={q}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim();
              setSearchParams(prev => {
                const n = new URLSearchParams(prev);
                if (v) n.set('q', v); else n.delete('q');
                n.set('page', '1');
                return n;
              });
            }
          }}
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 w-[7.5rem]">수신</th>
              <th className="px-4 py-3 w-[42%]">제목</th>
              <th className="px-4 py-3 w-[11rem]">발신</th>
              <th className="px-4 py-3 w-[6.5rem]">상태</th>
              <th className="px-4 py-3 w-[4.5rem] text-right">신뢰도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">로딩 중…</td></tr>
            )}
            {!loading && paged.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">메일이 없습니다.</td></tr>
            )}
            {paged.map(m => {
              const unread = m.is_read !== true;
              const justArrived = justArrivedIds.has(m.id);
              return (
                <tr
                  key={m.id}
                  className={`hover:bg-slate-50 cursor-pointer ${
                    unread ? `mail-row-unread${justArrived ? ' mail-row-arrive' : ''}` : ''
                  }`}
                  onClick={() => navigate(`/mail/${m.id}`)}
                >
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {formatYmdSlash((m.received_at || '').slice(0, 10))}
                  </td>
                  <td className={`px-4 py-3 ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                      <Mail className={`w-4 h-4 shrink-0 ${unread ? 'text-orange-500' : 'text-slate-400'}`} />
                      {unread && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded">
                          NEW
                        </span>
                      )}
                      <span className="truncate">{m.subject || '(제목 없음)'}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className="block truncate" title={m.from_addr || undefined}>
                      {m.from_addr || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_TONE[m.process_status]}`}>
                      {STATUS_LABEL[m.process_status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {m.extraction?.overall_confidence != null
                      ? `${Math.round(m.extraction.overall_confidence * 100)}%`
                      : m.classify_confidence != null
                        ? `${Math.round(Number(m.classify_confidence) * 100)}%`
                        : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={pg => setSearchParams(prev => {
          const n = new URLSearchParams(prev);
          n.set('page', String(pg));
          return n;
        })}
        totalItems={totalItems}
        pageSize={pageSize}
      />
    </motion.div>
  );
}
