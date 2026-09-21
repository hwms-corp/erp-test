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

const TOAST_VISIBLE = 3;
const TOAST_CARD_H = 84;
const TOAST_GAP = 8;

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
  }, []);

  // 앱 전역: 어떤 화면이든 새 메일 INSERT → 알림 유지
  useEffect(() => {
    const channel = supabase
      .channel('mail_toast_global')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mail_messages' },
        payload => {
          const row = payload.new as MailMessage;
          if (row?.id == null) return;
          pushToast(Number(row.id), row.subject, row.from_addr);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
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
