import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Mail, RefreshCw, Inbox, Plug, Trash2 } from 'lucide-react';
import { Pagination } from '@/components/Pagination';
import { AiConnectionModal } from '@/components/AiConnectionModal';
import { useAuth } from '@/hooks/useAuth';
import { useMail } from '@/hooks/useMail';
import { checkAiDocHealth, setAiDocConfig, type AiHealthStatus } from '@/lib/aiDocClient';
import { supabase } from '@/lib/supabase';
import type { MailMessage, MailProcessStatus } from '@/types/aiMail';

/** 한국시간 YYYY/MM/DD HH:mm:ss (개행 없음) */
function formatReceivedAtKst(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const s = d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  return s.replace(/-/g, '/');
}

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
  const { fetchMails, fetchMailAiSettings, updateMailAiSettings, softDeleteMails } = useMail();
  const [mails, setMails] = useState<MailMessage[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [justArrivedIds, setJustArrivedIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
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
    setSelectedIds(prev => {
      const alive = new Set((data ?? []).map(m => m.id));
      const next = new Set<number>();
      prev.forEach(id => { if (alive.has(id)) next.add(id); });
      return next;
    });
    if (!opts?.silent) setLoading(false);
  }, [fetchMails, status, q, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { setSelectedIds(new Set()); }, [status, q, page]);

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

  const pageIds = useMemo(() => mails.map(m => m.id), [mails]);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
  const somePageSelected = pageIds.some(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (allPageSelected) return new Set();
      return new Set(pageIds);
    });
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length || deleteBusy) return;
    if (!confirm(`선택한 메일 ${ids.length}건을 삭제하시겠습니까?\n목록에서 숨겨지며 복구는 관리자 DB 작업이 필요합니다.`)) {
      return;
    }
    setDeleteBusy(true);
    const { error, count } = await softDeleteMails(ids);
    setDeleteBusy(false);
    if (error) {
      alert('삭제 실패: ' + (error.message || '오류가 발생했습니다.'));
      return;
    }
    setSelectedIds(new Set());
    if (count > 0 && mails.length === count && page > 1) {
      setSearchParams(prev => {
        const n = new URLSearchParams(prev);
        n.set('page', String(page - 1));
        return n;
      });
      return;
    }
    await load();
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 sm:space-y-6 relative">
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

      <div className="flex flex-col gap-3 min-w-0 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl lg:text-2xl font-bold text-slate-900 flex items-center gap-2 min-w-0">
            <Inbox className="w-6 h-6 lg:w-7 lg:h-7 text-indigo-600 shrink-0" />
            <span className="truncate">AI 메일함</span>
          </h2>
          <p className="text-xs lg:text-sm text-slate-500 mt-1">
            <span className="lg:hidden">Gmail 견적의뢰 · AI 분류/추출 · 견적 초안</span>
            <span className="hidden lg:inline">Gmail 견적의뢰 수집 · AI 분류/추출 · 견적 초안 등록</span>
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full min-w-0 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span
              title={aiDetail || undefined}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${AI_STATUS_TONE[aiStatus]}`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  aiStatus === 'online' ? 'bg-emerald-500'
                    : aiStatus === 'checking' ? 'bg-slate-400 animate-pulse'
                      : aiStatus === 'unauthorized' ? 'bg-amber-500' : 'bg-red-500'
                }`}
              />
              <span className="truncate">{AI_STATUS_LABEL[aiStatus]}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowAiModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              <Plug className="w-3.5 h-3.5" /> AI 연동
            </button>
            <button
              type="button"
              onClick={() => { void load(); void refreshAiHealth(); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" /> 새로고침
            </button>
          </div>

          <div className="flex w-full lg:w-[15.5rem] lg:shrink-0 items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 min-w-0">
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="text-xs font-semibold text-slate-800">견적 자동등록</p>
              <p className="text-[11px] text-slate-500 truncate lg:whitespace-nowrap">
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
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="flex gap-1.5 lg:gap-2 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 lg:overflow-visible lg:pb-0 lg:mx-0 lg:px-0">
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
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                status === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {s ? STATUS_LABEL[s as MailProcessStatus] : '전체'}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 w-full min-w-0 lg:ml-auto lg:w-auto lg:flex-row lg:items-center">
          <button
            type="button"
            disabled={selectedIds.size === 0 || deleteBusy}
            onClick={() => void deleteSelected()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed w-full lg:w-auto"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="truncate">메일선택삭제{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</span>
          </button>
          <input
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full min-w-0 lg:w-56"
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
      </div>

      {/* 모바일·태블릿: 카드 리스트 / 데스크톱(lg+): 테이블 */}
      <div className="lg:hidden space-y-2">
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            checked={allPageSelected}
            ref={el => {
              if (el) el.indeterminate = somePageSelected && !allPageSelected;
            }}
            onChange={toggleSelectAll}
            aria-label="현재 페이지 전체 선택"
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-xs text-slate-500">전체 선택</span>
        </div>
        {loading && (
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-10 text-center text-slate-400 text-sm">
            로딩 중…
          </div>
        )}
        {!loading && mails.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-10 text-center text-slate-400 text-sm">
            메일이 없습니다.
          </div>
        )}
        {!loading && mails.map(m => {
          const unread = m.is_read !== true;
          const justArrived = justArrivedIds.has(m.id);
          const checked = selectedIds.has(m.id);
          const conf = m.extraction?.overall_confidence != null
            ? `${Math.round(m.extraction.overall_confidence * 100)}%`
            : m.classify_confidence != null
              ? `${Math.round(Number(m.classify_confidence) * 100)}%`
              : null;
          return (
            <div
              key={m.id}
              className={`bg-white rounded-2xl border border-slate-200 p-3 shadow-sm ${
                unread ? `mail-row-unread${justArrived ? ' mail-row-arrive' : ''}` : ''
              }`}
            >
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelectOne(m.id)}
                  aria-label={`${m.subject || '메일'} 선택`}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                  onClick={e => e.stopPropagation()}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => navigate(`/mail/${m.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`text-sm leading-snug line-clamp-2 ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                      <Mail className={`inline w-3.5 h-3.5 mr-1 align-text-top ${unread ? 'text-orange-500' : 'text-slate-400'}`} />
                      {unread && (
                        <span className="inline-block mr-1 text-[10px] font-bold uppercase tracking-wide text-orange-600 bg-orange-100 px-1 py-0.5 rounded align-middle">
                          NEW
                        </span>
                      )}
                      {m.subject || '(제목 없음)'}
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_TONE[m.process_status]}`}>
                      {STATUS_LABEL[m.process_status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 truncate">{m.from_addr || '—'}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="tabular-nums whitespace-nowrap">{formatReceivedAtKst(m.received_at)}</span>
                    {conf && <span className="tabular-nums">신뢰도 {conf}</span>}
                  </div>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 데스크톱: 테이블 */}
      <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-2 py-3 w-10 text-center">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  ref={el => {
                    if (el) el.indeterminate = somePageSelected && !allPageSelected;
                  }}
                  onChange={toggleSelectAll}
                  aria-label="현재 페이지 전체 선택"
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </th>
              <th className="px-3 py-3 w-[10.5rem] whitespace-nowrap">수신</th>
              <th className="px-4 py-3">제목</th>
              <th className="px-4 py-3 w-[11rem]">발신</th>
              <th className="px-4 py-3 w-[6.5rem]">상태</th>
              <th className="px-4 py-3 w-[4.5rem] text-right">신뢰도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">로딩 중…</td></tr>
            )}
            {!loading && mails.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">메일이 없습니다.</td></tr>
            )}
            {!loading && mails.map(m => {
              const unread = m.is_read !== true;
              const justArrived = justArrivedIds.has(m.id);
              const checked = selectedIds.has(m.id);
              return (
                <tr
                  key={m.id}
                  className={`hover:bg-slate-50 cursor-pointer ${
                    unread ? `mail-row-unread${justArrived ? ' mail-row-arrive' : ''}` : ''
                  }`}
                  onClick={() => navigate(`/mail/${m.id}`)}
                >
                  <td
                    className="px-2 py-3 text-center"
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelectOne(m.id)}
                      aria-label={`${m.subject || '메일'} 선택`}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-3 py-3 text-slate-500 whitespace-nowrap tabular-nums text-[13px]">
                    {formatReceivedAtKst(m.received_at)}
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
