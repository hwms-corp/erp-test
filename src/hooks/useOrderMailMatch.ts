import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  assignOrderMailMatches,
  buildMailCorpus,
  type OrderMailMatchRow,
} from '@/lib/orderMailMatch';
import type { MailAttachment, MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';

const MAIL_PAGE = 1000;

async function fetchAllInboundMails(): Promise<MailMessage[]> {
  const all: MailMessage[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('mail_messages')
      .select(
        'id, gmail_message_id, gmail_thread_id, history_id, subject, from_addr, to_addr, received_at, snippet, body_text, body_html, is_rfq, classify_confidence, process_status, ai_job_id, extraction, matched_partner_id, registered_order_id, error_message, status_reason, is_starred, starred_at, is_sent, gmail_label_ids, is_read, read_at, created_at, updated_at, deleted_at',
      )
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + MAIL_PAGE - 1);
    if (error) throw error;
    const batch = (data || []) as MailMessage[];
    all.push(...batch);
    if (batch.length < MAIL_PAGE) break;
    from += MAIL_PAGE;
  }
  return all;
}

async function fetchAttachmentNamesByMail(
  mailIds: number[],
): Promise<Map<number, Pick<MailAttachment, 'filename'>[]>> {
  const map = new Map<number, Pick<MailAttachment, 'filename'>[]>();
  const chunk = 200;
  for (let i = 0; i < mailIds.length; i += chunk) {
    const ids = mailIds.slice(i, i + chunk);
    const { data, error } = await supabase
      .from('mail_attachments')
      .select('mail_message_id, filename')
      .in('mail_message_id', ids);
    if (error) throw error;
    for (const row of data || []) {
      const mid = row.mail_message_id as number;
      const list = map.get(mid) || [];
      list.push({ filename: row.filename as string });
      map.set(mid, list);
    }
  }
  return map;
}

export function useOrderMailMatch() {
  const [rows, setRows] = useState<OrderMailMatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  const runMatch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress('견적서 불러오는 중…');
    try {
      const { data: orderRows, error: orderErr } = await supabase
        .from('v_orders_with_partner')
        .select('*')
        .order('order_date', { ascending: false });
      if (orderErr) throw orderErr;
      const baseOrders = (orderRows || []) as OrderWithPartner[];
      const orderIds = baseOrders.map(o => o.id);

      let orders = baseOrders;
      if (orderIds.length) {
        const { data: meta } = await supabase
          .from('orders')
          .select('id, source, ai_review_status, ai_mail_message_id')
          .in('id', orderIds);
        if (meta) {
          const map = new Map(meta.map(m => [m.id, m]));
          orders = baseOrders.map(o => {
            const m = map.get(o.id);
            return m
              ? {
                  ...o,
                  source: m.source ?? o.source ?? 'manual',
                  ai_review_status: m.ai_review_status ?? o.ai_review_status ?? null,
                  ai_mail_message_id: m.ai_mail_message_id ?? null,
                }
              : o;
          });
        }
      }

      setProgress('견적 품목 불러오는 중…');
      const itemsByOrderId = new Map<number, OrderItem[]>();
      for (let i = 0; i < orderIds.length; i += 200) {
        const ids = orderIds.slice(i, i + 200);
        const { data: items, error: itemErr } = await supabase
          .from('order_items')
          .select('*')
          .in('order_id', ids)
          .is('deleted_at', null)
          .order('seq', { ascending: true });
        if (itemErr) throw itemErr;
        for (const it of (items || []) as OrderItem[]) {
          const list = itemsByOrderId.get(it.order_id) || [];
          list.push(it);
          itemsByOrderId.set(it.order_id, list);
        }
      }

      setProgress('거래처 이메일 불러오는 중…');
      const partnerIds = [...new Set(orders.map(o => o.partner_id))];
      const partnerEmailById = new Map<number, string | null>();
      for (let i = 0; i < partnerIds.length; i += 200) {
        const ids = partnerIds.slice(i, i + 200);
        const { data: partners, error: pErr } = await supabase
          .from('partners')
          .select('id, email')
          .in('id', ids);
        if (pErr) throw pErr;
        for (const p of partners || []) {
          partnerEmailById.set(p.id as number, (p.email as string | null) || null);
        }
      }

      setProgress('메일 불러오는 중…');
      const mails = await fetchAllInboundMails();
      setProgress(`첨부파일명 정리 중… (${mails.length}통)`);
      const attMap = await fetchAttachmentNamesByMail(mails.map(m => m.id));
      const corpora = mails.map(m => buildMailCorpus(m, attMap.get(m.id) || []));

      setProgress('1:1 매칭 계산 중…');
      // yield to UI
      await new Promise(r => setTimeout(r, 0));
      const matched = assignOrderMailMatches({
        orders,
        itemsByOrderId,
        partnerEmailById,
        corpora,
      });
      setRows(matched);
      setProgress('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '매칭 실패';
      setError(msg);
      setProgress('');
    } finally {
      setLoading(false);
    }
  }, []);

  return { rows, loading, error, progress, runMatch };
}
