import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Mail, RefreshCw, Sparkles, Inbox } from 'lucide-react';
import { Pagination, usePagination } from '@/components/Pagination';
import { useMail } from '@/hooks/useMail';
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

export function MailInboxView() {
  const { fetchMails, upsertMail, runAiPipeline } = useMail();
  const [mails, setMails] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const status = searchParams.get('status') || '';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await fetchMails({ status: status || undefined, q: q || undefined });
    setMails(data ?? []);
    setLoading(false);
  }, [fetchMails, status, q]);

  useEffect(() => { load(); }, [load]);

  const { totalItems, totalPages, pageSize, getPage } = usePagination(mails, 15);
  const paged = getPage(page);

  const demoIngest = async () => {
    const sampleBody = [
      '제목: 견적의뢰 #DEMO',
      '거래처: 한진해운',
      '납기: 2026-10-15',
      '선명: MV DEMO-1',
      '담당: 김영업',
      '1. 품명: 밸브 / 사양: DN50 PN16 / 수량: 4 EA',
      '2. 품명: 가스켓 / 사양: ASME B16.20 / 수량: 2 SET',
      '비고: 긴급 요청',
    ].join('\n');

    const id = `demo-${Date.now()}`;
    const { data } = await upsertMail({
      gmail_message_id: id,
      gmail_thread_id: id,
      subject: '견적의뢰 #DEMO',
      from_addr: 'rfq@hanjin.example',
      to_addr: 'sales@haewon.example',
      snippet: '견적의뢰 데모 메일',
      body_text: sampleBody,
    });
    if (data) {
      setBusyId(data.id);
      await runAiPipeline(data);
      setBusyId(null);
      await load();
    }
  };

  const statuses = useMemo(
    () => ['', 'received', 'review_required', 'ready_auto', 'registered', 'rejected', 'failed'],
    [],
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-7 h-7 text-indigo-600" /> AI 메일함
          </h2>
          <p className="text-sm text-slate-500 mt-1">Gmail 견적의뢰 수집 · AI 분류/추출 · 견적 초안 등록</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" /> 새로고침
          </button>
          <button
            type="button"
            onClick={demoIngest}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <Sparkles className="w-4 h-4" /> 데모 메일+AI
          </button>
        </div>
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
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3">수신</th>
              <th className="px-4 py-3">제목</th>
              <th className="px-4 py-3">발신</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3 text-right">신뢰도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">로딩 중…</td></tr>
            )}
            {!loading && paged.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">메일이 없습니다. 데모 메일+AI로 테스트하세요.</td></tr>
            )}
            {paged.map(m => (
              <tr
                key={m.id}
                className="hover:bg-slate-50 cursor-pointer"
                onClick={() => navigate(`/mail/${m.id}`)}
              >
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {formatYmdSlash((m.received_at || '').slice(0, 10))}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-slate-400" />
                    {m.subject || '(제목 없음)'}
                    {busyId === m.id && <span className="text-xs text-amber-600">AI 처리중…</span>}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{m.from_addr || '—'}</td>
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
            ))}
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
