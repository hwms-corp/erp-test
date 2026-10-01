import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search, Link2, Unlink, ArrowRight, Loader2, RotateCcw, AlertTriangle, Ban } from 'lucide-react';
import { useOrderMailMatch } from '@/hooks/useOrderMailMatch';
import { Pagination, usePagination } from '@/components/Pagination';
import { formatReceivedAtKst } from '@/lib/mailTime';
import type { LearningOrderListItem } from '@/lib/orderMailMatch';

type Filter = 'all' | 'pending' | 'matched' | 'unmatched' | 'failed';

export function OrderMailMatchListPanel() {
  const { rows, loading, matchingOrderId, error, progress, loadList, matchOne, cancelMatch } = useOrderMailMatch();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter(r => {
      const st = r.match?.status;
      if (filter === 'pending' && st) return false;
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

  const pendingCount = rows.filter(r => !r.match).length;
  const matchedCount = rows.filter(r => r.match?.status === 'matched').length;
  const unmatchedCount = rows.filter(r => r.match?.status === 'unmatched').length;
  const failedCount = rows.filter(r => r.match?.status === 'failed').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            기존 견적서 - 메일 매칭
            <span className="ml-2 text-xs font-normal text-slate-400 tabular-nums">
              전체 {rows.length} · 미실행 {pendingCount} · 매칭 {matchedCount} · 비매칭 {unmatchedCount}
              {failedCount ? ` · 실패 ${failedCount}` : ''}
            </span>
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            목록은 빠르게만 불러옵니다. 각 행의 「매칭」으로 견적→메일 엔진을 실행하며,
            결과는 DB에 저장되어 다시 열 때 API를 돌리지 않습니다.
            후보 메일: 견적 작성시각 직전 ~ 15일 이내 수신 · 첨부 OCR은 매칭 엔진 담당.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          disabled={loading || matchingOrderId != null}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          목록 새로고침
        </button>
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
              ['matched', '매칭'],
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
      {(loading || progress || matchingOrderId != null) && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600 flex flex-wrap items-center gap-2">
          {(loading || matchingOrderId != null) && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          <span className="flex-1 min-w-0">
            {progress || (loading ? '불러오는 중…' : '매칭 진행 중…')}
            {matchingOrderId != null ? ` · 견적 #${matchingOrderId}` : ''}
          </span>
          {matchingOrderId != null && (
            <button
              type="button"
              onClick={() => cancelMatch()}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
            >
              <Ban className="w-3.5 h-3.5" />
              강제 중단
            </button>
          )}
        </div>
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
                      anyBusy={matchingOrderId != null}
                      onMatch={() => void matchOne(r.order.id)}
                      onCancel={cancelMatch}
                      onRematch={() => {
                        if (!confirm('이미 저장된 매칭을 지우고 다시 실행할까요?')) return;
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
  return (
    <tr className="hover:bg-slate-50/80">
      <td className="px-3 py-2.5 whitespace-nowrap">
        {!st && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] font-semibold">
            미실행
          </span>
        )}
        {st === 'matched' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
            <Link2 className="w-3 h-3" />
            매칭
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
          ) : st === 'matched' ? (
            <>
              <Link
                to={`/mail/learning/order-match/${row.order.id}`}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                상세비교
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
