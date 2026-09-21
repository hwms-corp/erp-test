import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { aiDocClient } from '@/lib/aiDocClient';
import { decideProcessStatus, extractionToMaterialLines, matchPartners } from '@/lib/mailMatching';
import type { MailAttachment, MailMessage, CanonicalExtraction } from '@/types/aiMail';
import type { Partner, MaterialLine } from '@/types';
import { today } from '@/types';

export function useMail() {
  const fetchMails = useCallback(async (filters?: { status?: string; q?: string }) => {
    let query = supabase
      .from('mail_messages')
      .select('*')
      .is('deleted_at', null)
      .order('received_at', { ascending: false });

    if (filters?.status) query = query.eq('process_status', filters.status);
    if (filters?.q) {
      query = query.or(`subject.ilike.%${filters.q}%,from_addr.ilike.%${filters.q}%,snippet.ilike.%${filters.q}%`);
    }

    const { data, error } = await query;
    return { data: data as MailMessage[] | null, error };
  }, []);

  const fetchMail = useCallback(async (id: number) => {
    const { data, error } = await supabase
      .from('mail_messages')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    return { data: data as MailMessage | null, error };
  }, []);

  const fetchAttachments = useCallback(async (mailId: number) => {
    const { data, error } = await supabase
      .from('mail_attachments')
      .select('*')
      .eq('mail_message_id', mailId)
      .order('id');
    return { data: data as MailAttachment[] | null, error };
  }, []);

  /** Gmail Push / 수동 수집으로 들어온 메일 저장 (idempotent by gmail_message_id) */
  const upsertMail = useCallback(async (payload: {
    gmail_message_id: string;
    gmail_thread_id?: string | null;
    subject?: string | null;
    from_addr?: string | null;
    to_addr?: string | null;
    received_at?: string;
    snippet?: string | null;
    body_text?: string | null;
    body_html?: string | null;
    attachments?: { filename: string; mime_type?: string; size_bytes?: number; storage_path?: string }[];
  }) => {
    const { data, error } = await supabase
      .from('mail_messages')
      .upsert(
        {
          gmail_message_id: payload.gmail_message_id,
          gmail_thread_id: payload.gmail_thread_id ?? null,
          subject: payload.subject ?? null,
          from_addr: payload.from_addr ?? null,
          to_addr: payload.to_addr ?? null,
          received_at: payload.received_at ?? new Date().toISOString(),
          snippet: payload.snippet ?? null,
          body_text: payload.body_text ?? null,
          body_html: payload.body_html ?? null,
          process_status: 'received',
        },
        { onConflict: 'gmail_message_id' },
      )
      .select()
      .single();

    if (error || !data) return { data: null, error };

    if (payload.attachments?.length) {
      await supabase.from('mail_attachments').insert(
        payload.attachments.map(a => ({
          mail_message_id: data.id,
          filename: a.filename,
          mime_type: a.mime_type ?? null,
          size_bytes: a.size_bytes ?? null,
          storage_path: a.storage_path ?? null,
        })),
      );
    }

    return { data: data as MailMessage, error: null };
  }, []);

  const runAiPipeline = useCallback(async (mail: MailMessage, attachmentTexts?: { filename: string; text: string }[]) => {
    await supabase
      .from('mail_messages')
      .update({ process_status: 'classifying' })
      .eq('id', mail.id);

    const text = [mail.body_text || mail.snippet || '', ...(attachmentTexts?.map(a => a.text) || [])].join('\n');

    try {
      const cls = await aiDocClient.classify(text);
      const isRfq = cls.data.document_type === 'quotation_request';

      await supabase
        .from('mail_messages')
        .update({
          is_rfq: isRfq,
          classify_confidence: cls.data.confidence,
          process_status: isRfq ? 'extracting' : 'rejected',
        })
        .eq('id', mail.id);

      if (!isRfq) {
        return { data: null, error: null, rejected: true as const };
      }

      const job = await aiDocClient.createJob({
        text,
        files: attachmentTexts?.map(a => ({ filename: a.filename, text: a.text, mime_type: 'text/plain' })),
      });

      await supabase.from('mail_ai_jobs').upsert(
        {
          mail_message_id: mail.id,
          external_job_id: job.job_id,
          status: job.status,
          request_payload: { text_len: text.length },
        },
        { onConflict: 'external_job_id' },
      );

      const done = await aiDocClient.pollJob(job.job_id);
      if (done.status === 'failed' || !done.result) {
        await supabase
          .from('mail_messages')
          .update({ process_status: 'failed', error_message: done.error || 'extract failed', ai_job_id: job.job_id })
          .eq('id', mail.id);
        return { data: null, error: { message: done.error || 'extract failed' }, rejected: false as const };
      }

      const status = decideProcessStatus(done.result);
      const { data, error } = await supabase
        .from('mail_messages')
        .update({
          extraction: done.result,
          process_status: status,
          ai_job_id: job.job_id,
          error_message: null,
        })
        .eq('id', mail.id)
        .select()
        .single();

      await supabase
        .from('mail_ai_jobs')
        .update({ status: 'completed', result_payload: done.result })
        .eq('external_job_id', job.job_id);

      return { data: data as MailMessage | null, error, rejected: false as const };
    } catch (e) {
      const msg = (e as Error).message;
      await supabase
        .from('mail_messages')
        .update({ process_status: 'failed', error_message: msg })
        .eq('id', mail.id);
      return { data: null, error: { message: msg }, rejected: false as const };
    }
  }, []);

  const saveExtraction = useCallback(async (
    mailId: number,
    extraction: CanonicalExtraction,
    corrections?: { field_path: string; ai_value: unknown; corrected_value: unknown; corrected_by?: number }[],
  ) => {
    const status = decideProcessStatus(extraction);
    const { data, error } = await supabase
      .from('mail_messages')
      .update({ extraction, process_status: status })
      .eq('id', mailId)
      .select()
      .single();

    if (corrections?.length) {
      await supabase.from('mail_corrections').insert(
        corrections.map(c => ({
          mail_message_id: mailId,
          field_path: c.field_path,
          ai_value: c.ai_value,
          corrected_value: c.corrected_value,
          corrected_by: c.corrected_by ?? null,
        })),
      );
    }

    return { data: data as MailMessage | null, error };
  }, []);

  const registerAsDraft = useCallback(async (
    mail: MailMessage,
    partnerId: number,
    createdBy: number,
    overrides?: { order_date?: string; contact_person?: string | null; vessel?: string | null; items?: MaterialLine[] },
  ) => {
    const extraction = mail.extraction;
    if (!extraction) return { data: null, error: { message: 'extraction missing' } };

    const items = overrides?.items ?? extractionToMaterialLines(extraction);
    if (!items.length) return { data: null, error: { message: 'no line items' } };

    // 견적의뢰서 문서번호가 있으면 그대로 사용. 없으면 임시번호로라도 draft 등록 (검토대기에서 수정)
    const extractedDocNo = (extraction.request.document_no?.value || '').toString().trim();
    const docNo = extractedDocNo || `미확인-${mail.id}`;

    const orderDate = overrides?.order_date
      || extraction.request.request_date.value
      || today();

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        doc_no: docNo,
        order_date: orderDate,
        partner_id: partnerId,
        contact_person: overrides?.contact_person
          ?? extraction.request.contact_person.value
          ?? extraction.customer.contact_name.value
          ?? null,
        vessel: overrides?.vessel ?? extraction.request.vessel.value ?? null,
        status: 'draft',
        source: 'ai_mail',
        ai_review_status: 'pending_review',
        ai_mail_message_id: mail.id,
        created_by: createdBy,
      })
      .select()
      .single();

    if (orderErr || !order) return { data: null, error: orderErr };

    const { error: itemErr } = await supabase.from('order_items').insert(
      items.map((item, i) => ({
        order_id: order.id,
        seq: i + 1,
        name: item.name,
        spec: item.spec || null,
        qty: item.qty,
        unit: item.unit,
        price: item.price,
        remark: item.remark || null,
      })),
    );

    if (itemErr) return { data: null, error: itemErr };

    await supabase
      .from('mail_messages')
      .update({
        process_status: 'registered',
        matched_partner_id: partnerId,
        registered_order_id: order.id,
      })
      .eq('id', mail.id);

    return { data: order, error: null };
  }, []);

  const suggestPartners = useCallback((extraction: CanonicalExtraction, partners: Partner[]) =>
    matchPartners(extraction, partners),
  []);

  return {
    fetchMails,
    fetchMail,
    fetchAttachments,
    upsertMail,
    runAiPipeline,
    saveExtraction,
    registerAsDraft,
    suggestPartners,
  };
}
