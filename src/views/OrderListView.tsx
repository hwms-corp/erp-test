import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { mergeQuery } from '@/lib/listQuery';
import { motion } from 'motion/react';
import { Plus, Search, Calendar, CheckCircle2, Trash2, Edit, ClipboardCheck } from 'lucide-react';
import { useOrders } from '@/hooks/useOrders';
import { supabase } from '@/lib/supabase';
import { StatusBadge } from '@/components/StatusBadge';
import { Pagination, usePagination } from '@/components/Pagination';
import { HighlightText } from '@/components/HighlightText';
import { getHighlightQueries } from '@/lib/searchHighlight';
import { fmtW, monthEnd } from '@/types';
import type { OrderWithPartner } from '@/types';

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

type AiFilter = 'all' | 'pending_review' | 'reviewed' | 'manual';

function isAiPending(o: OrderWithPartner) {
  return o.source === 'ai_mail' && o.ai_review_status === 'pending_review';
}

function isAiReviewed(o: OrderWithPartner) {
  return o.source === 'ai_mail' && o.ai_review_status === 'reviewed';
}

function AiReviewBadge({ o }: { o: OrderWithPartner }) {
  if (o.source !== 'ai_mail') return null;
  if (o.ai_review_status === 'pending_review') {
    return (
      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 align-middle">
        AI 검토대기
      </span>
    );
  }
  if (o.ai_review_status === 'reviewed') {
    return (
      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 align-middle">
        AI 검토완료
      </span>
    );
  }
  return null;
}

export function OrderListView() {
  const { orders, loading, fetchOrders, deleteOrder, markAiReviewed } = useOrders();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const listQ = useMemo(() => {
    const pageRaw = Number.parseInt(searchParams.get('page') || '1', 10);
    return {
      q: searchParams.get('q') ?? '',
      col: searchParams.get('col') ?? 'all',
      status: searchParams.get('status') ?? 'all',
      ai: (searchParams.get('ai') ?? 'all') as AiFilter,
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? monthEnd(),
      page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    };
  }, [searchParams]);

  const [searchInput, setSearchInput] = useState(listQ.q);
  useEffect(() => {
    setSearchInput(listQ.q);
  }, [listQ.q]);

  const { q: search, col: searchCol, status: statusFilter, ai: aiFilter, from: dateFrom, to: dateTo, page } = listQ;
  const [orderItemNames, setOrderItemNames] = useState<Map<number, string>>(new Map());
  const searchCols = [{ k: 'all', l: '전체' }, { k: 'doc_no', l: '견적번호' }, { k: 'partner', l: '거래처' }, { k: 'name', l: '품명' }, { k: 'vessel', l: 'Vessel' }];

  useEffect(() => {
    fetchOrders({ status: statusFilter === 'all' ? undefined : statusFilter });
  }, [fetchOrders, statusFilter]);

  useEffect(() => {
    if (orders.length === 0) return;
    const ids = orders.map(o => o.id);
    supabase.from('order_items').select('order_id, name').in('order_id', ids).is('deleted_at', null).then(({ data }) => {
      if (!data) return;
      const map = new Map<number, string>();
      data.forEach(it => {
        const prev = map.get(it.order_id) || '';
        map.set(it.order_id, prev ? `${prev} ${it.name}` : it.name);
      });
      setOrderItemNames(map);
    });
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (aiFilter === 'pending_review') list = list.filter(isAiPending);
    else if (aiFilter === 'reviewed') list = list.filter(isAiReviewed);
    else if (aiFilter === 'manual') list = list.filter(o => o.source !== 'ai_mail');

    if (dateFrom) list = list.filter(o => o.order_date >= dateFrom);
    if (dateTo) list = list.filter(o => o.order_date <= dateTo);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o => {
        const names = (orderItemNames.get(o.id) || '').toLowerCase();
        const vessel = (o.vessel || '').toLowerCase();
        if (searchCol === 'all') return o.doc_no.toLowerCase().includes(q) || o.partner_name.toLowerCase().includes(q) || names.includes(q) || vessel.includes(q);
        if (searchCol === 'doc_no') return o.doc_no.toLowerCase().includes(q);
        if (searchCol === 'partner') return o.partner_name.toLowerCase().includes(q);
        if (searchCol === 'name') return names.includes(q);
        if (searchCol === 'vessel') return vessel.includes(q);
        return false;
      });
    }

    // AI 검토대기 건을 항상 최상단
    return [...list].sort((a, b) => {
      const ap = isAiPending(a) ? 0 : 1;
      const bp = isAiPending(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (b.order_date || '').localeCompare(a.order_date || '');
    });
  }, [orders, search, searchCol, orderItemNames, dateFrom, dateTo, aiFilter]);

  const { totalItems, totalPages, pageSize, getPage } = usePagination(filtered);
  const visible = getPage(page);

  const setListParams = (patch: Record<string, string | null | undefined>, replace = true) => {
    setSearchParams(prev => mergeQuery(prev, patch), { replace });
  };

  const handleConfirm = (o: OrderWithPartner, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/orders/${o.id}/preview`);
  };

  const handleDelete = async (o: OrderWithPartner, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`${o.doc_no}을(를) 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return;
    const { error } = await deleteOrder(o.id);
    if (error) {
      alert('삭제 실패: 연결된 발주서가 있으면 먼저 삭제해주세요.');
    }
  };

  const handleMarkReviewed = async (o: OrderWithPartner, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`${o.doc_no}\nAI 검토완료 처리하시겠습니까?`)) return;
    const { error } = await markAiReviewed(o.id);
    if (error) alert('검토완료 처리 실패: ' + (error.message || ''));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">견적서 관리</h2>
        <button onClick={() => navigate('/orders/new')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium shadow-sm">
          <Plus className="w-4 h-4" /> 견적서 작성
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200 pb-0">
        {([
          { k: 'all', l: '전체' },
          { k: 'draft', l: '견적' },
          { k: 'confirmed', l: '수주' },
        ] as const).map(t => (
          <button
            key={t.k}
            onClick={() => setListParams({ status: t.k, page: '1' })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${statusFilter === t.k ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.l}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { k: 'all' as const, l: '전체 출처' },
          { k: 'pending_review' as const, l: 'AI 검토대기' },
          { k: 'reviewed' as const, l: 'AI 검토완료' },
          { k: 'manual' as const, l: '수동 작성' },
        ]).map(t => (
          <button
            key={t.k}
            type="button"
            onClick={() => setListParams({ ai: t.k === 'all' ? null : t.k, page: '1' })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              aiFilter === t.k
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            className={`${inp} !w-36`}
            value={dateFrom}
            onChange={e => setListParams({ from: e.target.value, page: '1' })}
          />
          <span className="text-slate-400">~</span>
          <input
            type="date"
            className={`${inp} !w-36`}
            value={dateTo}
            onChange={e => setListParams({ to: e.target.value, page: '1' })}
          />
        </div>
        <select
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none bg-white shrink-0"
          value={searchCol}
          onChange={e => setListParams({ col: e.target.value, page: '1' })}
        >
          {searchCols.map(c => <option key={c.k} value={c.k}>{c.l}</option>)}
        </select>
        <div className="flex-1 bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-3">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="검색 (Enter)"
            className="flex-1 outline-none text-sm"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = searchInput.trim();
                setListParams({
                  ...(v ? { q: v } : { q: null }),
                  page: '1',
                });
              }
            }}
          />
          {searchInput && (
            <button
              onClick={() => {
                setSearchInput('');
                setListParams({ q: null, page: '1' });
              }}
              className="text-slate-400 hover:text-slate-600 text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm text-left min-w-[900px] whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">문서번호</th>
                <th className="px-4 py-3">주문일</th>
                <th className="px-4 py-3">거래처</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3 text-right">공급가액</th>
                <th className="px-4 py-3 text-right">세액</th>
                <th className="px-4 py-3 text-right">합계</th>
                <th className="px-4 py-3 text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map(o => (
                <tr
                  key={o.id}
                  className={`hover:bg-slate-50 ${isAiPending(o) ? 'bg-amber-50/40' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-indigo-600">
                    <span className="hover:underline cursor-pointer" onClick={() => navigate(`/orders/${o.id}/preview`)}>
                      <HighlightText text={o.doc_no} queries={getHighlightQueries(search, searchCol, 'doc_no')} />
                    </span>
                    <AiReviewBadge o={o} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.order_date}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <HighlightText text={o.partner_name} queries={getHighlightQueries(search, searchCol, 'partner')} />
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={o.status === 'confirmed' && o.delivery_status === 'completed' ? 'completed' : o.status} /></td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmtW(o.supply_amount)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{fmtW(o.tax_amount)}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{fmtW(o.total_amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {isAiPending(o) && (
                        <button
                          onClick={e => handleMarkReviewed(o, e)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors"
                          title="AI 검토완료"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" />
                          검토완료
                        </button>
                      )}
                      {o.status === 'draft' && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); navigate(`/orders/${o.id}/edit`); }}
                            className="p-1.5 text-slate-400 hover:text-amber-600 transition-colors"
                            title="수정"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={e => handleConfirm(o, e)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            수주확정
                          </button>
                        </>
                      )}
                      <button
                        onClick={e => handleDelete(o, e)}
                        className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                        title="삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">검색 결과가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={pg => setListParams({ page: String(pg) })}
          totalItems={totalItems}
          pageSize={pageSize}
        />
      </div>
    </motion.div>
  );
}
