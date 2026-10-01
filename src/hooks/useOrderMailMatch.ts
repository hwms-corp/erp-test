import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  buildMatchOrderPayload,
  candidateReceivedWindow,
  prefilterCandidatesByText,
  TEXT_PREFILTER_MIN_SCORE,
  type LearningOrderListItem,
  type OrderMailLearningMatchRow,
} from '@/lib/orderMailMatch';
import { callOrderMailMatch } from '@/lib/orderMailMatchClient';
import { fetchGmailAttachmentBase64 } from '@/lib/gmailAttachment';
import type { MailAttachment, MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';

const ATT_MAX_BYTES = 8 * 1024 * 1024; // 8MB / file for match payload
const ATT_MAX_FILES = 8;

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    const err = new Error('사용자가 매칭을 중단했습니다');
    err.name = 'AbortError';
    throw err;
  }
}

async function loadItemsMap(orderIds: number[]): Promise<Map<number, OrderItem[]>> {
  const map = new Map<number, OrderItem[]>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const ids = orderIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', ids)
      .is('deleted_at', null)
      .order('seq', { ascending: true });
    if (error) throw error;
    for (const it of (data || []) as OrderItem[]) {
      const list = map.get(it.order_id) || [];
      list.push(it);
      map.set(it.order_id, list);
    }
  }
  return map;
}

async function loadPartnerEmails(partnerIds: number[]): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  for (let i = 0; i < partnerIds.length; i += 200) {
    const ids = partnerIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('partners')
      .select('id, email')
      .in('id', ids);
    if (error) throw error;
    for (const p of data || []) {
      map.set(p.id as number, (p.email as string | null) || null);
    }
  }
  return map;
}

export function useOrderMailMatch() {
  const [rows, setRows] = useState<LearningOrderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [matchingOrderId, setMatchingOrderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  /** 빠른 리스트: 견적 + 저장된 매칭만 (전량 메일 스캔 없음) */
  const loadList = useCallback(async () => {
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
          .select('id, source, ai_review_status, ai_mail_message_id, created_at')
          .in('id', orderIds);
        if (meta) {
          const map = new Map(meta.map(m => [m.id, m]));
          orders = baseOrders.map(o => {
            const m = map.get(o.id);
            return m
              ? {
                  ...o,
                  source: m.source ?? o.source ?? 'manual',
                  ai_review_status: m.ai_review_status ?? null,
                  ai_mail_message_id: m.ai_mail_message_id ?? null,
                  created_at: m.created_at ?? o.created_at,
                }
              : o;
          });
        }
      }

      setProgress('매칭 결과 불러오는 중…');
      const matchByOrder = new Map<number, OrderMailLearningMatchRow>();
      for (let i = 0; i < orderIds.length; i += 200) {
        const ids = orderIds.slice(i, i + 200);
        const { data: matches, error: mErr } = await supabase
          .from('order_mail_learning_matches')
          .select('*')
          .in('order_id', ids);
        if (mErr) throw mErr;
        for (const row of (matches || []) as OrderMailLearningMatchRow[]) {
          matchByOrder.set(row.order_id, row);
        }
      }

      const mailIds = [...new Set(
        [...matchByOrder.values()]
          .map(m => m.mail_message_id)
          .filter((id): id is number => id != null),
      )];
      const mailById = new Map<number, MailMessage>();
      for (let i = 0; i < mailIds.length; i += 200) {
        const ids = mailIds.slice(i, i + 200);
        const { data: mails, error: mailErr } = await supabase
          .from('mail_messages')
          .select('*')
          .in('id', ids);
        if (mailErr) throw mailErr;
        for (const m of (mails || []) as MailMessage[]) mailById.set(m.id, m);
      }

      setProgress('품목·거래처 정리 중…');
      const itemsByOrder = await loadItemsMap(orderIds);
      const partnerEmails = await loadPartnerEmails([...new Set(orders.map(o => o.partner_id))]);

      const list: LearningOrderListItem[] = orders.map(order => {
        const match = matchByOrder.get(order.id) ?? null;
        const mail = match?.mail_message_id ? mailById.get(match.mail_message_id) ?? null : null;
        return {
          order,
          items: itemsByOrder.get(order.id) || [],
          partnerEmail: partnerEmails.get(order.partner_id) ?? null,
          match,
          mail,
        };
      });

      // 비매칭(또는 미실행) 먼저? 사용자: 처음엔 비매칭. 표시는 전체, 필터는 UI
      // 정렬: 비매칭/미실행 → 매칭, 견적일 최신
      list.sort((a, b) => {
        const aMatched = a.match?.status === 'matched' ? 1 : 0;
        const bMatched = b.match?.status === 'matched' ? 1 : 0;
        if (aMatched !== bMatched) return aMatched - bMatched;
        return (b.order.order_date || '').localeCompare(a.order.order_date || '');
      });

      setRows(list);
      setProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록 로드 실패');
      setProgress('');
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelMatch = useCallback(() => {
    abortRef.current?.abort();
    setProgress('중단 요청 중…');
  }, []);

  /**
   * 견적 1건 매칭:
   * 1) 15일 윈도우 후보 메일 조회
   * 2) 이미 matched인 메일 제외
   * 3) 텍스트 사전 필터(첨부 전) → 점수 ≥ MIN만
   * 4) 첨부 base64 포함 API 호출
   * 5) DB upsert
   */
  const matchOne = useCallback(async (orderId: number, opts?: { rematch?: boolean }) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const { signal } = ac;

    setMatchingOrderId(orderId);
    setError(null);
    try {
      const current = rows.find(r => r.order.id === orderId);
      if (!current) throw new Error('목록에서 견적을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.');

      if (current.match?.status === 'matched' && !opts?.rematch) {
        throw new Error('이미 매칭되어 있습니다. 다시 매칭하려면 「다시 매칭」을 누르세요.');
      }

      const { fromIso, toIsoExclusive } = candidateReceivedWindow(current.order);

      // 다른 견적에 이미 매칭된 메일
      const { data: takenRows } = await supabase
        .from('order_mail_learning_matches')
        .select('mail_message_id, order_id')
        .eq('status', 'matched')
        .not('mail_message_id', 'is', null);
      throwIfAborted(signal);
      const usedMailIds = new Set<number>();
      for (const t of takenRows || []) {
        if (t.order_id === orderId) continue; // rematch 시 본인 링크는 후보 가능
        if (t.mail_message_id) usedMailIds.add(t.mail_message_id as number);
      }

      setProgress('후보 메일 조회 중…');
      const { data: candMails, error: cErr } = await supabase
        .from('mail_messages')
        .select('*')
        .is('deleted_at', null)
        .eq('is_sent', false)
        .gte('received_at', fromIso)
        .lt('received_at', toIsoExclusive)
        .order('received_at', { ascending: false })
        .limit(200);
      if (cErr) throw cErr;
      throwIfAborted(signal);

      const windowCandidates = ((candMails || []) as MailMessage[]).filter(m => !usedMailIds.has(m.id));

      if (windowCandidates.length === 0) {
        const unmatchedRow = {
          order_id: orderId,
          mail_message_id: null,
          status: 'unmatched' as const,
          score: null,
          match_reasons: ['no_candidates_in_15d_window'],
          evidence: { window: { fromIso, toIsoExclusive }, candidate_count: 0 },
          engine_version: null,
          error_message: null,
          matched_at: new Date().toISOString(),
        };
        const { data: saved, error: upErr } = await supabase
          .from('order_mail_learning_matches')
          .upsert(unmatchedRow, { onConflict: 'order_id' })
          .select('*')
          .single();
        if (upErr) throw upErr;
        setRows(prev => prev.map(r => (
          r.order.id === orderId
            ? { ...r, match: saved as OrderMailLearningMatchRow, mail: null }
            : r
        )));
        return { status: 'unmatched' as const };
      }

      // 첨부 다운로드 전: subject/from/body + 첨부파일명(메타만)으로 상위 N통 선별
      setProgress(`텍스트 사전 필터 중… (윈도우 ${windowCandidates.length}통)`);
      const attachmentFilenamesByMailId = new Map<number, string[]>();
      const windowIds = windowCandidates.map(m => m.id);
      for (let i = 0; i < windowIds.length; i += 200) {
        throwIfAborted(signal);
        const chunk = windowIds.slice(i, i + 200);
        const { data: nameRows } = await supabase
          .from('mail_attachments')
          .select('mail_message_id, filename')
          .in('mail_message_id', chunk);
        for (const row of nameRows || []) {
          const mid = row.mail_message_id as number;
          const list = attachmentFilenamesByMailId.get(mid) || [];
          list.push(String(row.filename || ''));
          attachmentFilenamesByMailId.set(mid, list);
        }
      }
      throwIfAborted(signal);

      const { kept: candidates, ranked, dropped, minScore } = prefilterCandidatesByText(
        windowCandidates,
        current.order,
        current.items,
        current.partnerEmail,
        { minScore: TEXT_PREFILTER_MIN_SCORE, attachmentFilenamesByMailId },
      );

      if (candidates.length === 0) {
        const unmatchedRow = {
          order_id: orderId,
          mail_message_id: null,
          status: 'unmatched' as const,
          score: null,
          match_reasons: ['no_candidates_above_text_score'],
          evidence: {
            window: { fromIso, toIsoExclusive },
            window_count: windowCandidates.length,
            text_prefilter_min_score: minScore,
            text_prefilter_dropped: dropped,
          },
          engine_version: null,
          error_message: null,
          matched_at: new Date().toISOString(),
        };
        const { data: saved, error: upErr } = await supabase
          .from('order_mail_learning_matches')
          .upsert(unmatchedRow, { onConflict: 'order_id' })
          .select('*')
          .single();
        if (upErr) throw upErr;
        setRows(prev => prev.map(r => (
          r.order.id === orderId
            ? { ...r, match: saved as OrderMailLearningMatchRow, mail: null }
            : r
        )));
        return { status: 'unmatched' as const };
      }

      setProgress(
        `첨부 준비 중… (텍스트 ${minScore}점↑ ${candidates.length}/${windowCandidates.length}` +
          (dropped > 0 ? `, ${dropped}통 스킵` : '') +
          ')',
      );
      const candPayload = [];
      let attDone = 0;
      for (const mail of candidates) {
        throwIfAborted(signal);
        const { data: atts } = await supabase
          .from('mail_attachments')
          .select('id, filename, mime_type, size_bytes, gmail_attachment_id')
          .eq('mail_message_id', mail.id)
          .order('id', { ascending: true })
          .limit(ATT_MAX_FILES);

        const attachments: {
          id: number;
          filename: string;
          mime_type: string | null;
          size_bytes: number | null;
          content_base64?: string;
        }[] = [];

        for (const a of (atts || []) as MailAttachment[]) {
          throwIfAborted(signal);
          const size = a.size_bytes ?? 0;
          const entry = {
            id: a.id,
            filename: a.filename,
            mime_type: a.mime_type,
            size_bytes: a.size_bytes,
          };
          if (size > 0 && size <= ATT_MAX_BYTES && a.gmail_attachment_id) {
            try {
              const bin = await fetchGmailAttachmentBase64(a.id);
              throwIfAborted(signal);
              if (bin?.content_base64) {
                attachments.push({ ...entry, content_base64: bin.content_base64 });
                continue;
              }
            } catch (e) {
              if (e instanceof Error && e.name === 'AbortError') throw e;
              // 메타만 전달
            }
          }
          attachments.push(entry);
        }

        candPayload.push({
          mail_id: mail.id,
          subject: mail.subject,
          from_addr: mail.from_addr,
          to_addr: mail.to_addr,
          received_at: mail.received_at,
          body_text: mail.body_text,
          snippet: mail.snippet,
          attachments,
        });
        attDone += 1;
        if (attDone % 5 === 0 || attDone === candidates.length) {
          setProgress(`첨부 준비 중… (${attDone}/${candidates.length})`);
        }
      }

      setProgress('매칭 엔진 호출 중… (오래 걸리면 「강제 중단」)');
      const orderPayload = buildMatchOrderPayload(current.order, current.items, current.partnerEmail);
      const prefilterEvidence = {
        window: { fromIso, toIsoExclusive },
        window_count: windowCandidates.length,
        text_prefilter_min_score: minScore,
        text_prefilter_kept: ranked.map(h => ({
          mail_id: h.mail.id,
          score: h.score,
          reasons: h.reasons,
        })),
        text_prefilter_dropped: dropped,
      };
      const result = await callOrderMailMatch({
        order: orderPayload,
        candidates: candPayload,
        signal,
      });
      throwIfAborted(signal);

      const saveRow = {
        order_id: orderId,
        mail_message_id: result.status === 'matched' ? result.mail_id : null,
        status: result.status,
        score: result.score,
        match_reasons: result.reasons || [],
        evidence: {
          ...(result.evidence && typeof result.evidence === 'object' ? result.evidence : {}),
          erp_text_prefilter: prefilterEvidence,
        },
        engine_version: result.engine_version || null,
        error_message: null,
        matched_at: new Date().toISOString(),
      };

      const { data: saved, error: upErr } = await supabase
        .from('order_mail_learning_matches')
        .upsert(saveRow, { onConflict: 'order_id' })
        .select('*')
        .single();
      if (upErr) throw upErr;

      let mail: MailMessage | null = null;
      if (saved.mail_message_id) {
        const { data: m } = await supabase
          .from('mail_messages')
          .select('*')
          .eq('id', saved.mail_message_id)
          .maybeSingle();
        mail = (m as MailMessage) || null;
      }

      setRows(prev => prev.map(r => (
        r.order.id === orderId
          ? { ...r, match: saved as OrderMailLearningMatchRow, mail }
          : r
      )));
      setProgress('');
      return { status: result.status };
    } catch (e) {
      const aborted =
        (e instanceof Error && (e.name === 'AbortError' || e.message.includes('중단'))) ||
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError');
      if (aborted) {
        setError('매칭을 강제 중단했습니다. 다시 「매칭」으로 재시도할 수 있습니다.');
        setProgress('');
        return { status: 'cancelled' as const };
      }
      const msg = e instanceof Error ? e.message : '매칭 실패';
      setError(msg);
      // failed 기록
      try {
        await supabase.from('order_mail_learning_matches').upsert({
          order_id: orderId,
          mail_message_id: null,
          status: 'failed',
          score: null,
          match_reasons: [],
          evidence: {},
          engine_version: null,
          error_message: msg.slice(0, 500),
          matched_at: new Date().toISOString(),
        }, { onConflict: 'order_id' });
        await loadList();
      } catch { /* ignore */ }
      setProgress('');
      return { status: 'failed' as const, error: msg };
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setMatchingOrderId(null);
    }
  }, [rows, loadList]);

  return {
    rows,
    loading,
    matchingOrderId,
    error,
    progress,
    loadList,
    matchOne,
    cancelMatch,
  };
}
