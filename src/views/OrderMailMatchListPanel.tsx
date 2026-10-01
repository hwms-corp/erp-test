import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search, Link2, Unlink, ArrowRight } from 'lucide-react';
import { useOrderMailMatch } from '@/hooks/useOrderMailMatch';
import { Pagination, usePagination } from '@/components/Pagination';
import { formatReceivedAtKst } from '@/lib/mailTime';
import type { OrderMailMatchRow } from '@/lib/orderMailMatch';

type Filter = 'all' | 'matched' | 'unmatched';

export function OrderMailMatchListPanel() {
  const { rows, loading, error, progress, runMatch } = useOrderMailMatch();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    void runMatch();
  }, [runMatch]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter(r => {
      if (filter === 'matched' && r.status !== 'matched') return false;
      if (filter === 'unmatched' && r.status !== 'unmatched') return false;
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

  useEffect(() => {
    setPage(1);
  }, [filter, q]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const matchedCount = rows.filter(r => r.status === 'matched').length;
  const unmatchedCount = rows.filter(r => r.status === 'unmatched').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            기존 견적서 - 메일 매칭
            <span className="ml-2 text-xs font-normal text-slate-400 tabular-nums">
              전체 {rows.length} · 매칭 {matchedCount} · 비매칭 {unmatchedCount}
            </span>
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            견적 1건당 메일 1통 (금액·단가 제외). 제목/본문/첨부파일명·추출값 기준 고정밀 매칭.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runMatch()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          다시 매칭
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
        <div className="flex items-center gap-1 shrink-0">
          {(
            [
              ['all', '전체'],
              ['matched', '매칭'],
              ['unmatched', '비매칭'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                filter === id
                  ? id === 'unmatched'
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
      {loading && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
          {progress || '매칭 중…'}
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
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap" />
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
                  pageItems.map(r => <MatchRow key={r.order.id} row={r} />)
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

function MatchRow({ row }: { row: OrderMailMatchRow }) {
  const matched = row.status === 'matched';
  return (
    <tr className="hover:bg-slate-50/80">
      <td className="px-3 py-2.5 whitespace-nowrap">
        {matched ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
            <Link2 className="w-3 h-3" />
            매칭
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-[11px] font-semibold">
            <Unlink className="w-3 h-3" />
            비매칭
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
        {row.score != null ? `${Math.round(row.score * 100)}%` : '—'}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-right">
        <Link
          to={`/mail/learning/order-match/${row.order.id}`}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
        >
          상세비교
          <ArrowRight className="w-3 h-3" />
        </Link>
      </td>
    </tr>
  );
}
