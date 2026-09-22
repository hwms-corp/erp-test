import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { aiDocClient } from '@/lib/aiDocClient';
import { decideProcessStatus, extractionToMaterialLines, matchPartners } from '@/lib/mailMatching';
import { displayMailBody } from '@/lib/mailBody';
import type { MailAttachment, MailMessage, CanonicalExtraction } from '@/types/aiMail';
import type { Partner, MaterialLine } from '@/types';
import { today } from '@/types';

export function useMail() {
  const fetchMails = useCallback(async (filters?: {
    status?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = Math.max(1, filters?.pageSize ?? 20);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('mail_messages')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      // 즐겨찾기 최상단, 최근 별표가 더 위, 그다음 수신시각
      .order('is_starred', { ascending: false })
      .order('starred_at', { ascending: false, nullsFirst: false })
      .order('received_at', { ascending: false })
      .range(from, to);

    if (filters?.status) query = query.eq('process_status', filters.status);
    if (filters?.q) {
      query = query.or(`subject.ilike.%${filters.q}%,from_addr.ilike.%${filters.q}%,snippet.ilike.%${filters.q}%`);
    }

    const { data, error, count } = await query;
    return {
      data: data as MailMessage[] | null,
      error,
      count: count ?? 0,
      page,
      pageSize,
    };
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

  /** 같은 Gmail 스레드의 다른 수신 메일 (이전/이후 이동용) */
  const fetchThreadMails = useCallback(async (threadId: string) => {
    const { data, error } = await supabase
      .from('mail_messages')
      .select('id, subject, from_addr, received_at, process_status, gmail_message_id, gmail_thread_id')
      .eq('gmail_thread_id', threadId)
      .is('deleted_at', null)
      .order('received_at', { ascending: true });
    return {
      data: (data ?? []) as Pick<
        MailMessage,
        'id' | 'subject' | 'from_addr' | 'received_at' | 'process_status' | 'gmail_message_id' | 'gmail_thread_id'
      >[],
      error,
    };
  }, []);

  const fetchAttachments = useCallback(async (mailId: number) => {
    const { data, error } = await supabase
      .from('mail_attachments')
      .select('*')
      .eq('mail_message_id', mailId)
      .order('id');
    return { data: data as MailAttachment[] | null, error };
  }, []);

  const markMailRead = useCallback(async (mailId: number) => {
    const { data, error } = await supabase
      .from('mail_messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', mailId)
      .eq('is_read', false)
      .select()
      .maybeSingle();
    return { data: data as MailMessage | null, error };
  }, []);

  /** 메일함 soft-delete (deleted_at) */
  const softDeleteMails = useCallback(async (ids: number[]) => {
    const unique = [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))];
    if (!unique.length) {
      return { error: { message: '삭제할 메일을 선택하세요.' } as { message: string }, count: 0 };
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('mail_messages')
      .update({ deleted_at: now, updated_at: now })
      .in('id', unique)
      .is('deleted_at', null)
      .select('id');
    if (error) return { error, count: 0 };
    return { error: null, count: data?.length ?? 0 };
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
    attachments?: {
      filename: string;
      mime_type?: string;
      size_bytes?: number;
      storage_path?: string;
      gmail_attachment_id?: string;
    }[];
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
          gmail_attachment_id: a.gmail_attachment_id ?? null,
        })),
      );
    }

    return { data: data as MailMessage, error: null };
  }, []);

  const runAiPipeline = useCallback(async (
    mail: MailMessage,
    opts?: {
      attachmentTexts?: { filename: string; text: string }[];
      files?: { filename: string; mime_type?: string; text?: string; content_base64?: string }[];
      /** 수동 재실행: 항상 검토필요로 두고 자동등록 경로를 타지 않음 */
      forceReviewRequired?: boolean;
      onProgress?: (step: string) => void;
    },
  ) => {
    const attachmentTexts = opts?.attachmentTexts;
    const forceReview = !!opts?.forceReviewRequired;
    const onProgress = opts?.onProgress;

    onProgress?.('분류 준비 중…');
    await supabase
      .from('mail_messages')
      .update({ process_status: 'classifying', error_message: null })
      .eq('id', mail.id);

    const text = [
      mail.subject ? `[제목] ${mail.subject}` : '',
      displayMailBody(mail),
      ...(attachmentTexts?.map(a => a.text) || []),
    ].filter(Boolean).join('\n');

    // 분류·추출 모두 동일 첨부 사용 (본문만으로 비견적 오판 방지)
    const jobFiles = [
      ...(opts?.files || []),
      ...(attachmentTexts?.map(a => ({
        filename: a.filename,
        text: a.text,
        mime_type: 'text/plain',
      })) || []),
    ];

    try {
      onProgress?.(
        jobFiles.length
          ? `문서 분류 중… (첨부 ${jobFiles.length}개)`
          : '문서 분류 중…',
      );
      const cls = await aiDocClient.classify(text, jobFiles.length ? jobFiles : undefined);
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
        onProgress?.('견적의뢰가 아닌 문서로 분류됨');
        const { data } = await supabase.from('mail_messages').select('*').eq('id', mail.id).single();
        return { data: data as MailMessage | null, error: null, rejected: true as const };
      }

      onProgress?.('정보 추출 중…');
      const job = await aiDocClient.createJob({
        text,
        files: jobFiles.length ? jobFiles : undefined,
      });

      await supabase.from('mail_ai_jobs').upsert(
        {
          mail_message_id: mail.id,
          external_job_id: job.job_id,
          status: job.status,
          request_payload: { text_len: text.length, file_count: jobFiles.length, force_review: forceReview },
        },
        { onConflict: 'external_job_id' },
      );

      onProgress?.('추출 결과 확인 중…');
      const done = await aiDocClient.pollJob(job.job_id, { timeoutMs: 90000 });
      if (done.status === 'failed' || !done.result) {
        await supabase
          .from('mail_messages')
          .update({ process_status: 'failed', error_message: done.error || 'extract failed', ai_job_id: job.job_id })
          .eq('id', mail.id);
        return { data: null, error: { message: done.error || '추출 실패' }, rejected: false as const };
      }

      // 수동 재실행은 항상 검토필요 — 자동등록(ready_auto) 경로 차단
      const status = forceReview ? 'review_required' : decideProcessStatus(done.result);
      onProgress?.('결과 저장 중…');
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

  const fetchMailAiSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('mail_ai_settings')
      .select('id, auto_register_draft, api_base_url, api_key, updated_at, updated_by')
      .eq('id', 1)
      .maybeSingle();
    return {
      data: data as {
        id: number;
        auto_register_draft: boolean;
        api_base_url: string | null;
        api_key: string | null;
        updated_at: string;
        updated_by: number | null;
      } | null,
      error,
    };
  }, []);

  const updateMailAiSettings = useCallback(async (
    patch: {
      auto_register_draft?: boolean;
      api_base_url?: string | null;
      api_key?: string | null;
    },
    updatedBy: number,
  ) => {
    const { data, error } = await supabase
      .from('mail_ai_settings')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      })
      .eq('id', 1)
      .select('id, auto_register_draft, api_base_url, api_key, updated_at, updated_by')
      .single();
    return {
      data: data as {
        id: number;
        auto_register_draft: boolean;
        api_base_url: string | null;
        api_key: string | null;
        updated_at: string;
        updated_by: number | null;
      } | null,
      error,
    };
  }, []);

  /** 즐겨찾기 토글 — 별표 시 starred_at=now (최근 별표가 목록 최상단) */
  const setMailStarred = useCallback(async (id: number, starred: boolean) => {
    const { data, error } = await supabase
      .from('mail_messages')
      .update({
        is_starred: starred,
        starred_at: starred ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .maybeSingle();
    return { data: data as MailMessage | null, error };
  }, []);

  return {
    fetchMails,
    fetchMail,
    fetchThreadMails,
    fetchAttachments,
    markMailRead,
    softDeleteMails,
    setMailStarred,
    upsertMail,
    runAiPipeline,
    saveExtraction,
    registerAsDraft,
    suggestPartners,
    fetchMailAiSettings,
    updateMailAiSettings,
  };
}
