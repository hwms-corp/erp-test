import { useCallback, useEffect, useMemo, useRef, useState, Children, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Mail, RefreshCw, Inbox, Plug, Trash2, Check, Minus, Star, Send, RotateCcw, FolderOpen, HelpCircle, MailPlus, MailOpen, Clock, ChevronLeft, ChevronRight, ChevronDown, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Pagination } from '@/components/Pagination';
import { AiConnectionModal } from '@/components/AiConnectionModal';
import { MailGuideModal } from '@/components/MailGuideModal';
import { MailComposeModal } from '@/components/MailComposeModal';
import { useAuth } from '@/hooks/useAuth';
import { useMail } from '@/hooks/useMail';
import { checkAiDocHealth, setAiDocConfig, type AiHealthStatus } from '@/lib/aiDocClient';
import { supabase } from '@/lib/supabase';
import type { GmailLabelRow, MailBoxId, MailMessage, MailProcessStatus } from '@/types/aiMail';
import { formatReceivedAtKst } from '@/lib/mailTime';

/** 전체메일함용 받은/보낸 표시 (fill=PC 테이블 세로 풀높이 + 색/테두리) */
function MailDirectionBadge({ sent, fill = false }: { sent: boolean; fill?: boolean }) {
  const label = sent ? '보냄' : '받음';
  const title = sent ? '보낸메일' : '받은메일';
  const icon = sent ? (
    <ArrowUpRight className={fill ? 'w-4 h-4 shrink-0' : 'w-3.5 h-3.5 shrink-0'} strokeWidth={2.75} aria-hidden />
  ) : (
    <ArrowDownLeft className={fill ? 'w-4 h-4 shrink-0' : 'w-3.5 h-3.5 shrink-0'} strokeWidth={2.75} aria-hidden />
  );
  const tone = sent
    ? 'bg-sky-50 text-sky-700 border-sky-200'
    : 'bg-emerald-200 text-emerald-900 border-emerald-400';

  if (fill) {
    return (
      <span
        className={`mail-dir-badge mail-dir-badge--fill absolute inset-0 z-[1] flex items-center justify-center border-r whitespace-nowrap ${tone}`}
        title={title}
      >
        {icon}
        {label}
      </span>
    );
  }

  return (
    <span
      className={`mail-dir-badge mail-dir-badge--chip inline-flex shrink-0 items-center justify-center rounded-md border px-1.5 py-0.5 leading-none whitespace-nowrap ${tone}`}
      title={title}
    >
      {icon}
      {label}
    </span>
  );
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
  received: '수신(미분류)',
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

const PAGE_SIZE = 30;
const STAR_PRIORITY_LS = 'erp_mail_star_priority';

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

const BOX_MAIN: { id: MailBoxId; label: string; icon: 'latest' | 'inbox' | 'all' | 'sent' | 'read' | 'unread' | 'star' | 'trash' }[] = [
  { id: 'latest', label: '최신메일함', icon: 'latest' },
  { id: 'all', label: '전체메일함', icon: 'all' },
  { id: 'inbox', label: '받은메일함', icon: 'inbox' },
  { id: 'sent', label: '보낸메일함', icon: 'sent' },
  { id: 'read', label: '읽은메일함', icon: 'read' },
  { id: 'unread', label: '안읽은메일함', icon: 'unread' },
  { id: 'starred', label: '즐겨찾기', icon: 'star' },
  { id: 'trash', label: '휴지통', icon: 'trash' },
];

const BOX_STATUS: { id: MailProcessStatus; label: string }[] = [
  { id: 'received', label: '수신(미분류)' },
  { id: 'classifying', label: '분류중' },
  { id: 'extracting', label: '추출중' },
  { id: 'review_required', label: '검토필요' },
  { id: 'ready_auto', label: '자동후보' },
  { id: 'registered', label: '견적등록' },
  { id: 'rejected', label: '비견적' },
  { id: 'failed', label: '실패' },
];

function boxIcon(kind: (typeof BOX_MAIN)[number]['icon'], className = 'w-4 h-4') {
  if (kind === 'latest') return <Clock className={`${className} text-indigo-500`} />;
  if (kind === 'sent') return <Send className={`${className} text-sky-600`} />;
  if (kind === 'read') return <MailOpen className={`${className} text-slate-500`} />;
  if (kind === 'unread') return <Mail className={`${className} text-orange-500`} />;
  if (kind === 'star') return <Star className={`${className} text-amber-400 fill-amber-400`} />;
  if (kind === 'trash') return <Trash2 className={`${className} text-red-500`} />;
  if (kind === 'all') return <FolderOpen className={`${className} text-slate-500`} />;
  // inbox
  return <Inbox className={`${className} text-emerald-600`} />;
}

/** 메일함 건수 타원 뱃지 — 긴 메뉴명 위 오른쪽 오버레이 */
function MailCountPill({
  count,
  active = false,
  tone = 'slate',
}: {
  count?: number;
  active?: boolean;
  tone?: 'slate' | 'violet' | 'chip' | 'chipActive';
}) {
  if (count == null) return null;
  const text = count.toLocaleString('ko-KR');
  const cls =
    tone === 'chipActive'
      ? 'bg-white/25 text-white'
      : tone === 'chip'
        ? 'bg-slate-200/90 text-slate-600'
        : tone === 'violet'
          ? active
            ? 'bg-violet-500 text-white'
            : 'bg-violet-100 text-violet-700'
          : active
            ? 'bg-indigo-100 text-indigo-700'
            : 'bg-slate-100 text-slate-500';
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-full px-1.5 min-w-[1.35rem] h-[1.15rem] text-[10px] font-semibold tabular-nums leading-none ${cls}`}
      aria-label={`${text}건`}
    >
      {text}
    </span>
  );
}

/** 메뉴명 + 오른쪽 끝 건수 (길면 메뉴명 위에 덮임) */
function NavLabelWithCount({
  label,
  count,
  active,
  tone = 'slate',
}: {
  label: string;
  count?: number;
  active?: boolean;
  tone?: 'slate' | 'violet';
}) {
  return (
    <span className="relative min-w-0 flex-1 overflow-hidden">
      <span className="block truncate">{label}</span>
      <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 shadow-sm rounded-full">
        <MailCountPill count={count} active={active} tone={tone} />
      </span>
    </span>
  );
}

/** 모바일 가로 칩 메뉴 — 넘치면 좌우 화살표로 스크롤 */
function MobileScrollChipRow({
  ariaLabel,
  children,
  className = '',
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 2);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => update()) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    // 칩 개수 변경 후 레이아웃 반영
    const t = window.setTimeout(update, 0);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      window.removeEventListener('resize', update);
      window.clearTimeout(t);
    };
  }, [update, children]);

  const scrollByDir = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(140, el.clientWidth * 0.55), behavior: 'smooth' });
  };

  const arrowCls =
    'shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 disabled:opacity-25 disabled:pointer-events-none hover:bg-slate-50 active:bg-slate-100';

  return (
    <div className={`flex items-center gap-0.5 min-w-0 ${className}`}>
      <button
        type="button"
        aria-label="왼쪽으로"
        disabled={!canLeft}
        onClick={() => scrollByDir(-1)}
        className={arrowCls}
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <div
        ref={ref}
        className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={ariaLabel}
      >
        <div className="flex w-max items-center gap-1.5 px-0.5">{children}</div>
      </div>
      <button
        type="button"
        aria-label="오른쪽으로"
        disabled={!canRight}
        onClick={() => scrollByDir(1)}
        className={arrowCls}
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function MailInboxView() {
  const { user } = useAuth();
  const { fetchMails, fetchMailAiSettings, updateMailAiSettings, softDeleteMails, restoreMails, hardDeleteMails, setMailStarred, setMailRead, fetchGmailLabels, fetchMailboxCounts } = useMail();
  const [mails, setMails] = useState<MailMessage[]>([]);
  const [gmailLabels, setGmailLabels] = useState<GmailLabelRow[]>([]);
  const [boxCounts, setBoxCounts] = useState<Record<string, number>>({});
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
  const [showCompose, setShowCompose] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  /** 전체/받은/보낸: 즐겨찾기 우선 정렬 (디폴트 ON) */
  const [starPriority, setStarPriority] = useState(() => {
    try {
      return localStorage.getItem(STAR_PRIORITY_LS) !== '0';
    } catch {
      return true;
    }
  });
  /** left 중메뉴 접기/펼치기 — 기본 전부 열림 */
  const [navOpen, setNavOpen] = useState({ folders: true, status: true, labels: true });
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const toggleNav = (key: keyof typeof navOpen) => {
    setNavOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleStarPriority = () => {
    setStarPriority(prev => {
      const next = !prev;
      try {
        localStorage.setItem(STAR_PRIORITY_LS, next ? '1' : '0');
      } catch { /* ignore */ }
      return next;
    });
  };

  const isAdmin = user?.role === 'admin';
  /** URL: box 우선, 구 status= 호환 — 기본은 최신메일함 */
  const boxParam = searchParams.get('box') || searchParams.get('status') || 'latest';
  const box = boxParam as MailBoxId;
  const inTrash = box === 'trash';
  const showDirection = box === 'all';
  const showStarColumn = box !== 'latest';
  const showStarPriorityToggle = box === 'all' || box === 'inbox' || box === 'sent';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  // 구분? + 체크 + 별? + 읽음 + 제목 + 발신 + 시각 + 상태 + 신뢰도
  const tableColSpan = (showDirection ? 1 : 0) + 1 + (showStarColumn ? 1 : 0) + 1 + 5;

  // 상세에서 발송 후 ?notice=sent 로 진입 시 완료 배너
  useEffect(() => {
    if (searchParams.get('notice') !== 'sent') return;
    const to = searchParams.get('to');
    setSendNotice(to ? `메일 전송이 완료되었습니다 → ${to}` : '메일 전송이 완료되었습니다.');
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      n.delete('notice');
      n.delete('to');
      return n;
    }, { replace: true });
    const t = window.setTimeout(() => setSendNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [searchParams, setSearchParams]);

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

  const loadCounts = useCallback(async () => {
    const { data } = await fetchMailboxCounts();
    if (data) setBoxCounts(data);
  }, [fetchMailboxCounts]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const { data, count } = await fetchMails({
      box,
      q: q || undefined,
      page,
      pageSize: PAGE_SIZE,
      starPriority: showStarPriorityToggle ? starPriority : undefined,
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
    void loadCounts();
  }, [fetchMails, box, q, page, showStarPriorityToggle, starPriority, loadCounts]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadLabels(); }, [loadLabels]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);
  useEffect(() => { setSelectedIds(new Set()); }, [box, q, page]);

  const countsRefreshTimer = useRef<number | null>(null);
  const scheduleCountsRefresh = useCallback(() => {
    if (countsRefreshTimer.current) window.clearTimeout(countsRefreshTimer.current);
    countsRefreshTimer.current = window.setTimeout(() => {
      void loadCounts();
    }, 700);
  }, [loadCounts]);

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
        payload => {
          const row = payload.new as MailMessage;
          if (row?.id == null) return;
          const id = Number(row.id);
          // 자리 유지: 전체 재조회(재정렬) 하지 않고 현재 페이지 행만 패치
          setMails(prev => {
            const idx = prev.findIndex(m => m.id === id);
            if (idx < 0) return prev;
            // 휴지통 이동/복원 시 현재 함에서 빼기
            const nowTrash = row.deleted_at != null;
            if (box === 'trash' ? !nowTrash : nowTrash) {
              return prev.filter(m => m.id !== id);
            }
            const next = [...prev];
            next[idx] = { ...next[idx], ...row };
            return next;
          });
          scheduleCountsRefresh();
        },
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
  }, [load, refreshAiHealth, box, scheduleCountsRefresh]);

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
    // 별표만 갱신 — 목록 순서/필터는 유지 (새로고침·페이지 이동 시에만 서버 order 반영)
    setMails(prev =>
      prev.map(m =>
        m.id === id
          ? { ...m, is_starred: next, starred_at: next ? new Date().toISOString() : null }
          : m,
      ),
    );
    const { error } = await setMailStarred(id, next);
    if (error) {
      void load({ silent: true });
    }
  };

  const toggleRead = async (id: number, currentlyUnread: boolean) => {
    // currentlyUnread true → mark as read
    const nextRead = currentlyUnread;
    setMails(prev =>
      prev.map(m =>
        m.id === id
          ? { ...m, is_read: nextRead, read_at: nextRead ? new Date().toISOString() : null }
          : m,
      ),
    );
    const { error } = await setMailRead(id, nextRead);
    if (error) {
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
      className={`w-full min-w-0 flex items-center gap-2 rounded-lg text-left text-[13px] font-medium transition-colors ${
        indent ? 'pl-2 pr-2 py-1.5' : 'px-2.5 py-2'
      } ${
        active
          ? 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-100'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );

  /** 하위메뉴 트리 연결선 (└ / ├ 형태) */
  const TreeBranch = ({ children }: { children: ReactNode }) => {
    const items = Children.toArray(children);
    return (
      <ul className="relative ml-3 mt-0.5 mb-0.5 list-none p-0">
        {items.map((child, i) => {
          const last = i === items.length - 1;
          return (
            <li key={(child as { key?: string | null })?.key ?? i} className="relative pl-4">
              <span
                className={`pointer-events-none absolute left-0 w-px bg-slate-300 ${
                  last ? 'top-0 h-1/2' : 'inset-y-0'
                }`}
                aria-hidden
              />
              <span
                className="pointer-events-none absolute left-0 top-1/2 w-3.5 h-px -translate-y-px bg-slate-300"
                aria-hidden
              />
              {child}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 sm:space-y-6 relative">
      {showGuide && <MailGuideModal open onClose={() => setShowGuide(false)} />}
      {showCompose && (
        <MailComposeModal
          open
          onClose={() => setShowCompose(false)}
          onSent={(info) => {
            const to = info?.to ? ` → ${info.to}` : '';
            setSendNotice(`메일 전송이 완료되었습니다${to}`);
            setBox('sent');
            window.setTimeout(() => setSendNotice(null), 5000);
          }}
        />
      )}
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

      {sendNotice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900 shadow-sm"
        >
          <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden />
          <p className="min-w-0 flex-1 font-medium break-words">{sendNotice}</p>
          <button
            type="button"
            onClick={() => setSendNotice(null)}
            className="shrink-0 text-emerald-700/70 hover:text-emerald-900 text-xs font-semibold"
          >
            닫기
          </button>
        </div>
      )}

      {/* 모바일·태블릿: 가로 탭형 메일함 메뉴 */}
      <div className="lg:hidden space-y-2 min-w-0">
        <div className="flex items-stretch gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setShowCompose(true)}
            className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm"
            aria-label="새 메일 작성"
            title="새 메일 작성"
          >
            <MailPlus className="w-5 h-5" />
          </button>
          <MobileScrollChipRow ariaLabel="메일함" className="flex-1">
            {BOX_MAIN.map(b => {
              const active = box === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setBox(b.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span>{boxIcon(b.icon, 'w-3.5 h-3.5')}</span>
                  {b.label}
                  <MailCountPill count={boxCounts[b.id]} tone={active ? 'chipActive' : 'chip'} />
                </button>
              );
            })}
          </MobileScrollChipRow>
        </div>

        {gmailLabels.length > 0 && (
          <div className="space-y-1 min-w-0">
            <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Label</p>
            <MobileScrollChipRow ariaLabel="라벨">
              {gmailLabels.map(l => {
                const id = `label:${l.id}` as MailBoxId;
                const active = box === id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setBox(id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-violet-600 text-white'
                        : 'bg-violet-50 text-violet-700 border border-violet-100 hover:bg-violet-100'
                    }`}
                  >
                    {l.name}
                    <MailCountPill
                      count={boxCounts[id]}
                      tone={active ? 'chipActive' : 'violet'}
                    />
                  </button>
                );
              })}
            </MobileScrollChipRow>
          </div>
        )}

        <div className="space-y-1 min-w-0">
          <p className="px-1 text-[10px] font-bold tracking-wide text-slate-400">AI 분류 상태</p>
          <MobileScrollChipRow ariaLabel="AI 분류 상태">
            {BOX_STATUS.map(b => {
              const active = box === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setBox(b.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {b.label}
                  <MailCountPill count={boxCounts[b.id]} tone={active ? 'chipActive' : 'chip'} />
                </button>
              );
            })}
          </MobileScrollChipRow>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 min-w-0 items-start">
        {/* 데스크톱 left 메뉴 */}
        <aside className="hidden lg:block w-56 shrink-0 sticky top-4 self-start">
          <nav className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm space-y-2">
            <div className="px-1 pt-0.5 pb-1">
              <button
                type="button"
                onClick={() => setShowCompose(true)}
                className="w-full flex items-center justify-center gap-0 rounded-xl py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                aria-label="새 메일 작성"
                title="새 메일 작성"
              >
                <MailPlus className="w-5 h-5" />
              </button>
            </div>

            {/* 중메뉴: 메일함 */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleNav('folders')}
                aria-expanded={navOpen.folders}
                className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left hover:bg-slate-100/80 transition-colors"
              >
                {navOpen.folders
                  ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                  : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-500" />}
                <span className="text-[12px] font-bold text-slate-800 tracking-tight">메일함</span>
              </button>
              {navOpen.folders && (
                <div className="px-1.5 pb-1.5 border-t border-slate-100 bg-white">
                  <TreeBranch>
                    {BOX_MAIN.map(b => (
                      <NavBtn key={b.id} active={box === b.id} onClick={() => setBox(b.id)} indent>
                        <span className="shrink-0">{boxIcon(b.icon)}</span>
                        <NavLabelWithCount label={b.label} count={boxCounts[b.id]} active={box === b.id} />
                      </NavBtn>
                    ))}
                  </TreeBranch>
                </div>
              )}
            </div>

            {/* 중메뉴: AI 분류 상태 */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleNav('status')}
                aria-expanded={navOpen.status}
                className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left hover:bg-slate-100/80 transition-colors"
              >
                {navOpen.status
                  ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                  : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-500" />}
                <span className="text-[12px] font-bold text-slate-800 tracking-tight">AI 분류 상태</span>
              </button>
              {navOpen.status && (
                <div className="px-1.5 pb-1.5 border-t border-slate-100 bg-white">
                  <TreeBranch>
                    {BOX_STATUS.map(b => (
                      <NavBtn key={b.id} active={box === b.id} onClick={() => setBox(b.id)} indent>
                        <NavLabelWithCount label={b.label} count={boxCounts[b.id]} active={box === b.id} />
                      </NavBtn>
                    ))}
                  </TreeBranch>
                </div>
              )}
            </div>

            {/* 중메뉴: Label */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleNav('labels')}
                aria-expanded={navOpen.labels}
                className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left hover:bg-slate-100/80 transition-colors"
              >
                {navOpen.labels
                  ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                  : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-500" />}
                <span className="text-[12px] font-bold text-slate-800 tracking-tight">Label</span>
              </button>
              {navOpen.labels && (
                <div className="px-1.5 pb-1.5 border-t border-slate-100 bg-white">
                  {gmailLabels.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[11px] text-slate-400 leading-snug">
                      Gmail 사용자 라벨 없음 (동기화 후 표시)
                    </p>
                  ) : (
                    <TreeBranch>
                      {gmailLabels.map(l => {
                        const id = `label:${l.id}` as MailBoxId;
                        return (
                          <NavBtn key={l.id} active={box === id} onClick={() => setBox(id)} indent>
                            <NavLabelWithCount
                              label={l.name}
                              count={boxCounts[id]}
                              active={box === id}
                              tone="violet"
                            />
                          </NavBtn>
                        );
                      })}
                    </TreeBranch>
                  )}
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
            <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
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
          </div>

          {/* 모바일·태블릿: 카드 리스트 */}
          <div className="lg:hidden space-y-2">
        <div className="flex items-center gap-2 px-1">
          <MailSelectCheckbox
            checked={allPageSelected}
            indeterminate={somePageSelected && !allPageSelected}
            onToggle={toggleSelectAll}
            ariaLabel="현재 페이지 전체 선택"
          />
          {showStarPriorityToggle && (
            <button
              type="button"
              onClick={toggleStarPriority}
              aria-pressed={starPriority}
              aria-label={starPriority ? '즐겨찾기 우선 정렬 끄기' : '즐겨찾기 우선 정렬 켜기'}
              title={starPriority ? '즐겨찾기 우선 정렬 ON — 클릭하면 해제' : '즐겨찾기 우선 정렬 OFF — 클릭하면 켜기'}
              className="p-0.5"
            >
              <Star
                className={`w-4 h-4 ${
                  starPriority
                    ? 'text-amber-400 fill-amber-400'
                    : 'text-slate-300'
                }`}
              />
            </button>
          )}
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
                {showDirection && (
                  <MailDirectionBadge sent={!!m.is_sent} />
                )}
                <MailSelectCheckbox
                  checked={checked}
                  onToggle={() => toggleSelectOne(m.id)}
                  ariaLabel={`${m.subject || '메일'} 선택`}
                  className="mt-0.5"
                />
                {showStarColumn && (
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
                )}
                <button
                  type="button"
                  className={`mt-0.5 p-0.5 shrink-0 ${unread ? 'text-orange-500' : 'text-slate-400 hover:text-slate-600'}`}
                  aria-label={unread ? '읽음으로 표시' : '안읽음으로 표시'}
                  aria-pressed={!unread}
                  title={unread ? '안읽음 → 클릭하여 읽음' : '읽음 → 클릭하여 안읽음'}
                  onClick={e => {
                    e.stopPropagation();
                    void toggleRead(m.id, unread);
                  }}
                >
                  {unread
                    ? <Mail className="w-5 h-5" />
                    : <MailOpen className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => navigate(`/mail/${m.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`text-sm leading-snug line-clamp-2 ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
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
              {showDirection && (
                <th className="px-1.5 py-2 w-[6rem] text-center text-[10px] font-semibold whitespace-nowrap" title="받은/보낸">
                  구분
                </th>
              )}
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
              {showStarColumn && (
                <th className="px-1 py-2 w-10 text-center" aria-label="즐겨찾기">
                  {showStarPriorityToggle ? (
                    <button
                      type="button"
                      onClick={toggleStarPriority}
                      aria-pressed={starPriority}
                      aria-label={starPriority ? '즐겨찾기 우선 정렬 끄기' : '즐겨찾기 우선 정렬 켜기'}
                      title={starPriority ? '즐겨찾기 우선 정렬 ON — 클릭하면 해제' : '즐겨찾기 우선 정렬 OFF — 클릭하면 켜기'}
                      className="mx-auto p-0.5 inline-flex"
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          starPriority
                            ? 'text-amber-400 fill-amber-400'
                            : 'text-slate-300'
                        }`}
                      />
                    </button>
                  ) : (
                    <Star className="w-3.5 h-3.5 mx-auto text-slate-300" />
                  )}
                </th>
              )}
              <th className="px-1 py-2 w-10 text-center" aria-label="읽음" title="읽음">
                <Mail className="w-3.5 h-3.5 mx-auto text-orange-400" />
              </th>
              <th className="px-3 py-2">제목</th>
              <th className="px-2 py-2 w-[16%]">발신자</th>
              <th className="px-2 py-2 w-[13.5rem] whitespace-nowrap">수신시각</th>
              <th className="px-2 py-2 w-[5.75rem]">상태</th>
              <th className="px-2 py-2 w-[4.25rem] text-right">신뢰도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={tableColSpan} className="px-4 py-8 text-center text-slate-400">로딩 중…</td></tr>
            )}
            {!loading && mails.length === 0 && (
              <tr><td colSpan={tableColSpan} className="px-4 py-8 text-center text-slate-400">메일이 없습니다.</td></tr>
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
                  {showDirection && (
                    <td className="relative p-0 w-[6rem]">
                      {/* 행 높이·너비 확보 (absolute 배지 붕괴 방지) */}
                      <span
                        className="invisible inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1.5 text-xs font-semibold"
                        aria-hidden
                      >
                        <span className="inline-block w-4 h-4" />
                        보냄
                      </span>
                      <MailDirectionBadge sent={!!m.is_sent} fill />
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-center align-middle">
                    <div className="flex justify-center">
                      <MailSelectCheckbox
                        checked={checked}
                        onToggle={() => toggleSelectOne(m.id)}
                        ariaLabel={`${m.subject || '메일'} 선택`}
                      />
                    </div>
                  </td>
                  {showStarColumn && (
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
                  )}
                  <td className="px-1 py-1.5 text-center align-middle">
                    <button
                      type="button"
                      className={`p-1 ${unread ? 'text-orange-500' : 'text-slate-400 hover:text-slate-600'}`}
                      aria-label={unread ? '읽음으로 표시' : '안읽음으로 표시'}
                      aria-pressed={!unread}
                      title={unread ? '안읽음 → 클릭하여 읽음' : '읽음 → 클릭하여 안읽음'}
                      onClick={e => {
                        e.stopPropagation();
                        void toggleRead(m.id, unread);
                      }}
                    >
                      {unread
                        ? <Mail className="w-4 h-4 mx-auto" />
                        : <MailOpen className="w-4 h-4 mx-auto" />}
                    </button>
                  </td>
                  <td className={`px-3 py-1.5 align-middle ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                    <span className="block truncate">{m.subject || '(제목 없음)'}</span>
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
