import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { OrderWithPartner, OrderItem, MaterialLine } from '@/types';

export function useOrders() {
  const [orders, setOrders] = useState<OrderWithPartner[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchOrders = useCallback(async (filters?: {
    dateFrom?: string;
    dateTo?: string;
    status?: string;
  }) => {
    setLoading(true);
    let query = supabase
      .from('v_orders_with_partner')
      .select('*')
      .order('order_date', { ascending: false });

    if (filters?.dateFrom) query = query.gte('order_date', filters.dateFrom);
    if (filters?.dateTo) query = query.lte('order_date', filters.dateTo);
    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (!error && data) {
      // 뷰를 재생성하지 않고 orders 테이블에서 AI 메타만 보강 (기존 뷰/데이터 안전)
      const ids = data.map((o: { id: number }) => o.id);
      let merged = data as OrderWithPartner[];
      if (ids.length > 0) {
        const { data: meta } = await supabase
          .from('orders')
          .select('id, source, ai_review_status, ai_mail_message_id')
          .in('id', ids);
        if (meta) {
          const map = new Map(meta.map(m => [m.id, m]));
          merged = data.map((o: OrderWithPartner) => {
            const m = map.get(o.id);
            return m
              ? {
                  ...o,
                  source: m.source ?? 'manual',
                  ai_review_status: m.ai_review_status ?? null,
                  ai_mail_message_id: m.ai_mail_message_id ?? null,
                }
              : { ...o, source: o.source ?? 'manual', ai_review_status: o.ai_review_status ?? null };
          });
        }
      }
      setOrders(merged);
      setLoading(false);
      return { data: merged, error };
    }
    setLoading(false);
    return { data, error };
  }, []);

  const markAiReviewed = useCallback(async (orderId: number) => {
    const { data, error } = await supabase
      .from('orders')
      .update({ ai_review_status: 'reviewed' })
      .eq('id', orderId)
      .eq('source', 'ai_mail')
      .select('id, ai_review_status')
      .single();

    if (!error) {
      setOrders(prev =>
        prev.map(o => (o.id === orderId ? { ...o, ai_review_status: 'reviewed' } : o)),
      );
    }
    return { data, error };
  }, []);

  const fetchOrderItems = useCallback(async (orderId: number) => {
    const { data, error } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)
      .is('deleted_at', null)
      .order('seq', { ascending: true });

    return { data: data as OrderItem[] | null, error };
  }, []);

  const createOrder = useCallback(async (
    orderData: { doc_no: string; order_date: string; partner_id: number; contact_person?: string | null; vessel?: string | null; created_by: number },
    items: MaterialLine[],
  ) => {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        doc_no: orderData.doc_no,
        order_date: orderData.order_date,
        partner_id: orderData.partner_id,
        contact_person: orderData.contact_person ?? null,
        vessel: orderData.vessel ?? null,
        status: 'draft',
        created_by: orderData.created_by,
      })
      .select()
      .single();

    if (orderErr || !order) return { data: null, error: orderErr };

    const itemRows = items.map((item, i) => ({
      order_id: order.id,
      seq: i + 1,
      name: item.name,
      spec: item.spec || null,
      qty: item.qty,
      unit: item.unit,
      price: item.price,
      remark: item.remark || null,
    }));

    const { error: itemErr } = await supabase
      .from('order_items')
      .insert(itemRows);

    if (itemErr) return { data: null, error: itemErr };

    return { data: order, error: null };
  }, []);

  const confirmOrder = useCallback(async (orderId: number) => {
    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'confirmed', delivery_status: 'pending' })
      .eq('id', orderId)
      .select()
      .single();

    if (!error) {
      setOrders(prev => prev.map(o =>
        o.id === orderId ? { ...o, status: 'confirmed' as const, delivery_status: 'pending' as const } : o
      ));
    }
    return { data, error };
  }, []);

  const confirmOrderWithItems = useCallback(async (
    originOrderId: number,
    selectedItems: OrderItem[],
    orderData: { doc_no: string; order_date: string; partner_id: number; contact_person?: string | null; vessel?: string | null; created_by: number },
  ) => {
    const { data: newOrder, error: orderErr } = await supabase
      .from('orders')
      .insert({
        doc_no: orderData.doc_no,
        order_date: orderData.order_date,
        partner_id: orderData.partner_id,
        contact_person: orderData.contact_person ?? null,
        vessel: orderData.vessel ?? null,
        status: 'confirmed',
        delivery_status: 'pending',
        origin_order_id: originOrderId,
        created_by: orderData.created_by,
      })
      .select()
      .single();

    if (orderErr || !newOrder) return { data: null, error: orderErr };

    const itemRows = selectedItems.map((item, i) => ({
      order_id: newOrder.id,
      seq: i + 1,
      name: item.name,
      spec: item.spec || null,
      qty: item.qty,
      unit: item.unit,
      price: item.price,
      remark: item.remark || null,
    }));

    const { error: itemErr } = await supabase
      .from('order_items')
      .insert(itemRows);

    if (itemErr) return { data: null, error: itemErr };

    return { data: newOrder, error: null };
  }, []);

  const updateOrder = useCallback(async (
    orderId: number,
    orderData: { doc_no: string; order_date: string; partner_id: number; contact_person?: string | null; vessel?: string | null },
    items: MaterialLine[],
  ) => {
    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        doc_no: orderData.doc_no,
        order_date: orderData.order_date,
        partner_id: orderData.partner_id,
        contact_person: orderData.contact_person ?? null,
        vessel: orderData.vessel ?? null,
      })
      .eq('id', orderId);

    if (updateErr) return { error: updateErr };

    const { data: existing } = await supabase
      .from('order_items')
      .select('id, seq')
      .eq('order_id', orderId)
      .order('seq', { ascending: true });

    const existingItems = existing || [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = {
        name: item.name,
        spec: item.spec || null,
        qty: item.qty,
        unit: item.unit,
        price: item.price,
        remark: item.remark || null,
      };

      if (i < existingItems.length) {
        await supabase.from('order_items').update({ ...row, seq: i + 1 }).eq('id', existingItems[i].id);
      } else {
        await supabase.from('order_items').insert({ ...row, order_id: orderId, seq: i + 1 });
      }
    }

    if (items.length < existingItems.length) {
      const idsToDelete = existingItems.slice(items.length).map(e => e.id);
      await supabase.from('order_items').delete().in('id', idsToDelete);
    }

    return { error: null };
  }, []);

  /** 수주 확정(발주 전) 건 수정 가능 여부. null이면 수정 가능 */
  const getConfirmedOrderEditBlockReason = useCallback(async (orderId: number): Promise<string | null> => {
    const { data: order } = await supabase
      .from('orders')
      .select('status, delivery_status')
      .eq('id', orderId)
      .single();

    if (!order) return '주문을 찾을 수 없습니다.';
    if (order.status !== 'confirmed') return null;

    if (order.delivery_status === 'completed') {
      return '납품완료된 건은 수정할 수 없습니다.';
    }

    const { count } = await supabase
      .from('pos')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .is('deleted_at', null);

    if (count && count > 0) {
      return '연결된 발주서가 있어 수정할 수 없습니다.';
    }

    return null;
  }, []);

  const revertToDraft = useCallback(async (orderId: number) => {
    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'draft', delivery_status: null, delivery_date: null })
      .eq('id', orderId)
      .select()
      .single();

    if (!error) {
      setOrders(prev => prev.filter(o => o.id !== orderId));
    }
    return { data, error };
  }, []);

  const deleteOrder = useCallback(async (orderId: number) => {
    const now = new Date().toISOString();
    const { error: itemErr } = await supabase
      .from('order_items')
      .update({ deleted_at: now })
      .eq('order_id', orderId)
      .is('deleted_at', null);
    if (itemErr) return { error: itemErr };

    const { data, error } = await supabase
      .from('orders')
      .update({ deleted_at: now })
      .eq('id', orderId)
      .is('deleted_at', null)
      .select('id');
    if (error) return { error };
    if (!data || data.length === 0) {
      return { error: { message: '삭제 권한이 없거나 이미 삭제된 주문서입니다.' } as { message: string } };
    }
    setOrders(prev => prev.filter(o => o.id !== orderId));
    return { error: null };
  }, []);

  return {
    orders, loading, fetchOrders, fetchOrderItems, createOrder, confirmOrder, confirmOrderWithItems,
    updateOrder, getConfirmedOrderEditBlockReason, revertToDraft, deleteOrder, markAiReviewed,
  };
}
