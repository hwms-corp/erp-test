import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Mail, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { MailMessage } from '@/types/aiMail';
import type { RealtimeChannel } from '@supabase/supabase-js';

const TOAST_VISIBLE = 3;
const TOAST_CARD_H = 84;
const TOAST_GAP = 8;
const POLL_MS = 12_000;
const LS_KEY = 'erp_mail_toast_enabled';
const LS_POS = 'erp_mail_toast_fab_pos';

export type MailToast = {
  key: string;
  mailId: number;
  subject: string;
  fromAddr?: string;
};

type MailToastContextValue = {
  toasts: MailToast[];
  enabled: boolean;
  toggleEnabled: () => void;
  pushToast: (mailId: number, subject?: string | null, fromAddr?: string | null) => void;
  dismissToast: (key: string) => void;
  dismissAllToasts: () => void;
};

const MailToastContext = createContext<MailToastContextValue | null>(null);

export function useMailToasts() {
  const ctx = useContext(MailToastContext);
  if (!ctx) throw new Error('useMailToasts must be used within MailToastProvider');
  return ctx;
}

function readEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v == null) return true;
    return v === '1' || v === 'true';
  } catch {
    return true;
  }
}

function readPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(LS_POS);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y };
  } catch { /* ignore */ }
  return null;
}

function clampPos(x: number, y: number) {
  const size = 48;
  const maxX = Math.max(8, window.innerWidth - size - 8);
  const maxY = Math.max(8, window.innerHeight - size - 8);
  return {
    x: Math.min(maxX, Math.max(8, x)),
    y: Math.min(maxY, Math.max(8, y)),
  };
}

function MailToastStack() {
  const { toasts, enabled, toggleEnabled, dismissToast, dismissAllToasts } = useMailToasts();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<'on' | 'off' | null>(null);
  const [pos, setPos] = useState(() => {
    const saved = readPos();
    if (saved) return saved;
    if (typeof window === 'undefined') return { x: 24, y: 24 };
    return { x: window.innerWidth - 72, y: window.innerHeight - 72 };
  });
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    ox: number;
    oy: number;
    sx: number;
    sy: number;
  } | null>(null);
  const toastMaxH = TOAST_VISIBLE * TOAST_CARD_H + (TOAST_VISIBLE - 1) * TOAST_GAP;

  useEffect(() => {
    const onResize = () => setPos(p => clampPos(p.x, p.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || toasts.length === 0) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [toasts.length]);

  const onToggle = () => {
    const next = !enabled;
    toggleEnabled();
    setFlash(next ? 'on' : 'off');
    window.setTimeout(() => setFlash(null), 1400);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      ox: e.clientX,
      oy: e.clientY,
      sx: pos.x,
      sy: pos.y,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d?.active) return;
    const dx = e.clientX - d.ox;
    const dy = e.clientY - d.oy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    setPos(clampPos(d.sx + dx, d.sy + dy));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    if (!d) return;
    if (d.moved) {
      setPos(p => {
        const next = clampPos(p.x, p.y);
        try {
          localStorage.setItem(LS_POS, JSON.stringify(next));
        } catch { /* ignore */ }
        return next;
      });
      return;
    }
    onToggle();
  };

  // 토스트 스택은 FAB 위에 붙이되, 화면 밖으로 안 나가게
  const stackWidth = Math.min(352, typeof window !== 'undefined' ? window.innerWidth - 16 : 352);
  const stackLeft = Math.min(
    Math.max(8, pos.x + 48 - stackWidth),
    typeof window !== 'undefined' ? window.innerWidth - stackWidth - 8 : pos.x,
  );
  const stackBottom = typeof window !== 'undefined'
    ? Math.max(8, window.innerHeight - pos.y + 8)
    : 72;

  return (
    <>
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash}
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            className={`pointer-events-none fixed z-[61] rounded-full px-3 py-1 text-xs font-semibold shadow-md ${
              flash === 'on' ? 'bg-orange-500 text-white' : 'bg-slate-600 text-white'
            }`}
            style={{ left: pos.x - 20, top: Math.max(8, pos.y - 36) }}
          >
            {flash === 'on' ? '메일 알림 ON' : '메일 알림 OFF'}
          </motion.div>
        )}
      </AnimatePresence>

      {enabled && toasts.length > 0 && (
        <div
          className="pointer-events-none fixed z-[60] flex flex-col items-end gap-1.5"
          style={{ left: stackLeft, bottom: stackBottom, width: stackWidth }}
        >
          <div className="pointer-events-auto flex justify-end w-full">
            <button
              type="button"
              onClick={() => dismissAllToasts()}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800"
              aria-label="알림 전부 닫기"
              title="알림 전부 닫기"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div
            ref={scrollRef}
            className="mail-toast-scroll pointer-events-auto flex flex-col gap-2 overflow-y-auto overscroll-contain pr-1 w-full"
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

      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`fixed z-[62] inline-flex h-12 w-12 items-center justify-center rounded-full border shadow-lg transition-colors touch-none select-none ${
          enabled
            ? 'border-orange-300 bg-orange-500 text-white hover:bg-orange-600'
            : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600'
        }`}
        style={{ left: pos.x, top: pos.y }}
        aria-pressed={enabled}
        aria-label={enabled ? '메일 알림 끄기' : '메일 알림 켜기'}
        title={enabled ? '알림 ON · 드래그로 이동' : '알림 OFF · 드래그로 이동'}
      >
        <Mail className={`w-5 h-5 pointer-events-none ${enabled ? 'fill-white/20' : ''}`} />
        {enabled && (
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white pointer-events-none" />
        )}
      </button>
    </>
  );
}

export function MailToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<MailToast[]>([]);
  const [enabled, setEnabled] = useState(readEnabled);
  const enabledRef = useRef(enabled);
  const lastSeenIdRef = useRef<number | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const dismissToast = useCallback((key: string) => {
    setToasts(prev => prev.filter(t => t.key !== key));
  }, []);

  const dismissAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const toggleEnabled = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try {
        localStorage.setItem(LS_KEY, next ? '1' : '0');
      } catch { /* ignore */ }
      if (!next) setToasts([]);
      return next;
    });
  }, []);

  const pushToast = useCallback((mailId: number, subject?: string | null, fromAddr?: string | null) => {
    if (!enabledRef.current) {
      lastSeenIdRef.current = Math.max(lastSeenIdRef.current ?? 0, mailId);
      return;
    }
    setToasts(prev => {
      if (prev.some(t => t.mailId === mailId)) return prev;
      return [
        ...prev,
        {
          key: `${mailId}-${Date.now()}`,
          mailId,
          subject: subject?.trim() || '제목 없는 메일',
          fromAddr: fromAddr || undefined,
        },
      ];
    });
    lastSeenIdRef.current = Math.max(lastSeenIdRef.current ?? 0, mailId);
  }, []);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let pollTimer: number | undefined;

    const syncRealtimeAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
    };

    const markSeen = (id: number) => {
      lastSeenIdRef.current = Math.max(lastSeenIdRef.current ?? 0, id);
    };

    const pollNewMails = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (!enabledRef.current) return;
      const since = lastSeenIdRef.current;
      if (since == null || !readyRef.current) return;

      const { data, error } = await supabase
        .from('mail_messages')
        .select('id, subject, from_addr, deleted_at')
        .is('deleted_at', null)
        .gt('id', since)
        .order('id', { ascending: true })
        .limit(20);

      if (error || !data?.length) return;
      for (const row of data) {
        pushToast(Number(row.id), row.subject, row.from_addr);
      }
    };

    const startPoll = () => {
      if (pollTimer != null) window.clearInterval(pollTimer);
      pollTimer = window.setInterval(() => { void pollNewMails(); }, POLL_MS);
    };

    const subscribeRealtime = async () => {
      await syncRealtimeAuth();
      if (cancelled) return;

      if (channel) {
        await supabase.removeChannel(channel);
        channel = null;
      }

      channel = supabase
        .channel('mail_toast_global')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'mail_messages' },
          payload => {
            const row = payload.new as MailMessage;
            if (row?.id == null) return;
            if (row.deleted_at) return;
            pushToast(Number(row.id), row.subject, row.from_addr);
          },
        )
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[mail-toast] realtime', status, err);
            window.setTimeout(() => {
              if (!cancelled) void subscribeRealtime();
            }, 2500);
          }
        });
    };

    (async () => {
      const { data: latest } = await supabase
        .from('mail_messages')
        .select('id')
        .is('deleted_at', null)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (latest?.id != null) markSeen(Number(latest.id));
      readyRef.current = true;

      await subscribeRealtime();
      startPoll();
    })();

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') void pollNewMails();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      readyRef.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      authSub.subscription.unsubscribe();
      if (pollTimer != null) window.clearInterval(pollTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [pushToast]);

  const value = useMemo(
    () => ({ toasts, enabled, toggleEnabled, pushToast, dismissToast, dismissAllToasts }),
    [toasts, enabled, toggleEnabled, pushToast, dismissToast, dismissAllToasts],
  );

  return (
    <MailToastContext.Provider value={value}>
      {children}
      <MailToastStack />
    </MailToastContext.Provider>
  );
}
