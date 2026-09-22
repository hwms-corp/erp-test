import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { POWithDetail, POItem, POLine } from '@/types';

export function usePOs() {
  const [pos, setPos] = useState<POWithDetail[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPOs = useCallback(async (filters?: {
    dateFrom?: string;
    dateTo?: string;
    status?: string;
  }) => {
    setLoading(true);
    let query = supabase
      .from('v_pos_with_detail')
      .select('*')
      .order('po_date', { ascending: false });

    if (filters?.dateFrom) query = query.gte('po_date', filters.dateFrom);
    if (filters?.dateTo) query = query.lte('po_date', filters.dateTo);
    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (!error && data) setPos(data);
    setLoading(false);
    return { data, error };
  }, []);

  const fetchPOItems = useCallback(async (poId: number) => {
    const { data, error } = await supabase
      .from('po_items')
      .select('*')
      .eq('po_id', poId)
      .is('deleted_at', null)
      .order('seq', { ascending: true });

    return { data: data as POItem[] | null, error };
  }, []);

  const createPO = useCallback(async (
    poData: {
      po_date: string;
      partner_id: number;
      order_id?: number;
      required_date?: string;
      payment_terms: string;
      remark?: string;
      created_by: number;
    },
    items: POLine[],
  ) => {
    const validItems = items.filter(i => i.name.trim() && Number(i.qty) > 0);
    if (!validItems.length) {
      return {
        data: null,
        error: { message: '품명과 수량(1 이상)이 있는 품목이 필요합니다.' } as { message: string },
      };
    }

    const { data: po, error: poErr } = await supabase
      .from('pos')
      .insert({
        doc_no: '',
        po_date: poData.po_date,
        partner_id: poData.partner_id,
        order_id: poData.order_id || null,
        required_date: poData.required_date || null,
        payment_terms: poData.payment_terms,
        remark: poData.remark || null,
        created_by: poData.created_by,
      })
      .select()
      .single();

    if (poErr || !po) return { data: null, error: poErr };

    const itemRows = validItems.map((item, i) => ({
      po_id: po.id,
      order_item_id: item.order_item_id || null,
      seq: i + 1,
      name: item.name.trim(),
      spec: item.spec || null,
      qty: item.qty,
      unit: item.unit,
      price: item.price,
      remark: item.remark || null,
      received_qty: 0,
    }));

    const { error: itemErr } = await supabase
      .from('po_items')
      .insert(itemRows);

    if (itemErr) {
      // 품목 실패 시 헤더 고아 행 제거 (빈 발주서 잔존 방지)
      const now = new Date().toISOString();
      await supabase
        .from('pos')
        .update({ deleted_at: now })
        .eq('id', po.id)
        .is('deleted_at', null);
      return { data: null, error: itemErr };
    }

    return { data: po, error: null };
  }, []);

  const updateReceivedQty = useCallback(async (poItemId: number, receivedQty: number) => {
    const { data, error } = await supabase
      .from('po_items')
      .update({ received_qty: receivedQty })
      .eq('id', poItemId)
      .select()
      .single();

    return { data, error };
  }, []);

  const completeFullReceive = useCallback(async (
    poId: number,
    items: { id: number; qty: number; received_qty: number }[],
    receivedDate: string,
  ) => {
    for (const item of items) {
      if (item.received_qty < item.qty) {
        const { error } = await supabase
          .from('po_items')
          .update({ received_qty: item.qty })
          .eq('id', item.id);
        if (error) return { error };
      }
    }

    const { data, error } = await supabase
      .from('pos')
      .update({ received_date: receivedDate })
      .eq('id', poId)
      .select()
      .single();

    return { data, error };
  }, []);

  const checkOrderHasPO = useCallback(async (orderId: number): Promise<boolean> => {
    const { count } = await supabase
      .from('pos')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId);

    return (count ?? 0) > 0;
  }, []);

  const updatePO = useCallback(async (
    poId: number,
    poData: {
      po_date: string;
      partner_id: number;
      required_date?: string;
      payment_terms: string;
      remark?: string;
    },
    items: POLine[],
  ) => {
    const { error: updateErr } = await supabase
      .from('pos')
      .update({
        po_date: poData.po_date,
        partner_id: poData.partner_id,
        required_date: poData.required_date || null,
        payment_terms: poData.payment_terms,
        remark: poData.remark || null,
      })
      .eq('id', poId);

    if (updateErr) return { error: updateErr };

    const { data: existing, error: existingErr } = await supabase
      .from('po_items')
      .select('id, seq, deleted_at')
      .eq('po_id', poId)
      .order('seq', { ascending: true });

    if (existingErr) return { error: existingErr };

    const existingItems = existing || [];
    const activeBySeq = new Map<number, { id: number; seq: number; deleted_at: string | null }>();
    const deletedBySeq = new Map<number, { id: number; seq: number; deleted_at: string | null }>();

    existingItems.forEach(item => {
      if (item.deleted_at) deletedBySeq.set(item.seq, item);
      else activeBySeq.set(item.seq, item);
    });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = {
        name: item.name,
        spec: item.spec || null,
        qty: item.qty,
        unit: item.unit,
        price: item.price,
        remark: item.remark || null,
        order_item_id: item.order_item_id || null,
      };

      const seq = i + 1;
      const active = activeBySeq.get(seq);
      const deleted = deletedBySeq.get(seq);

      if (active) {
        const { error } = await supabase.from('po_items').update({ ...row, seq }).eq('id', active.id);
        if (error) return { error };
      } else if (deleted) {
        const { error } = await supabase
          .from('po_items')
          .update({ ...row, seq, deleted_at: null, received_qty: 0 })
          .eq('id', deleted.id);
        if (error) return { error };
      } else {
        const { error } = await supabase.from('po_items').insert({ ...row, po_id: poId, seq, received_qty: 0 });
        if (error) return { error };
      }
    }

    const idsToDelete = Array.from(activeBySeq.entries())
      .filter(([seq]) => seq > items.length)
      .map(([, item]) => item.id);

    if (idsToDelete.length > 0) {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('po_items')
        .update({ deleted_at: now })
        .in('id', idsToDelete);
      if (error) return { error };
    }

    return { error: null };
  }, []);

  const completeRemittance = useCallback(async (poId: number, remittanceDate: string) => {
    const { data, error } = await supabase
      .from('pos')
      .update({
        remittance_status: 'completed',
        remittance_date: remittanceDate,
      })
      .eq('id', poId)
      .select()
      .single();

    return { data, error };
  }, []);

  const clearRemittance = useCallback(async (poId: number) => {
    const { error } = await supabase
      .from('pos')
      .update({
        remittance_status: null,
        remittance_date: null,
      })
      .eq('id', poId);

    return { error };
  }, []);

  const completeExpectedReceipt = useCallback(async (poId: number, expectedDate: string) => {
    const { data, error } = await supabase
      .from('pos')
      .update({
        expected_receipt_status: 'scheduled',
        expected_receipt_date: expectedDate,
      })
      .eq('id', poId)
      .select()
      .single();

    return { data, error };
  }, []);

  const clearExpectedReceipt = useCallback(async (poId: number) => {
    const { error } = await supabase
      .from('pos')
      .update({
        expected_receipt_status: null,
        expected_receipt_date: null,
      })
      .eq('id', poId);

    return { error };
  }, []);

  const deletePO = useCallback(async (poId: number) => {
    const now = new Date().toISOString();
    const { error: itemErr } = await supabase
      .from('po_items')
      .update({ deleted_at: now })
      .eq('po_id', poId)
      .is('deleted_at', null);
    if (itemErr) return { error: itemErr };

    const { data, error } = await supabase
      .from('pos')
      .update({ deleted_at: now })
      .eq('id', poId)
      .is('deleted_at', null)
      .select('id');
    if (error) return { error };
    if (!data || data.length === 0) {
      return { error: { message: '삭제 권한이 없거나 이미 삭제된 발주서입니다.' } as { message: string } };
    }
    setPos(prev => prev.filter(p => p.id !== poId));
    return { error: null };
  }, []);

  return {
    pos,
    loading,
    fetchPOs,
    fetchPOItems,
    createPO,
    updatePO,
    updateReceivedQty,
    completeFullReceive,
    completeRemittance,
    clearRemittance,
    completeExpectedReceipt,
    clearExpectedReceipt,
    checkOrderHasPO,
    deletePO,
  };
}
