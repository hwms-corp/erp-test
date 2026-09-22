import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Mail, RefreshCw, Inbox, Plug } from 'lucide-react';
import { Pagination } from '@/components/Pagination';
import { AiConnectionModal } from '@/components/AiConnectionModal';
import { useAuth } from '@/hooks/useAuth';
import { useMail } from '@/hooks/useMail';
import { checkAiDocHealth, setAiDocConfig, type AiHealthStatus } from '@/lib/aiDocClient';
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

const PAGE_SIZE = 20;

const AI_STATUS_LABEL: Record<AiHealthStatus, string> = {
  checking: '확인 중…',
  online: 'Mail API 정상 동작',
  offline: 'AI 연결 안 됨',
  unauthorized: 'API Key 오류',
  unconfigured: '미설정',
};

const AI_STATUS_TONE: Record<AiHealthStatus, string> = {
  checking: 'bg-slate-100 text-slate-600 border-slate-200',
  online: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  offline: 'bg-red-50 text-red-700 border-red-200',
  unauthorized: 'bg-amber-50 text-amber-800 border-amber-200',
  unconfigured: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function MailInboxView() {
  const { user } = useAuth();
  const { fetchMails, fetchMailAiSettings, updateMailAiSettings } = useMail();
  const [mails, setMails] = useState<MailMessage[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [justArrivedIds, setJustArrivedIds] = useState<Set<number>>(new Set());
  const [autoRegister, setAutoRegister] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [aiStatus, setAiStatus] = useState<AiHealthStatus>('checking');
  const [aiDetail, setAiDetail] = useState<string | undefined>();
  const [showAiModal, setShowAiModal] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const status = searchParams.get('status') || '';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const refreshAiHealth = useCallback(async () => {
    setAiStatus('checking');
    const r = await checkAiDocHealth();
    setAiStatus(r.status);
    setAiDetail(r.detail);
  }, []);

  const loadSettings = useCallback(async () => {
    const { data } = await fetchMailAiSettings();
    setAutoRegister(!!data?.auto_register_draft);
    const url = data?.api_base_url?.trim() || '';
    const key = data?.api_key?.trim() || '';
    setApiBaseUrl(url);
    setApiKey(key);
    if (url || key) {
      setAiDocConfig({
        ...(url ? { apiBaseUrl: url } : {}),
        ...(key ? { apiKey: key } : {}),
      });
    }
    await refreshAiHealth();
  }, [fetchMailAiSettings, refreshAiHealth]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const { data, count } = await fetchMails({
      status: status || undefined,
      q: q || undefined,
      page,
      pageSize: PAGE_SIZE,
    });
    setMails(data ?? []);
    setTotalItems(count ?? 0);
    if (!opts?.silent) setLoading(false);
  }, [fetchMails, status, q, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);

  useEffect(() => {
    const channel = supabase
      .channel('mail_inbox_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mail_messages' },
        payload => {
          const row = payload.new as MailMessage;
          if (row?.id != null) {
            const id = Number(row.id);
            setJustArrivedIds(prev => {
              const next = new Set(prev);
              next.add(id);
              return next;
            });
            window.setTimeout(() => {
              setJustArrivedIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }, 1400);
          }
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
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mail_ai_settings' },
        payload => {
          const row = payload.new as {
            auto_register_draft?: boolean;
            api_base_url?: string | null;
            api_key?: string | null;
          };
          if (typeof row?.auto_register_draft === 'boolean') {
            setAutoRegister(row.auto_register_draft);
          }
          if (row.api_base_url != null || row.api_key != null) {
            const url = row.api_base_url?.trim() || '';
            const key = row.api_key?.trim() || '';
            setApiBaseUrl(url);
            setApiKey(key);
            setAiDocConfig({
              ...(url ? { apiBaseUrl: url } : {}),
              ...(key ? { apiKey: key } : {}),
            });
            void refreshAiHealth();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, refreshAiHealth]);

  const toggleAutoRegister = async () => {
    if (!isAdmin || !user || settingsBusy) return;
    const next = !autoRegister;
    setSettingsBusy(true);
    setAutoRegister(next);
    const { error } = await updateMailAiSettings({ auto_register_draft: next }, user.id);
    if (error) {
      setAutoRegister(!next);
      console.error(error);
    }
    setSettingsBusy(false);
  };

  const saveAiConnection = async (url: string, key: string) => {
    if (!isAdmin || !user) return '관리자만 저장할 수 있습니다';
    setSettingsBusy(true);
    const { error } = await updateMailAiSettings(
      { api_base_url: url, api_key: key },
      user.id,
    );
    setSettingsBusy(false);
    if (error) return error.message || '저장 실패';
    setApiBaseUrl(url);
    setApiKey(key);
    setAiDocConfig({ apiBaseUrl: url, apiKey: key });
    await refreshAiHealth();
    return null;
  };

  const statuses = useMemo(
    () => ['', 'received', 'review_required', 'ready_auto', 'registered', 'rejected', 'failed'],
    [],
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 relative">
      {showAiModal && (
        <AiConnectionModal
          initialUrl={apiBaseUrl}
          initialKey={apiKey}
          canEdit={isAdmin}
          busy={settingsBusy}
          onClose={() => setShowAiModal(false)}
          onSave={saveAiConnection}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-7 h-7 text-indigo-600" /> AI 메일함
          </h2>
          <p className="text-sm text-slate-500 mt-1">Gmail 견적의뢰 수집 · AI 분류/추출 · 견적 초안 등록</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              title={aiDetail || undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${AI_STATUS_TONE[aiStatus]}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  aiStatus === 'online' ? 'bg-emerald-500'
                    : aiStatus === 'checking' ? 'bg-slate-400 animate-pulse'
                      : aiStatus === 'unauthorized' ? 'bg-amber-500' : 'bg-red-500'
                }`}
              />
              {AI_STATUS_LABEL[aiStatus]}
            </span>
            <button
              type="button"
              onClick={() => setShowAiModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              <Plug className="w-3.5 h-3.5" /> AI 연동
            </button>
          </div>

          <div className="flex w-[15.5rem] shrink-0 items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-800">견적 자동등록</p>
              <p className="text-[11px] text-slate-500 whitespace-nowrap">
                {autoRegister ? '활성 · AI 검토대기로 저장' : '비활성 (기본)'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoRegister}
              aria-label="견적 자동등록"
              disabled={!isAdmin || settingsBusy}
              onClick={() => void toggleAutoRegister()}
              title={isAdmin ? '관리자만 변경 가능' : '관리자만 변경할 수 있습니다'}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                autoRegister ? 'bg-indigo-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                  autoRegister ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <button
            type="button"
            onClick={() => { void load(); void refreshAiHealth(); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" /> 새로고침
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
            {!loading && mails.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">메일이 없습니다.</td></tr>
            )}
            {!loading && mails.map(m => {
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
        pageSize={PAGE_SIZE}
      />
    </motion.div>
  );
}
