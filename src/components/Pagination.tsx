import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
  /** 현재 페이지 기준 가운데에 보여줄 페이지 수 (기본 10) */
  windowSize?: number;
}

/** 1 … [window] … N 형태로 페이지 번호 배열 생성 */
function buildPageItems(page: number, totalPages: number, windowSize: number): (number | '...')[] {
  if (totalPages <= 1) return [1];

  // 전체 페이지가 창+양끝 이하면 전부 표시
  if (totalPages <= windowSize + 2) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const items: (number | '...')[] = [1];

  let start = Math.max(2, page - Math.floor((windowSize - 1) / 2));
  let end = start + windowSize - 1;
  if (end > totalPages - 1) {
    end = totalPages - 1;
    start = Math.max(2, end - windowSize + 1);
  }

  if (start > 2) items.push('...');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 1) items.push('...');
  items.push(totalPages);

  return items;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  windowSize = 10,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = buildPageItems(page, totalPages, windowSize);
  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  const navBtn =
    'p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-3">
      {totalItems !== undefined && pageSize ? (
        <span className="text-xs text-slate-400 tabular-nums">
          총 {totalItems.toLocaleString()}건 (페이지 {page}/{totalPages})
        </span>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={atFirst}
          aria-label="첫 페이지"
          title="첫 페이지"
          className={navBtn}
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={atFirst}
          aria-label="이전 페이지"
          title="이전 페이지"
          className={navBtn}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dot-${i}`} className="px-1.5 text-xs text-slate-400 select-none">
              …
            </span>
          ) : (
            <button
              type="button"
              key={p}
              onClick={() => onPageChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors tabular-nums ${
                p === page
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={atLast}
          aria-label="다음 페이지"
          title="다음 페이지"
          className={navBtn}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={atLast}
          aria-label="마지막 페이지"
          title="마지막 페이지"
          className={navBtn}
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function usePagination<T>(items: T[], pageSize = 20) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return {
    totalItems,
    totalPages,
    pageSize,
    getPage: (page: number) => items.slice((page - 1) * pageSize, page * pageSize),
  };
}
