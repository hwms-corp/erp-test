import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Mail, RefreshCw, Inbox } from 'lucide-react';
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

const NEW_HIGHLIGHT_MS = 12000;

export function MailInboxView() {
  const { fetchMails } = useMail();
  const [mails, setMails] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<{ count: number; subject?: string } | null>(null);
  const highlightTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const status = searchParams.get('status') || '';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);

  const markNew = useCallback((id: number, subject?: string | null) => {
    setNewIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setToast({ count: 1, subject: subject || undefined });

    const prevTimer = highlightTimers.current.get(id);
    if (prevTimer) clearTimeout(prevTimer);
    highlightTimers.current.set(
      id,
      setTimeout(() => {
        setNewIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        highlightTimers.current.delete(id);
      }, NEW_HIGHLIGHT_MS),
    );
  }, []);

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
          if (row?.id != null) markNew(Number(row.id), row.subject);
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
      for (const t of highlightTimers.current.values()) clearTimeout(t);
      highlightTimers.current.clear();
    };
  }, [load, markNew]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const { totalItems, totalPages, pageSize, getPage } = usePagination(mails, 15);
  const paged = getPage(page);

  const statuses = useMemo(
    () => ['', 'received', 'review_required', 'ready_auto', 'registered', 'rejected', 'failed'],
    [],
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 relative">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-20 right-6 z-50 max-w-sm rounded-xl border border-orange-200 bg-white shadow-lg px-4 py-3"
          >
            <p className="text-sm font-semibold text-orange-700">새 메일 도착</p>
            <p className="text-xs text-slate-600 mt-0.5 truncate">
              {toast.subject || '제목 없는 메일'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

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
              const isNew = newIds.has(m.id);
              return (
                <tr
                  key={m.id}
                  className={`hover:bg-slate-50 cursor-pointer ${isNew ? 'mail-row-new' : ''}`}
                  onClick={() => {
                    setNewIds(prev => {
                      const next = new Set(prev);
                      next.delete(m.id);
                      return next;
                    });
                    navigate(`/mail/${m.id}`);
                  }}
                >
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {formatYmdSlash((m.received_at || '').slice(0, 10))}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                      <Mail className={`w-4 h-4 shrink-0 ${isNew ? 'text-orange-500' : 'text-slate-400'}`} />
                      {isNew && (
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
