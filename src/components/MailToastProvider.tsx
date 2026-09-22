import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
/** Realtime 누락 대비 폴링 (탭이 보일 때만) */
const POLL_MS = 12_000;

export type MailToast = {
  key: string;
  mailId: number;
  subject: string;
  fromAddr?: string;
};

type MailToastContextValue = {
  toasts: MailToast[];
  pushToast: (mailId: number, subject?: string | null, fromAddr?: string | null) => void;
  dismissToast: (key: string) => void;
};

const MailToastContext = createContext<MailToastContextValue | null>(null);

export function useMailToasts() {
  const ctx = useContext(MailToastContext);
  if (!ctx) throw new Error('useMailToasts must be used within MailToastProvider');
  return ctx;
}

function MailToastStack() {
  const { toasts, dismissToast } = useMailToasts();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastMaxH = TOAST_VISIBLE * TOAST_CARD_H + (TOAST_VISIBLE - 1) * TOAST_GAP;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || toasts.length === 0) return;
    // 최신(맨 아래)이 보이도록, 이후 위로 스크롤해 이전 알림 확인 가능
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] w-[22rem] max-w-[calc(100vw-2rem)]">
      <div
        ref={scrollRef}
        className="mail-toast-scroll pointer-events-auto flex flex-col gap-2 overflow-y-auto overscroll-contain pr-1"
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
  );
}

export function MailToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<MailToast[]>([]);
  const lastSeenIdRef = useRef<number | null>(null);
  const readyRef = useRef(false);

  const dismissToast = useCallback((key: string) => {
    setToasts(prev => prev.filter(t => t.key !== key));
  }, []);

  const pushToast = useCallback((mailId: number, subject?: string | null, fromAddr?: string | null) => {
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

  // Realtime INSERT + JWT 갱신 + 폴링 백업
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
            // 짧게 쉬고 재구독
            window.setTimeout(() => {
              if (!cancelled) void subscribeRealtime();
            }, 2500);
          }
        });
    };

    (async () => {
      // 기준점: 현재 최신 id — 이후 신규만 토스트 (새로고침 시 과거 메일 폭주 방지)
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
    () => ({ toasts, pushToast, dismissToast }),
    [toasts, pushToast, dismissToast],
  );

  return (
    <MailToastContext.Provider value={value}>
      {children}
      <MailToastStack />
    </MailToastContext.Provider>
  );
}
