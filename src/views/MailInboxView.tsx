import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Mail, RefreshCw, Inbox, Plug, Trash2, Check, Minus, Star, Send, RotateCcw, FolderOpen, HelpCircle } from 'lucide-react';
import { Pagination } from '@/components/Pagination';
import { AiConnectionModal } from '@/components/AiConnectionModal';
import { MailGuideModal } from '@/components/MailGuideModal';
import { useAuth } from '@/hooks/useAuth';
import { useMail } from '@/hooks/useMail';
import { checkAiDocHealth, setAiDocConfig, type AiHealthStatus } from '@/lib/aiDocClient';
import { supabase } from '@/lib/supabase';
import type { GmailLabelRow, MailBoxId, MailMessage, MailProcessStatus } from '@/types/aiMail';

/** 한국시간 YYYY/MM/DD HH:mm:ss (개행 없음) */
function formatReceivedAtKst(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const s = d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  return s.replace(/-/g, '/');
}

/** 납품관리 세금계산서 미발행과 동일한 커스텀 체크박스 */
function MailSelectCheckbox({
  checked,
  indeterminate = false,
  onToggle,
  ariaLabel,
  className = '',
}: {
  checked: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      onClick={e => {
        e.stopPropagation();
        onToggle();
      }}
      className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors shrink-0 ${
        checked || indeterminate
          ? 'bg-violet-600 border-violet-600 text-white'
          : 'bg-white border-violet-300 text-transparent hover:border-violet-500'
      } ${className}`}
    >
      {indeterminate ? <Minus className="w-4 h-4" /> : <Check className="w-4 h-4" />}
    </button>
  );
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

const BOX_MAIN: { id: MailBoxId; label: string; icon: 'inbox' | 'all' | 'sent' | 'star' | 'trash' }[] = [
  { id: 'all', label: '전체메일함', icon: 'all' },
  { id: 'inbox', label: '받은메일함', icon: 'inbox' },
  { id: 'sent', label: '보낸메일함', icon: 'sent' },
  { id: 'starred', label: '즐겨찾기', icon: 'star' },
  { id: 'trash', label: '휴지통', icon: 'trash' },
];

const BOX_STATUS: { id: MailProcessStatus; label: string }[] = [
  { id: 'received', label: '수신' },
  { id: 'classifying', label: '분류중' },
  { id: 'extracting', label: '추출중' },
  { id: 'review_required', label: '검토필요' },
  { id: 'ready_auto', label: '자동후보' },
  { id: 'registered', label: '견적등록' },
  { id: 'rejected', label: '비견적' },
  { id: 'failed', label: '실패' },
];

function boxIcon(kind: (typeof BOX_MAIN)[number]['icon'], className = 'w-4 h-4') {
  if (kind === 'sent') return <Send className={className} />;
  if (kind === 'star') return <Star className={className} />;
  if (kind === 'trash') return <Trash2 className={className} />;
  if (kind === 'all') return <FolderOpen className={className} />;
  return <Inbox className={className} />;
}

export function MailInboxView() {
  const { user } = useAuth();
  const { fetchMails, fetchMailAiSettings, updateMailAiSettings, softDeleteMails, restoreMails, hardDeleteMails, setMailStarred, fetchGmailLabels } = useMail();
  const [mails, setMails] = useState<MailMessage[]>([]);
  const [gmailLabels, setGmailLabels] = useState<GmailLabelRow[]>([]);
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
  const [showGuide, setShowGuide] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  /** URL: box 우선, 구 status= 호환 */
  const boxParam = searchParams.get('box') || searchParams.get('status') || 'inbox';
  const box = boxParam as MailBoxId;
  const inTrash = box === 'trash';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const setBox = useCallback((next: MailBoxId) => {
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      n.set('box', next);
      n.delete('status');
      n.set('page', '1');
      return n;
    });
  }, [setSearchParams]);

  const currentBoxLabel = useMemo(() => {
    const main = BOX_MAIN.find(b => b.id === box);
    if (main) return main.label;
    const st = BOX_STATUS.find(b => b.id === box);
    if (st) return st.label;
    if (typeof box === 'string' && box.startsWith('label:')) {
      const id = box.slice('label:'.length);
      return gmailLabels.find(l => l.id === id)?.name || '라벨';
    }
    return '메일함';
  }, [box, gmailLabels]);

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

  const loadLabels = useCallback(async () => {
    const { data } = await fetchGmailLabels();
    setGmailLabels(data ?? []);
  }, [fetchGmailLabels]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const { data, count } = await fetchMails({
      box,
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
  }, [fetchMails, box, q, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadLabels(); }, [loadLabels]);
  useEffect(() => { setSelectedIds(new Set()); }, [box, q, page]);

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

  const toggleStar = async (id: number, currentlyStarred: boolean) => {
    if (inTrash) return;
    const next = !currentlyStarred;
    // 낙관적 UI
    setMails(prev => {
      const updated = prev.map(m =>
        m.id === id
          ? { ...m, is_starred: next, starred_at: next ? new Date().toISOString() : null }
          : m,
      );
      return [...updated].sort((a, b) => {
        const as = a.is_starred ? 1 : 0;
        const bs = b.is_starred ? 1 : 0;
        if (as !== bs) return bs - as;
        const at = a.starred_at ? new Date(a.starred_at).getTime() : 0;
        const bt = b.starred_at ? new Date(b.starred_at).getTime() : 0;
        if (at !== bt) return bt - at;
        return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
      });
    });
    const { error } = await setMailStarred(id, next);
    if (error) {
      // 롤백: 서버 기준으로 다시 로드
      void load({ silent: true });
    }
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length || deleteBusy) return;
    if (inTrash) {
      if (!confirm(`선택한 메일 ${ids.length}건을 받은/전체 메일함으로 복원할까요?\nGmail 휴지통에서도 함께 복원됩니다.`)) return;
      setDeleteBusy(true);
      const { error, count } = await restoreMails(ids);
      setDeleteBusy(false);
      if (error) {
        alert('복원 실패: ' + (error.message || '오류가 발생했습니다.'));
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
      return;
    }
    if (!confirm(`선택한 메일 ${ids.length}건을 휴지통으로 이동할까요?\nGmail 휴지통과 함께 맞춰집니다.`)) {
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

  const hardDeleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length || deleteBusy || !inTrash) return;
    if (!confirm(
      `선택한 메일 ${ids.length}건을 완전 삭제할까요?\nGmail과 ERP에서 영구 삭제되며 되돌릴 수 없습니다.`,
    )) return;
    setDeleteBusy(true);
    const { error, count } = await hardDeleteMails(ids);
    setDeleteBusy(false);
    if (error) {
      alert('완전 삭제 실패: ' + (error.message || '오류가 발생했습니다.'));
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

  const NavBtn = ({
    active,
    onClick,
    children,
    indent = false,
  }: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
    indent?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 rounded-lg text-left text-[13px] font-medium transition-colors ${
        indent ? 'pl-7 pr-2 py-1.5' : 'px-2.5 py-2'
      } ${
        active
          ? 'bg-indigo-600 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 sm:space-y-6 relative">
      {showGuide && <MailGuideModal open onClose={() => setShowGuide(false)} />}
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
            <span className="lg:hidden">{currentBoxLabel} · Gmail · AI 분류</span>
            <span className="hidden lg:inline">{currentBoxLabel} · Gmail 수집 · AI 분류/추출 · 견적 초안</span>
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
              onClick={() => setShowGuide(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              <HelpCircle className="w-3.5 h-3.5" /> 가이드
            </button>
            <button
              type="button"
              onClick={() => setShowAiModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              <Plug className="w-3.5 h-3.5" /> AI 연동
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || deleteBusy}
              onClick={() => void deleteSelected()}
              className={`inline-flex items-center justify-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-[clamp(0.65rem,2.4vw,0.875rem)] font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${
                inTrash ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {inTrash ? <RotateCcw className="w-[1em] h-[1em] shrink-0" /> : <Trash2 className="w-[1em] h-[1em] shrink-0" />}
              <span>
                {inTrash
                  ? `복원${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`
                  : `휴지통${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
              </span>
            </button>
            {inTrash && (
              <button
                type="button"
                disabled={selectedIds.size === 0 || deleteBusy}
                onClick={() => void hardDeleteSelected()}
                className="inline-flex items-center justify-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-[clamp(0.65rem,2.4vw,0.875rem)] font-medium bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Trash2 className="w-[1em] h-[1em] shrink-0" />
                <span>완전삭제{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => { void load(); void refreshAiHealth(); }}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-[clamp(0.65rem,2.4vw,0.875rem)] border border-slate-200 bg-white hover:bg-slate-50 whitespace-nowrap"
            >
              <RefreshCw className="w-[1em] h-[1em] shrink-0" /> 새로고침
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

      {/* 모바일: 메일함 선택 */}
      <div className="lg:hidden">
        <label className="sr-only" htmlFor="mail-box-select">메일함</label>
        <select
          id="mail-box-select"
          className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
          value={box}
          onChange={e => setBox(e.target.value as MailBoxId)}
        >
          <optgroup label="메일함">
            {BOX_MAIN.map(b => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </optgroup>
          <optgroup label="상태">
            {BOX_STATUS.map(b => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </optgroup>
          {gmailLabels.length > 0 && (
            <optgroup label="Label">
              {gmailLabels.map(l => (
                <option key={l.id} value={`label:${l.id}`}>{l.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 min-w-0 items-start">
        {/* 데스크톱 left 메뉴 */}
        <aside className="hidden lg:block w-52 shrink-0 sticky top-4 self-start">
          <nav className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm space-y-3">
            <div>
              <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">메일함</p>
              <div className="space-y-0.5">
                {BOX_MAIN.map(b => (
                  <NavBtn key={b.id} active={box === b.id} onClick={() => setBox(b.id)}>
                    <span className={box === b.id ? 'text-white' : 'text-slate-400'}>{boxIcon(b.icon)}</span>
                    <span className="truncate">{b.label}</span>
                  </NavBtn>
                ))}
              </div>
            </div>
            <div>
              <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">상태</p>
              <div className="space-y-0.5">
                {BOX_STATUS.map(b => (
                  <NavBtn key={b.id} active={box === b.id} onClick={() => setBox(b.id)} indent>
                    <span className="truncate">{b.label}</span>
                  </NavBtn>
                ))}
              </div>
            </div>
            <div>
              <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Label</p>
              {gmailLabels.length === 0 ? (
                <p className="px-2.5 py-1.5 text-[11px] text-slate-400 leading-snug">
                  Gmail 사용자 라벨 없음 (동기화 후 표시)
                </p>
              ) : (
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {gmailLabels.map(l => {
                    const id = `label:${l.id}` as MailBoxId;
                    return (
                      <NavBtn key={l.id} active={box === id} onClick={() => setBox(id)} indent>
                        <span className="truncate">{l.name}</span>
                      </NavBtn>
                    );
                  })}
                </div>
              )}
            </div>
          </nav>
        </aside>

        <div className="min-w-0 flex-1 w-full space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-slate-800 truncate">{currentBoxLabel}
              <span className="ml-2 text-xs font-normal text-slate-400 tabular-nums">{totalItems}건</span>
            </p>
            <input
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full min-w-0 sm:w-56"
              placeholder="제목/발신자 검색"
              defaultValue={q}
              key={q}
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
        <div className="flex items-center gap-2 px-1">
          <MailSelectCheckbox
            checked={allPageSelected}
            indeterminate={somePageSelected && !allPageSelected}
            onToggle={toggleSelectAll}
            ariaLabel="현재 페이지 전체 선택"
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
                <MailSelectCheckbox
                  checked={checked}
                  onToggle={() => toggleSelectOne(m.id)}
                  ariaLabel={`${m.subject || '메일'} 선택`}
                  className="mt-0.5"
                />
                <button
                  type="button"
                  className={`mt-0.5 p-0.5 shrink-0 ${m.is_starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
                  aria-label={m.is_starred ? '즐겨찾기 해제' : '즐겨찾기'}
                  aria-pressed={!!m.is_starred}
                  onClick={e => {
                    e.stopPropagation();
                    void toggleStar(m.id, !!m.is_starred);
                  }}
                >
                  <Star className={`w-5 h-5 ${m.is_starred ? 'fill-amber-400' : ''}`} />
                </button>
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
      <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-2 py-2 w-11 text-center">
                <div className="flex justify-center">
                  <MailSelectCheckbox
                    checked={allPageSelected}
                    indeterminate={somePageSelected && !allPageSelected}
                    onToggle={toggleSelectAll}
                    ariaLabel="현재 페이지 전체 선택"
                  />
                </div>
              </th>
              <th className="px-1 py-2 w-10 text-center" aria-label="즐겨찾기">
                <Star className="w-3.5 h-3.5 mx-auto text-slate-300" />
              </th>
              <th className="px-3 py-2">제목</th>
              <th className="px-2 py-2 w-[16%]">발신자</th>
              <th className="px-2 py-2 w-[10.5rem] whitespace-nowrap">수신시각</th>
              <th className="px-2 py-2 w-[5.75rem]">상태</th>
              <th className="px-2 py-2 w-[4.25rem] text-right">신뢰도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">로딩 중…</td></tr>
            )}
            {!loading && mails.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">메일이 없습니다.</td></tr>
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
                  <td className="px-2 py-1.5 text-center align-middle">
                    <div className="flex justify-center">
                      <MailSelectCheckbox
                        checked={checked}
                        onToggle={() => toggleSelectOne(m.id)}
                        ariaLabel={`${m.subject || '메일'} 선택`}
                      />
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-center align-middle">
                    <button
                      type="button"
                      className={`p-1 ${m.is_starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
                      aria-label={m.is_starred ? '즐겨찾기 해제' : '즐겨찾기'}
                      aria-pressed={!!m.is_starred}
                      onClick={e => {
                        e.stopPropagation();
                        void toggleStar(m.id, !!m.is_starred);
                      }}
                    >
                      <Star className={`w-4 h-4 mx-auto ${m.is_starred ? 'fill-amber-400' : ''}`} />
                    </button>
                  </td>
                  <td className={`px-3 py-1.5 align-middle ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
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
                  <td className="px-2 py-1.5 text-slate-600 align-middle">
                    <span className="block truncate" title={m.from_addr || undefined}>
                      {m.from_addr || '—'}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap tabular-nums text-[13px] align-middle">
                    {formatReceivedAtKst(m.received_at)}
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_TONE[m.process_status]}`}>
                      {STATUS_LABEL[m.process_status]}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 align-middle">
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
        </div>
      </div>
    </motion.div>
  );
}
