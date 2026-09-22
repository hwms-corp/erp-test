import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Search, Save } from 'lucide-react';
import { MaterialEditor } from '@/components/MaterialEditor';
import { PartnerSearchModal } from '@/components/PartnerSearchModal';
import { useAuth } from '@/hooks/useAuth';
import { usePOs } from '@/hooks/usePOs';
import { usePartners } from '@/hooks/usePartners';
import { supabase } from '@/lib/supabase';
import { today, PAYMENT_TERMS_LABELS, fmtW } from '@/types';
import { calcPOAmounts } from '@/lib/poAmounts';
import type { Partner, POLine, PaymentTerms, OrderItem } from '@/types';
import { emptyPOLine } from '@/types';

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

export function POFormView() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const { user } = useAuth();
  const { createPO, updatePO, fetchPOItems } = usePOs();
  const { partners, fetchPartners } = usePartners();

  const [partner, setPartner] = useState<Partner | null>(null);
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [poDate, setPoDate] = useState(today);
  const [requiredDate, setRequiredDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>('immediate');
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<POLine[]>([emptyPOLine()]);
  const [saving, setSaving] = useState(false);
  const [orderDocNo, setOrderDocNo] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  const loadPO = useCallback(async (poId: string) => {
    setLoadingEdit(true);
    const { data: po } = await supabase
      .from('v_pos_with_detail')
      .select('*')
      .eq('id', Number(poId))
      .single();

    if (po) {
      setPoDate(po.po_date);
      setRequiredDate(po.required_date || '');
      setPaymentTerms(po.payment_terms || 'immediate');
      setRemark(po.remark || '');

      const { data: partnerData } = await supabase
        .from('partners')
        .select('*')
        .eq('id', po.partner_id)
        .single();
      if (partnerData) setPartner(partnerData);

      const { data: itemData } = await fetchPOItems(po.id);
      if (itemData && itemData.length > 0) {
        setLines(itemData.map(it => ({
          name: it.name,
          spec: it.spec ?? '',
          qty: it.qty,
          unit: it.unit,
          price: it.price,
          remark: it.remark ?? '',
          received_qty: it.received_qty || 0,
          order_item_id: it.order_item_id || undefined,
        })));
      }
    }
    setLoadingEdit(false);
  }, [fetchPOItems]);

  useEffect(() => {
    if (id) loadPO(id);
  }, [id, loadPO]);

  const loadFromOrder = useCallback(async (oid: string) => {
    const { data: order } = await supabase
      .from('v_orders_with_partner')
      .select('*')
      .eq('id', Number(oid))
      .single();

    if (!order) return;
    setOrderDocNo(order.doc_no);

    const { data: partnerData } = await supabase
      .from('partners')
      .select('*')
      .eq('id', order.partner_id)
      .single();

    if (partnerData) setPartner(partnerData);

    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', Number(oid))
      .is('deleted_at', null)
      .order('seq', { ascending: true });

    if (items && items.length > 0) {
      setLines(items.map((it: OrderItem) => ({
        name: it.name,
        spec: it.spec ?? '',
        qty: it.qty,
        unit: it.unit,
        price: it.price,
        remark: it.remark ?? '',
        received_qty: 0,
        order_item_id: it.id,
      })));
    }
  }, []);

  useEffect(() => {
    if (orderId) loadFromOrder(orderId);
  }, [orderId, loadFromOrder]);

  const purchasePartners = partners.filter(p => p.type === 'purchasing' || p.type === 'both');

  const validLinesForAmount = lines.filter(l => l.name.trim());
  const { supply, tax, total } = calcPOAmounts(validLinesForAmount, partner?.name ?? '');

  const handleSubmit = async () => {
    if (saving) return;
    if (!partner) return alert('거래처를 선택해주세요.');
    if (!user) return alert('로그인이 필요합니다.');
    const validLines = lines.filter(l => l.name.trim() && Number(l.qty) > 0);
    if (validLines.length === 0) {
      return alert('품명과 수량(1 이상)이 있는 품목을 1개 이상 입력해주세요.');
    }

    setSaving(true);

    if (isEdit && id) {
      const { error } = await updatePO(
        Number(id),
        {
          po_date: poDate,
          partner_id: partner.id,
          required_date: requiredDate || undefined,
          payment_terms: paymentTerms,
          remark: remark || undefined,
        },
        validLines,
      );
      setSaving(false);
      if (error) {
        const msg = error.message || '';
        alert('수정 실패: ' + msg);
      } else {
        navigate(`/pos/${id}/preview`);
      }
    } else {
      const { error } = await createPO(
        {
          po_date: poDate,
          partner_id: partner.id,
          order_id: orderId ? Number(orderId) : undefined,
          required_date: requiredDate || undefined,
          payment_terms: paymentTerms,
          remark: remark || undefined,
          created_by: user.id,
        },
        validLines,
      );
      setSaving(false);
      if (error) {
        const msg = error.message || '';
        if (msg.includes('partner_type') || msg.includes('purchasing or both')) {
          alert('해당 거래처는 구매 거래처가 아닙니다. 거래처 타입을 "구매" 또는 "영업/구매"로 변경해주세요.');
        } else if (msg.includes('doc_no_key') || msg.includes('duplicate key')) {
          alert('이미 동일한 발주번호가 존재합니다. 다른 번호를 입력해주세요.');
        } else {
          alert('저장 실패: ' + msg);
        }
      } else {
        navigate('/pos');
      }
    }
  };

  if (loadingEdit) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{isEdit ? '발주서 수정' : '발주서 작성'}</h2>
          {orderDocNo && <p className="text-sm text-slate-500">수주 {orderDocNo} 기반</p>}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">거래처 *</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={partner ? `${partner.name} (${partner.biz_no})` : ''}
                placeholder="거래처를 선택하세요"
                className={`${inp} flex-1 cursor-pointer bg-slate-50`}
                onClick={() => setShowPartnerModal(true)}
              />
              <button
                type="button"
                onClick={() => setShowPartnerModal(true)}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">발주일</label>
            <input type="date" className={inp} value={poDate} onChange={e => setPoDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">납기요청일</label>
            <input type="date" className={inp} value={requiredDate} onChange={e => setRequiredDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">결제조건</label>
            <select className={`${inp} bg-white`} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value as PaymentTerms)}>
              {(Object.entries(PAYMENT_TERMS_LABELS) as [PaymentTerms, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">품목</label>
          <MaterialEditor lines={lines} onChange={ls => setLines(ls as POLine[])} />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">비고</label>
          <textarea className={`${inp} min-h-[80px]`} value={remark} onChange={e => setRemark(e.target.value)} placeholder="비고사항 입력..." />
        </div>

        {validLinesForAmount.length > 0 && (
          <div className="flex justify-end">
            <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm min-w-[240px]">
              <div className="flex justify-between">
                <span className="text-slate-500">공급가액</span>
                <span className="text-slate-900">{fmtW(supply)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">부가세 (10%)</span>
                <span className="text-slate-900">{fmtW(tax)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
                <span className="text-slate-700">합계</span>
                <span className="text-indigo-600">{fmtW(total)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button onClick={() => navigate('/pos')} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">취소</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? '저장 중...' : isEdit ? '발주서 수정' : '발주서 저장'}
          </button>
        </div>
      </div>

      {showPartnerModal && (
        <PartnerSearchModal
          partners={purchasePartners}
          title="구매 거래처 검색"
          onSelect={setPartner}
          onClose={() => setShowPartnerModal(false)}
        />
      )}
    </motion.div>
  );
}
