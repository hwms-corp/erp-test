import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { aiDocClient } from '@/lib/aiDocClient';
import { decideProcessStatus, extractionToMaterialLines, matchPartners } from '@/lib/mailMatching';
import { displayMailBody } from '@/lib/mailBody';
import { mirrorToGmail } from '@/lib/gmailMirror';
import type { MailAttachment, MailBoxId, MailMessage, CanonicalExtraction } from '@/types/aiMail';
import type { Partner, MaterialLine } from '@/types';
import { today } from '@/types';

const PROCESS_STATUSES = new Set([
  'received',
  'classifying',
  'extracting',
  'review_required',
  'ready_auto',
  'registered',
  'rejected',
  'failed',
]);

export function useMail() {
  const fetchMails = useCallback(async (filters?: {
    /** left 메일함. status 계열이면 process_status 필터 */
    box?: MailBoxId | string;
    /** @deprecated box 사용 권장 — 하위호환 */
    status?: string;
    q?: string;
    page?: number;
    pageSize?: number;
    /** 전체/받은/보낸: 즐겨찾기 우선 정렬 (기본 true) */
    starPriority?: boolean;
  }) => {
    const page = Math.max(1, filters?.page ?? 1);
    const pageSize = Math.max(1, filters?.pageSize ?? 30);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const box = (filters?.box || filters?.status || 'all') as string;
    const inTrash = box === 'trash';
    const starPriority = filters?.starPriority !== false;

    let query = supabase
      .from('mail_messages')
      .select('*', { count: 'exact' });

    if (inTrash) {
      query = query.not('deleted_at', 'is', null);
    } else {
      query = query.is('deleted_at', null);
    }

    if (box === 'latest') {
      // 받은메일 중 즐겨찾기 없음 — 안읽음 우선, 그다음 최신순
      query = query.eq('is_sent', false).eq('is_starred', false);
    } else if (box === 'starred') {
      query = query.eq('is_starred', true);
    } else if (box === 'inbox') {
      query = query.eq('is_sent', false);
    } else if (box === 'sent') {
      query = query.eq('is_sent', true);
    } else if (box === 'read') {
      query = query.eq('is_sent', false).eq('is_read', true);
    } else if (box === 'unread') {
      // null도 안읽음 취급이지만 현재 DB는 false만 사용
      query = query.eq('is_sent', false).eq('is_read', false);
    } else if (box.startsWith('label:')) {
      const labelId = box.slice('label:'.length);
      if (labelId) query = query.contains('gmail_label_ids', [labelId]);
    } else if (box !== 'all' && box !== 'trash' && PROCESS_STATUSES.has(box)) {
      query = query.eq('process_status', box);
    }

    const isMixedMailbox = box === 'all' || box === 'inbox' || box === 'sent';
    if (box === 'latest' || box === 'unread' || box === 'read') {
      query = query
        .order('is_read', { ascending: true, nullsFirst: true })
        .order('received_at', { ascending: false });
    } else if (isMixedMailbox && !starPriority) {
      query = query.order('received_at', { ascending: false });
    } else {
      query = query
        // 즐겨찾기 최상단, 최근 별표가 더 위, 그다음 수신시각
        .order('is_starred', { ascending: false })
        .order('starred_at', { ascending: false, nullsFirst: false })
        .order('received_at', { ascending: false });
    }
    query = query.range(from, to);

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
    // 휴지통 메일도 상세 열람 가능 (deleted_at 필터 없음)
    const { data, error } = await supabase
      .from('mail_messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();
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

  /** 메일함 soft-delete → Gmail 휴지통 미러 */
  const softDeleteMails = useCallback(async (ids: number[]) => {
    const unique = [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))];
    if (!unique.length) {
      return { error: { message: '삭제할 메일을 선택하세요.' } as { message: string }, count: 0 };
    }
    const { ok, okCount, error: mirrorErr } = await mirrorToGmail({ action: 'trash', mailIds: unique });
    if (!ok && okCount === 0) {
      return { error: { message: mirrorErr || 'Gmail 휴지통 이동 실패' }, count: 0 };
    }
    return { error: null, count: okCount };
  }, []);

  /** 휴지통 → 복원 (Gmail untrash) */
  const restoreMails = useCallback(async (ids: number[]) => {
    const unique = [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))];
    if (!unique.length) {
      return { error: { message: '복원할 메일을 선택하세요.' } as { message: string }, count: 0 };
    }
    const { ok, okCount, error: mirrorErr } = await mirrorToGmail({ action: 'untrash', mailIds: unique });
    if (!ok && okCount === 0) {
      return { error: { message: mirrorErr || 'Gmail 복원 실패' }, count: 0 };
    }
    return { error: null, count: okCount };
  }, []);

  /** 휴지통에서 완전 삭제 (Gmail + DB) */
  const hardDeleteMails = useCallback(async (ids: number[]) => {
    const unique = [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))];
    if (!unique.length) {
      return { error: { message: '완전 삭제할 메일을 선택하세요.' } as { message: string }, count: 0 };
    }
    const { ok, okCount, error: mirrorErr } = await mirrorToGmail({
      action: 'delete_forever',
      mailIds: unique,
    });
    if (!ok && okCount === 0) {
      return { error: { message: mirrorErr || '완전 삭제 실패' }, count: 0 };
    }
    return { error: null, count: okCount };
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
      .update({ process_status: 'classifying', error_message: null, status_reason: null })
      .eq('id', mail.id);

    // gmail-watch 자동 분류와 동일한 본문 포맷 ([발신]/[제목]/[본문])
    const bodyPart = displayMailBody(mail);
    const text = [
      mail.from_addr ? `[발신]\n${mail.from_addr}` : '',
      mail.subject ? `[제목]\n${mail.subject}` : '',
      bodyPart && bodyPart !== '(본문 없음)' ? `[본문]\n${bodyPart}` : '',
      !mail.body_text && mail.snippet ? `[스니펫]\n${mail.snippet}` : '',
      ...(attachmentTexts?.map(a => a.text) || []),
    ].filter(Boolean).join('\n\n');

    // 분류·추출 모두 동일 첨부 (자동 수신 collectOcrFiles 와 같은 후보)
    const jobFiles = [
      ...(opts?.files || []),
      ...(attachmentTexts?.map(a => ({
        filename: a.filename,
        text: a.text,
        mime_type: 'text/plain',
      })) || []),
    ];
    const payloadFiles = jobFiles.length ? jobFiles : undefined;
    const syncJobId = `sync_${crypto.randomUUID()}`;

    try {
      onProgress?.(
        jobFiles.length
          ? `문서 분류 중… (첨부 ${jobFiles.length}개)`
          : '문서 분류 중…',
      );

      await supabase.from('mail_ai_jobs').upsert(
        {
          mail_message_id: mail.id,
          external_job_id: syncJobId,
          status: 'processing',
          request_payload: {
            source: forceReview ? 'manual_rerun' : 'client',
            text_len: text.length,
            file_count: jobFiles.length,
            files: jobFiles.map(f => f.filename),
            force_review: forceReview,
          },
        },
        { onConflict: 'external_job_id' },
      );

      // 자동(gmail-watch)과 동일: classify → extract (sync). /v1/jobs 는 쓰지 않음.
      const cls = await aiDocClient.classify(text, payloadFiles);
      const isRfq = cls.data.document_type === 'quotation_request';

      await supabase
        .from('mail_messages')
        .update({
          is_rfq: isRfq,
          classify_confidence: cls.data.confidence,
          process_status: isRfq ? 'extracting' : 'rejected',
          ai_job_id: syncJobId,
        })
        .eq('id', mail.id);

      if (!isRfq) {
        onProgress?.('견적의뢰가 아닌 문서로 분류됨');
        await supabase
          .from('mail_ai_jobs')
          .update({
            status: 'completed',
            result_payload: { classify: cls.data, rejected: true },
          })
          .eq('external_job_id', syncJobId);
        const { data } = await supabase.from('mail_messages').select('*').eq('id', mail.id).single();
        return { data: data as MailMessage | null, error: null, rejected: true as const };
      }

      onProgress?.('정보 추출 중…');
      const extracted = await aiDocClient.extract(text, payloadFiles);
      const result = extracted.data;
      const itemCount = (result.items || []).filter(
        i => i.product_name?.value && String(i.product_name.value).trim(),
      ).length;

      // 수동 재실행은 항상 검토필요 — 자동등록(ready_auto) 경로 차단
      const status = forceReview ? 'review_required' : decideProcessStatus(result);
      const statusReason =
        jobFiles.length > 0 && itemCount === 0 && status === 'review_required'
          ? `첨부 ${jobFiles.length}개 전달됐으나 의뢰 품목을 추출하지 못함 — 검토 필요`
          : forceReview
            ? '수동 재실행 — 검토 필요 (자동등록 미실행)'
            : null;

      onProgress?.('결과 저장 중…');
      const { data, error } = await supabase
        .from('mail_messages')
        .update({
          extraction: result,
          process_status: status,
          ai_job_id: syncJobId,
          error_message: null,
          status_reason: statusReason,
        })
        .eq('id', mail.id)
        .select()
        .single();

      await supabase
        .from('mail_ai_jobs')
        .update({
          status: 'completed',
          result_payload: { classify: cls.data, extraction: result },
        })
        .eq('external_job_id', syncJobId);

      return { data: data as MailMessage | null, error, rejected: false as const };
    } catch (e) {
      const msg = (e as Error).message;
      await supabase
        .from('mail_messages')
        .update({ process_status: 'failed', error_message: msg })
        .eq('id', mail.id);
      await supabase
        .from('mail_ai_jobs')
        .update({ status: 'failed', error_message: msg.slice(0, 500) })
        .eq('external_job_id', syncJobId);
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
    overrides?: {
      doc_no?: string;
      order_date?: string;
      contact_person?: string | null;
      vessel?: string | null;
      items?: MaterialLine[];
    },
  ) => {
    const extraction = mail.extraction;
    if (!extraction) return { data: null, error: { message: 'extraction missing' } };

    const items = (overrides?.items ?? extractionToMaterialLines(extraction)).filter(l => l.name.trim());
    if (!items.length) return { data: null, error: { message: 'no line items' } };

    // 견적서 작성 폼의 견적번호 우선. 없으면 AI 문서번호 → 임시번호
    const formDocNo = (overrides?.doc_no || '').toString().trim();
    const extractedDocNo = (extraction.request.document_no?.value || '').toString().trim();
    const docNo = formDocNo || extractedDocNo || `미확인-${mail.id}`;

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

  /** 즐겨찾기 토글 — Gmail STARRED 미러 */
  const setMailStarred = useCallback(async (id: number, starred: boolean) => {
    const { ok, error: mirrorErr } = await mirrorToGmail({
      action: starred ? 'star' : 'unstar',
      mailIds: [id],
    });
    if (!ok) {
      return { data: null, error: { message: mirrorErr || '별표 동기화 실패' } };
    }
    const { data, error } = await supabase
      .from('mail_messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return { data: data as MailMessage | null, error };
  }, []);

  /** 사용자 라벨 add/remove → Gmail 미러 */
  const modifyMailLabels = useCallback(async (
    ids: number[],
    addLabelIds: string[],
    removeLabelIds: string[],
  ) => {
    const unique = [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))];
    if (!unique.length) return { error: { message: '메일을 선택하세요.' }, count: 0 };
    const { ok, okCount, error: mirrorErr } = await mirrorToGmail({
      action: 'modify_labels',
      mailIds: unique,
      addLabelIds,
      removeLabelIds,
    });
    if (!ok && okCount === 0) {
      return { error: { message: mirrorErr || '라벨 변경 실패' }, count: 0 };
    }
    return { error: null, count: okCount };
  }, []);

  const fetchGmailLabels = useCallback(async () => {
    const { data, error } = await supabase
      .from('gmail_labels')
      .select('id, mailbox, name, label_type, message_list_visibility, updated_at')
      .eq('label_type', 'user')
      .order('name');
    return { data: (data ?? []) as import('@/types/aiMail').GmailLabelRow[], error };
  }, []);

  return {
    fetchMails,
    fetchMail,
    fetchThreadMails,
    fetchAttachments,
    markMailRead,
    softDeleteMails,
    restoreMails,
    hardDeleteMails,
    setMailStarred,
    modifyMailLabels,
    fetchGmailLabels,
    upsertMail,
    runAiPipeline,
    saveExtraction,
    registerAsDraft,
    suggestPartners,
    fetchMailAiSettings,
    updateMailAiSettings,
  };
}
