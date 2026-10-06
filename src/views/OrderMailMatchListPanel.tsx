import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Search, Link2, Unlink, ArrowRight, Loader2, RotateCcw,
  AlertTriangle, Ban, Play, Layers,
} from 'lucide-react';
import { useOrderMailMatch } from '@/hooks/useOrderMailMatch';
import { Pagination, usePagination } from '@/components/Pagination';
import { formatReceivedAtKst } from '@/lib/mailTime';
import { QUOTE_MAIL_LABEL_NAME, type LearningOrderListItem } from '@/lib/orderMailMatch';

type Filter = 'all' | 'pending' | 'candidates' | 'matched' | 'unmatched' | 'failed';

export function OrderMailMatchListPanel() {
  const {
    rows, loading, matchingOrderId, queueActive, queueDone, queueTotal,
    error, progress, loadList, matchOne, matchAll, cancelMatch,
  } = useOrderMailMatch();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const busy = matchingOrderId != null || queueActive;

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter(r => {
      const st = r.match?.status;
      if (filter === 'pending' && st) return false;
      if (filter === 'candidates' && !(r.candidateCount > 0 && st !== 'matched')) return false;
      if (filter === 'matched' && st !== 'matched') return false;
      if (filter === 'unmatched' && st !== 'unmatched') return false;
      if (filter === 'failed' && st !== 'failed') return false;
      if (!qq) return true;
      const hay = [
        r.order.doc_no,
        r.order.partner_name,
        r.order.vessel,
        r.mail?.subject,
        r.mail?.from_addr,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(qq);
    });
  }, [rows, filter, q]);

  const { totalPages, totalItems, getPage, pageSize } = usePagination(filtered, 30);
  const pageItems = getPage(page);

  useEffect(() => { setPage(1); }, [filter, q]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  // 매칭 중인 견적이 다른 페이지에 있으면 그 페이지로 이동
  useEffect(() => {
    if (matchingOrderId == null) return;
    const idx = filtered.findIndex(r => r.order.id === matchingOrderId);
    if (idx < 0) return;
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (targetPage !== page) setPage(targetPage);
  }, [matchingOrderId, filtered, pageSize, page]);

  // 활성 row로 부드럽게 스크롤·포커스
  useEffect(() => {
    if (matchingOrderId == null) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-match-order-id="${matchingOrderId}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      try {
        el.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [matchingOrderId, page]);

  const pendingCount = rows.filter(r => !r.match).length;
  const candidateOnlyCount = rows.filter(r => r.candidateCount > 0 && r.match?.status !== 'matched').length;
  const matchedCount = rows.filter(r => r.match?.status === 'matched').length;
  const unmatchedCount = rows.filter(r => r.match?.status === 'unmatched').length;
  const failedCount = rows.filter(r => r.match?.status === 'failed').length;
  const queueableCount = rows.filter(r => r.match?.status !== 'matched').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            기존 견적서 - 메일 매칭
            <span className="ml-2 text-xs font-normal text-slate-400 tabular-nums">
              전체 {rows.length} · 미실행 {pendingCount} · 후보 {candidateOnlyCount} · 확정 {matchedCount}
              · 비매칭 {unmatchedCount}
              {failedCount ? ` · 실패 ${failedCount}` : ''}
            </span>
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            라벨 「{QUOTE_MAIL_LABEL_NAME}」메일만 · 키는 견적번호(Ref).
            「매칭」/「전체 매칭」후 확정분은 DB에 저장되며, mail-ai-api admin「기존데이터 학습」에서 불러와 학습합니다.
            JSON 다운로드는 없습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadList()}
            disabled={loading || busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            목록 새로고침
          </button>
          {queueActive ? (
            <button
              type="button"
              onClick={() => cancelMatch()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
            >
              <Ban className="w-3.5 h-3.5" />
              전체 중단 ({queueDone}/{queueTotal})
            </button>
          ) : (
            <button
              type="button"
              disabled={loading || busy || queueableCount === 0}
              onClick={() => {
                if (!confirm(
                  `미확정 견적 ${queueableCount}건을 순서대로 매칭할까요?\n` +
                  `한 건이 끝나면 목록에 바로 반영되고 다음 견적으로 넘어갑니다.\n` +
                  `(이미 확정된 건은 건너뜁니다)`,
                )) return;
                void matchAll();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              전체 매칭 ({queueableCount})
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="견적번호 · 거래처 · Vessel · 메일 제목"
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          {(
            [
              ['all', '전체'],
              ['pending', '미실행'],
              ['candidates', '후보'],
              ['matched', '확정'],
              ['unmatched', '비매칭'],
              ['failed', '실패'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                filter === id
                  ? id === 'unmatched' || id === 'failed'
                    ? 'bg-amber-600 text-white'
                    : 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !busy && (
        <div className="flex items-center gap-2 text-sm text-slate-500 px-0.5">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>{progress || '불러오는 중…'}</span>
        </div>
      )}

      {busy && matchingOrderId != null && (
        <MatchProgressBubble
          orderId={matchingOrderId}
          progress={progress}
          queueActive={queueActive}
          queueDone={queueDone}
          queueTotal={queueTotal}
          onCancel={cancelMatch}
        />
      )}

      {!loading && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">상태</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">견적번호</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">견적일</th>
                  <th className="px-3 py-2.5 font-medium">거래처</th>
                  <th className="px-3 py-2.5 font-medium">Vessel</th>
                  <th className="px-3 py-2.5 font-medium">매칭 메일</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">점수</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                      표시할 견적이 없습니다.
                    </td>
                  </tr>
                ) : (
                  pageItems.map(r => (
                    <MatchRow
                      key={r.order.id}
                      row={r}
                      busy={matchingOrderId === r.order.id}
                      anyBusy={busy}
                      onMatch={() => void matchOne(r.order.id)}
                      onCancel={cancelMatch}
                      onRematch={() => {
                        if (!confirm('저장된 후보/확정을 지우고 다시 매칭할까요?')) return;
                        void matchOne(r.order.id, { rematch: true });
                      }}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

/** 활성 매칭 row 위에 따라다니는 말풍선 (row 전환 시 위치 애니메이션) */
function MatchProgressBubble({
  orderId,
  progress,
  queueActive,
  queueDone,
  queueTotal,
  onCancel,
}: {
  orderId: number;
  progress: string;
  queueActive: boolean;
  queueDone: number;
  queueTotal: number;
  onCancel: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);
  const firstPosRef = useRef(true);

  useLayoutEffect(() => {
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-match-order-id="${orderId}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = {
        top: rect.top,
        left: rect.left + rect.width / 2,
        width: Math.min(Math.max(rect.width * 0.72, 260), 440),
      };
      setPos(prev => {
        if (
          prev &&
          Math.abs(prev.top - next.top) < 0.5 &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5
        ) {
          return prev;
        }
        return next;
      });
      if (firstPosRef.current) {
        firstPosRef.current = false;
        // 첫 좌표 잡은 뒤 transition 켜기 (초기 점프 방지)
        requestAnimationFrame(() => setReady(true));
      }
    };

    update();
    const interval = window.setInterval(update, 100);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [orderId]);

  if (!pos || typeof document === 'undefined') return null;

  const label = progress?.trim() || '매칭 진행 중…';

  return createPortal(
    <div
      className={`pointer-events-auto fixed z-[60] ${ready ? 'order-match-bubble' : ''}`}
      style={{
        top: pos.top - 10,
        left: pos.left,
        width: pos.width,
        transform: 'translate(-50%, -100%)',
        opacity: ready ? 1 : 0,
      }}
      role="status"
      aria-live="polite"
    >
      <div
        key={orderId}
        className="order-match-bubble-card rounded-xl border border-teal-300/80 bg-white/95 px-3 py-2.5 shadow-lg shadow-teal-900/10 backdrop-blur-sm"
      >
        <div className="flex items-start gap-2">
          <Loader2 className="mt-0.5 w-4 h-4 animate-spin text-teal-600 shrink-0" />
          <div className="min-w-0 flex-1">
            {queueActive && (
              <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-700/80 tabular-nums mb-0.5">
                전체 매칭 {queueDone + 1}/{queueTotal}
              </p>
            )}
            <p className="text-xs font-medium text-slate-700 leading-snug break-words">
              {label}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
          >
            <Ban className="w-3 h-3" />
            중단
          </button>
        </div>
      </div>
      <div
        className="mx-auto h-0 w-0 border-x-[7px] border-x-transparent border-t-[8px] border-t-teal-300/80"
        aria-hidden
      />
      <div
        className="-mt-[9px] mx-auto h-0 w-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-white"
        aria-hidden
      />
    </div>,
    document.body,
  );
}

function MatchRow({
  row,
  busy,
  anyBusy,
  onMatch,
  onCancel,
  onRematch,
}: {
  row: LearningOrderListItem;
  busy: boolean;
  anyBusy: boolean;
  onMatch: () => void;
  onCancel: () => void;
  onRematch: () => void;
}) {
  const st = row.match?.status;
  const hasCandidates = row.candidateCount > 0 && st !== 'matched';
  return (
    <tr
      data-match-order-id={row.order.id}
      tabIndex={busy ? -1 : undefined}
      className={`order-match-row outline-none ${
        busy ? 'order-match-row-active' : 'hover:bg-slate-50/80'
      }`}
    >
      <td className="px-3 py-2.5 whitespace-nowrap">
        {busy ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-600 text-white px-2 py-0.5 text-[11px] font-semibold shadow-sm">
            <Loader2 className="w-3 h-3 animate-spin" />
            진행중
          </span>
        ) : (
          <>
            {!st && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] font-semibold">
                미실행
              </span>
            )}
            {st === 'matched' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
                <Link2 className="w-3 h-3" />
                확정
              </span>
            )}
            {hasCandidates && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-800 px-2 py-0.5 text-[11px] font-semibold">
                <Layers className="w-3 h-3" />
                후보 {row.candidateCount}
              </span>
            )}
            {st === 'unmatched' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-[11px] font-semibold">
                <Unlink className="w-3 h-3" />
                비매칭
              </span>
            )}
            {st === 'failed' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-[11px] font-semibold" title={row.match?.error_message || ''}>
                <AlertTriangle className="w-3 h-3" />
                실패
              </span>
            )}
          </>
        )}
      </td>
      <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">{row.order.doc_no}</td>
      <td className="px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">{row.order.order_date}</td>
      <td className="px-3 py-2.5 text-slate-700 max-w-[10rem] truncate" title={row.order.partner_name}>
        {row.order.partner_name}
      </td>
      <td className="px-3 py-2.5 text-slate-600 max-w-[8rem] truncate" title={row.order.vessel || ''}>
        {row.order.vessel || '—'}
      </td>
      <td className="px-3 py-2.5 text-slate-600 max-w-[16rem]">
        {row.mail ? (
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800" title={row.mail.subject || ''}>
              {row.mail.subject || '(제목 없음)'}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {row.mail.from_addr} · {formatReceivedAtKst(row.mail.received_at)}
            </p>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 tabular-nums text-slate-600 whitespace-nowrap">
        {row.match?.score != null ? `${Math.round(Number(row.match.score) * 100)}%` : '—'}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-right">
        <div className="inline-flex items-center gap-1.5">
          {busy ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
            >
              <Ban className="w-3 h-3" />
              강제 중단
            </button>
          ) : st === 'matched' || hasCandidates ? (
            <>
              <Link
                to={`/mail/learning/order-match/${row.order.id}`}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                {hasCandidates ? '후보 선택' : '상세비교'}
                <ArrowRight className="w-3 h-3" />
              </Link>
              <button
                type="button"
                disabled={anyBusy}
                onClick={onRematch}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                title="다시 매칭"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={anyBusy}
                onClick={onMatch}
                className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                매칭
              </button>
              {(st === 'unmatched' || st === 'failed') && (
                <Link
                  to={`/mail/learning/order-match/${row.order.id}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
                >
                  상세
                </Link>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
