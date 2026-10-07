import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  buildMatchMailPayload,
  buildMatchOrderPayload,
  derivePrimaryMatch,
  labelNamesMatch,
  localMatchOrderToMails,
  normalizeRef,
  QUOTE_MAIL_LABEL_NAME,
  type LearningOrderListItem,
  type OrderMailLearningMatchRow,
} from '@/lib/orderMailMatch';
import {
  callOrderMailMatch,
  isOrderMailMatchConfigured,
} from '@/lib/orderMailMatchClient';
import type { MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';

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

async function resolveQuoteLabelId(): Promise<string> {
  const { data, error } = await supabase
    .from('gmail_labels')
    .select('id, name')
    .eq('label_type', 'user');
  if (error) throw error;
  const hit = (data || []).find(l => labelNamesMatch(String(l.name || ''), QUOTE_MAIL_LABEL_NAME));
  if (!hit?.id) {
    throw new Error(
      `Gmail 라벨 「${QUOTE_MAIL_LABEL_NAME}」을 찾을 수 없습니다. 메일함에서 라벨 동기화 후 다시 시도하세요.`,
    );
  }
  return String(hit.id);
}

/** 라벨 메일 풀 로드 (기간 없음, 첨부 없음) */
async function loadLabeledMails(
  labelId: string,
  signal?: AbortSignal,
  onProgress?: (loaded: number) => void,
): Promise<MailMessage[]> {
  const pageSize = 500;
  const all: MailMessage[] = [];
  let from = 0;
  for (;;) {
    if (signal) throwIfAborted(signal);
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('mail_messages')
      .select('id, subject, from_addr, to_addr, snippet, body_text, received_at, gmail_label_ids, is_sent, deleted_at')
      .is('deleted_at', null)
      .eq('is_sent', false)
      .contains('gmail_label_ids', [labelId])
      .order('received_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    const chunk = (data || []) as MailMessage[];
    all.push(...chunk);
    onProgress?.(all.length);
    if (chunk.length < pageSize) break;
    from += pageSize;
    // 과도한 풀 방지
    if (all.length >= 8000) break;
  }
  return all;
}

function patchRow(
  prev: LearningOrderListItem[],
  orderId: number,
  matches: OrderMailLearningMatchRow[],
  mailById: Map<number, MailMessage>,
): LearningOrderListItem[] {
  return prev.map(r => {
    if (r.order.id !== orderId) return r;
    const { match, candidateCount } = derivePrimaryMatch(matches);
    const mail = match?.mail_message_id ? mailById.get(match.mail_message_id) ?? null : null;
    return { ...r, matches, match, candidateCount, mail };
  });
}

export function useOrderMailMatch() {
  const [rows, setRows] = useState<LearningOrderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [matchingOrderId, setMatchingOrderId] = useState<number | null>(null);
  const [queueActive, setQueueActive] = useState(false);
  const [queueDone, setQueueDone] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const labeledMailsRef = useRef<MailMessage[] | null>(null);
  const labelIdRef = useRef<string | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

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
      const matchesByOrder = new Map<number, OrderMailLearningMatchRow[]>();
      for (let i = 0; i < orderIds.length; i += 200) {
        const ids = orderIds.slice(i, i + 200);
        const { data: matchRows, error: mErr } = await supabase
          .from('order_mail_learning_matches')
          .select('*')
          .in('order_id', ids);
        if (mErr) throw mErr;
        for (const row of (matchRows || []) as OrderMailLearningMatchRow[]) {
          const list = matchesByOrder.get(row.order_id) || [];
          list.push(row);
          matchesByOrder.set(row.order_id, list);
        }
      }

      const mailIds = [...new Set(
        [...matchesByOrder.values()]
          .flat()
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
        const matches = matchesByOrder.get(order.id) || [];
        const { match, candidateCount } = derivePrimaryMatch(matches);
        const mail = match?.mail_message_id ? mailById.get(match.mail_message_id) ?? null : null;
        return {
          order,
          items: itemsByOrder.get(order.id) || [],
          partnerEmail: partnerEmails.get(order.partner_id) ?? null,
          matches,
          match,
          mail,
          candidateCount,
        };
      });

      // 전체 목록: 매칭 상태와 무관하게 견적일 최신 → 오래된 순 고정
      list.sort((a, b) => {
        const byDate = (b.order.order_date || '').localeCompare(a.order.order_date || '');
        if (byDate !== 0) return byDate;
        const aCreated = a.order.created_at || '';
        const bCreated = b.order.created_at || '';
        return bCreated.localeCompare(aCreated);
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

  const ensureLabeledMails = useCallback(async (signal: AbortSignal) => {
    if (labeledMailsRef.current && labelIdRef.current) {
      return { labelId: labelIdRef.current, mails: labeledMailsRef.current };
    }
    setProgress(`라벨 「${QUOTE_MAIL_LABEL_NAME}」 메일 불러오는 중… 0통`);
    const labelId = await resolveQuoteLabelId();
    throwIfAborted(signal);
    const mails = await loadLabeledMails(labelId, signal, (loaded) => {
      setProgress(`라벨 「${QUOTE_MAIL_LABEL_NAME}」 메일 불러오는 중… ${loaded}통`);
    });
    labelIdRef.current = labelId;
    labeledMailsRef.current = mails;
    setProgress(`라벨 「${QUOTE_MAIL_LABEL_NAME}」 메일 ${mails.length}통 준비됨`);
    return { labelId, mails };
  }, []);

  const clearOrderMatches = useCallback(async (orderId: number) => {
    const { error } = await supabase
      .from('order_mail_learning_matches')
      .delete()
      .eq('order_id', orderId);
    if (error) throw error;
  }, []);

  /**
   * 견적 1건 매칭 (큐에서도 재사용).
   * 라벨 메일만 · 기간/첨부 없음 · Ref 키 · 다중 후보 저장.
   */
  const matchOneInternal = useCallback(async (
    orderId: number,
    opts: { rematch?: boolean; signal: AbortSignal; keepProgress?: boolean },
  ) => {
    const { signal } = opts;
    const current = rowsRef.current.find(r => r.order.id === orderId);
    if (!current) throw new Error('목록에서 견적을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.');

    if (current.match?.status === 'matched' && !opts.rematch) {
      throw new Error('이미 확정 매칭되어 있습니다. 다시 매칭하려면 「다시 매칭」을 누르세요.');
    }

    setMatchingOrderId(orderId);
    const { mails: labeledMails } = await ensureLabeledMails(signal);
    throwIfAborted(signal);

    if (labeledMails.length === 0) {
      const msg = `라벨 「${QUOTE_MAIL_LABEL_NAME}」에 메일이 없습니다.`;
      await clearOrderMatches(orderId);
      const unmatchedRow = {
        order_id: orderId,
        mail_message_id: null,
        status: 'unmatched' as const,
        score: null,
        match_reasons: ['no_labeled_mails'],
        evidence: { label: QUOTE_MAIL_LABEL_NAME, pool_count: 0 },
        engine_version: 'erp-local-ref@1',
        error_message: msg,
        matched_at: new Date().toISOString(),
      };
      const { data: saved, error: upErr } = await supabase
        .from('order_mail_learning_matches')
        .insert(unmatchedRow)
        .select('*')
        .single();
      if (upErr) throw upErr;
      setRows(prev => patchRow(prev, orderId, [saved as OrderMailLearningMatchRow], new Map()));
      if (!opts.keepProgress) setError(msg);
      return { status: 'unmatched' as const, candidateCount: 0 };
    }

    setProgress(`메일 확인 중… 0/${labeledMails.length} · ${current.order.doc_no}`);
    throwIfAborted(signal);

    // 다른 견적에 이미 확정된 메일 제외
    const { data: takenRows } = await supabase
      .from('order_mail_learning_matches')
      .select('mail_message_id, order_id')
      .eq('status', 'matched')
      .not('mail_message_id', 'is', null);
    throwIfAborted(signal);
    const usedMailIds = new Set<number>();
    for (const t of takenRows || []) {
      if (t.order_id === orderId) continue;
      if (t.mail_message_id) usedMailIds.add(t.mail_message_id as number);
    }
    const pool = labeledMails.filter(m => !usedMailIds.has(m.id));
    const skippedTaken = labeledMails.length - pool.length;
    setProgress(
      `메일 확인 중… 0/${pool.length}` +
        (skippedTaken > 0 ? ` (확정제외 ${skippedTaken})` : '') +
        ` · ${current.order.doc_no}`,
    );

    type Hit = {
      mail_id: number;
      score: number;
      extracted_ref: string | null;
      reasons: string[];
      evidence: Record<string, unknown>;
      mail: MailMessage;
    };
    let hits: Hit[] = [];
    let engineVersion = 'erp-local-ref@1';

    const reportScan = (checked: number, total: number, hitCount: number, prefix?: string) => {
      setProgress(
        `${prefix || '메일 확인 중'}… ${checked}/${total}` +
          (hitCount > 0 ? ` · 후보 ${hitCount}` : '') +
          (skippedTaken > 0 ? ` · 확정제외 ${skippedTaken}` : '') +
          ` · ${current.order.doc_no}`,
      );
    };

    // 엔진 있으면 호출 (텍스트만). 실패/미배포 시 로컬 폴백
    if (isOrderMailMatchConfigured()) {
      try {
        const localPre = await localMatchOrderToMails(
          current.order,
          current.partnerEmail,
          pool,
          {
            minRefScore: 0.5,
            maxCandidates: 40,
            signal,
            onProgress: (checked, total, hitCount) => {
              reportScan(checked, total, hitCount, '메일 확인 중');
            },
          },
        );
        throwIfAborted(signal);
        setProgress(`매칭 엔진 호출 중… (${localPre.length || Math.min(80, pool.length)}통) · ${current.order.doc_no}`);
        const orderPayload = buildMatchOrderPayload(current.order, current.items, current.partnerEmail);
        const preMails = localPre.length > 0
          ? localPre.map(h => h.mail)
          : pool.slice(0, 80);
        const result = await callOrderMailMatch({
          order: orderPayload,
          candidates: preMails.map(buildMatchMailPayload),
          signal,
        });
        throwIfAborted(signal);
        engineVersion = result.engine_version || 'order-mail-match@ref';
        const mailMap = new Map(preMails.map(m => [m.id, m]));
        hits = result.candidates
          .map(c => {
            const mail = mailMap.get(c.mail_id);
            if (!mail) return null;
            return {
              mail_id: c.mail_id,
              score: c.score,
              extracted_ref: c.extracted_ref ?? null,
              reasons: c.reasons || [],
              evidence: (c.evidence && typeof c.evidence === 'object'
                ? c.evidence as Record<string, unknown>
                : {}),
              mail,
            };
          })
          .filter((x): x is Hit => x != null);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        // 로컬 폴백
        engineVersion = 'erp-local-ref@1';
      }
    }

    if (hits.length === 0) {
      const localHits = await localMatchOrderToMails(
        current.order,
        current.partnerEmail,
        pool,
        {
          minRefScore: 0.82,
          maxCandidates: 20,
          signal,
          onProgress: (checked, total, hitCount) => {
            reportScan(checked, total, hitCount, '메일 확인 중');
          },
        },
      );
      hits = localHits.map(h => ({
        mail_id: h.mail.id,
        score: h.score,
        extracted_ref: h.extracted_ref,
        reasons: h.reasons,
        evidence: h.evidence,
        mail: h.mail,
      }));
      engineVersion = 'erp-local-ref@1';
    }

    // 견적번호(Ref) 100% 일치만 따로 집계
    const docNorm = normalizeRef(current.order.doc_no);
    const isExactRef = (h: Hit) => {
      if (docNorm && h.extracted_ref && normalizeRef(h.extracted_ref) === docNorm) return true;
      const refScore = h.evidence?.ref_score;
      if (typeof refScore === 'number' && refScore >= 1) return true;
      if (h.score >= 1 && h.extracted_ref && normalizeRef(h.extracted_ref) === docNorm) return true;
      return false;
    };
    const exactHits = hits.filter(isExactRef);

    let toSave: Hit[] = hits;
    let autoMatched = false;
    if (exactHits.length === 1) {
      // 100% 1건 → 후보 없이 바로 확정
      toSave = exactHits;
      autoMatched = true;
    } else if (exactHits.length >= 2) {
      // 100% 2건 이상 → 그 건들만 후보
      toSave = exactHits;
    }
    // exact 0건이면 fuzzy hits 전부 후보 (기존)

    setProgress(
      autoMatched
        ? `메일 확인 완료 ${pool.length}/${pool.length} · 견적번호 100% 1건 → 확정 · ${current.order.doc_no}`
        : toSave.length > 0
          ? `메일 확인 완료 ${pool.length}/${pool.length} · 후보 ${toSave.length}통 저장 중… · ${current.order.doc_no}`
          : `메일 확인 완료 ${pool.length}/${pool.length} · 후보 없음 · ${current.order.doc_no}`,
    );

    await clearOrderMatches(orderId);
    throwIfAborted(signal);

    if (toSave.length === 0) {
      const msg =
        `「${QUOTE_MAIL_LABEL_NAME}」메일에서 견적번호(${current.order.doc_no})와 맞는 Ref를 찾지 못했습니다.`;
      const unmatchedRow = {
        order_id: orderId,
        mail_message_id: null,
        status: 'unmatched' as const,
        score: null,
        match_reasons: ['no_ref_candidates'],
        evidence: {
          label: QUOTE_MAIL_LABEL_NAME,
          pool_count: pool.length,
          doc_no: current.order.doc_no,
        },
        engine_version: engineVersion,
        error_message: msg,
        matched_at: new Date().toISOString(),
      };
      const { data: saved, error: upErr } = await supabase
        .from('order_mail_learning_matches')
        .insert(unmatchedRow)
        .select('*')
        .single();
      if (upErr) throw upErr;
      setRows(prev => patchRow(prev, orderId, [saved as OrderMailLearningMatchRow], new Map()));
      if (!opts.keepProgress) setError(msg);
      return { status: 'unmatched' as const, candidateCount: 0 };
    }

    const now = new Date().toISOString();
    const insertRows = toSave.map(h => ({
      order_id: orderId,
      mail_message_id: h.mail_id,
      status: (autoMatched ? 'matched' : 'candidate') as 'matched' | 'candidate',
      score: autoMatched ? 1 : h.score,
      match_reasons: autoMatched
        ? [...(h.reasons || []), 'auto_exact_ref']
        : h.reasons,
      evidence: {
        ...h.evidence,
        extracted_ref: h.extracted_ref,
        label: QUOTE_MAIL_LABEL_NAME,
        auto_matched: autoMatched,
      },
      engine_version: engineVersion,
      error_message: null,
      matched_at: now,
    }));

    const { data: savedRows, error: insErr } = await supabase
      .from('order_mail_learning_matches')
      .insert(insertRows)
      .select('*');
    if (insErr) throw insErr;

    const saved = (savedRows || []) as OrderMailLearningMatchRow[];
    const mailById = new Map(toSave.map(h => [h.mail_id, h.mail]));
    setRows(prev => patchRow(prev, orderId, saved, mailById));
    return autoMatched
      ? { status: 'matched' as const, candidateCount: 1 }
      : { status: 'candidates' as const, candidateCount: saved.length };
  }, [clearOrderMatches, ensureLabeledMails]);

  const matchOne = useCallback(async (orderId: number, opts?: { rematch?: boolean }) => {
    if (queueActive) {
      setError('전체 매칭 진행 중에는 개별 매칭을 실행할 수 없습니다. 먼저 중단하세요.');
      return { status: 'busy' as const };
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    try {
      const result = await matchOneInternal(orderId, {
        rematch: opts?.rematch,
        signal: ac.signal,
      });
      setProgress('');
      return result;
    } catch (e) {
      const aborted =
        (e instanceof Error && (e.name === 'AbortError' || e.message.includes('중단'))) ||
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError');
      if (aborted) {
        setError('매칭을 강제 중단했습니다.');
        setProgress('');
        return { status: 'cancelled' as const };
      }
      const msg = e instanceof Error ? e.message : '매칭 실패';
      setError(msg);
      try {
        await clearOrderMatches(orderId);
        await supabase.from('order_mail_learning_matches').insert({
          order_id: orderId,
          mail_message_id: null,
          status: 'failed',
          score: null,
          match_reasons: [],
          evidence: {},
          engine_version: null,
          error_message: msg.slice(0, 500),
          matched_at: new Date().toISOString(),
        });
        await loadList();
      } catch { /* ignore */ }
      setProgress('');
      return { status: 'failed' as const, error: msg };
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setMatchingOrderId(null);
    }
  }, [queueActive, matchOneInternal, clearOrderMatches, loadList]);

  /**
   * 매칭 큐 모드
   * - unmatched: 미확정만 (기존 전체 매칭)
   * - continue: 마지막 확정 매칭 건의 다음 행부터 미확정만
   * - rematch_all: 확정 포함 전 건 처음부터 다시
   */
  const matchAll = useCallback(async (
    opts?: { mode?: 'unmatched' | 'continue' | 'rematch_all' },
  ) => {
    if (queueActive || matchingOrderId != null) return;
    const mode = opts?.mode ?? 'unmatched';
    const all = rowsRef.current;
    let queue: LearningOrderListItem[] = [];
    let label = '전체 매칭';

    if (mode === 'rematch_all') {
      queue = [...all];
      label = '전체 재매칭';
    } else if (mode === 'continue') {
      label = '이어서 매칭';
      const matched = all.filter(r => r.match?.status === 'matched');
      if (matched.length === 0) {
        setError('이어서 시작할 확정 매칭이 없습니다. 「전체 매칭」을 사용하세요.');
        return;
      }
      // 마지막 매칭 = matched_at 최신. 동률이면 목록상 더 아래 건.
      let anchor = matched[0];
      for (const r of matched) {
        const aAt = anchor.match?.matched_at || '';
        const bAt = r.match?.matched_at || '';
        if (bAt > aAt) {
          anchor = r;
          continue;
        }
        if (bAt === aAt) {
          const ai = all.findIndex(x => x.order.id === anchor.order.id);
          const bi = all.findIndex(x => x.order.id === r.order.id);
          if (bi > ai) anchor = r;
        }
      }
      const idx = all.findIndex(r => r.order.id === anchor.order.id);
      if (idx < 0) {
        setError('이어서 시작할 위치를 찾지 못했습니다.');
        return;
      }
      queue = all.slice(idx + 1).filter(r => r.match?.status !== 'matched');
      if (queue.length === 0) {
        setError(
          `마지막 매칭(${anchor.order.doc_no}) 이후에 처리할 미확정 견적이 없습니다.`,
        );
        return;
      }
    } else {
      queue = all.filter(r => r.match?.status !== 'matched');
      if (queue.length === 0) {
        setError('매칭할 미확정 견적이 없습니다. (이미 확정된 건은 건너뜁니다)');
        return;
      }
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setQueueActive(true);
    setQueueDone(0);
    setQueueTotal(queue.length);
    setError(null);
    labeledMailsRef.current = null; // 풀 새로 로드
    labelIdRef.current = null;

    let done = 0;
    try {
      await ensureLabeledMails(ac.signal);
      for (const item of queue) {
        throwIfAborted(ac.signal);
        setQueueDone(done);
        setProgress(
          `${label} ${done + 1}/${queue.length} · ${item.order.doc_no}`,
        );
        try {
          await matchOneInternal(item.order.id, {
            rematch: true,
            signal: ac.signal,
            keepProgress: true,
          });
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') throw e;
          // 건별 실패는 기록 후 다음으로
          const msg = e instanceof Error ? e.message : '매칭 실패';
          try {
            await clearOrderMatches(item.order.id);
            const { data: failed } = await supabase
              .from('order_mail_learning_matches')
              .insert({
                order_id: item.order.id,
                mail_message_id: null,
                status: 'failed',
                score: null,
                match_reasons: [],
                evidence: {},
                engine_version: null,
                error_message: msg.slice(0, 500),
                matched_at: new Date().toISOString(),
              })
              .select('*')
              .single();
            if (failed) {
              setRows(prev => patchRow(prev, item.order.id, [failed as OrderMailLearningMatchRow], new Map()));
            }
          } catch { /* ignore */ }
        }
        done += 1;
        setQueueDone(done);
        // matchingOrderId는 다음 건 matchOneInternal에서 바로 갱신 — 중간에 null로 끊지 않음(말풍선 전환용)
      }
      setProgress(`${label} 완료 · ${done}/${queue.length}`);
      setMatchingOrderId(null);
    } catch (e) {
      const aborted =
        (e instanceof Error && (e.name === 'AbortError' || e.message.includes('중단'))) ||
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError');
      if (aborted) {
        setError(`${label}을 중단했습니다. (${done}/${queue.length} 완료)`);
      } else {
        setError(e instanceof Error ? e.message : `${label} 실패`);
      }
      setProgress('');
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setMatchingOrderId(null);
      setQueueActive(false);
    }
  }, [queueActive, matchingOrderId, ensureLabeledMails, matchOneInternal, clearOrderMatches]);

  /** 상세에서 후보 메일 확정 */
  const selectCandidate = useCallback(async (orderId: number, mailMessageId: number) => {
    setError(null);
    try {
      // 해당 견적의 candidate → rejected, 선택 건 → matched
      const { data: existing, error: e1 } = await supabase
        .from('order_mail_learning_matches')
        .select('*')
        .eq('order_id', orderId);
      if (e1) throw e1;
      const rowsForOrder = (existing || []) as OrderMailLearningMatchRow[];
      const target = rowsForOrder.find(r => r.mail_message_id === mailMessageId);
      if (!target) throw new Error('선택한 후보를 찾을 수 없습니다. 다시 매칭하세요.');

      // 다른 견적이 이미 이 메일을 matched로 쓰지 않는지
      const { data: conflict } = await supabase
        .from('order_mail_learning_matches')
        .select('order_id')
        .eq('mail_message_id', mailMessageId)
        .eq('status', 'matched')
        .neq('order_id', orderId)
        .maybeSingle();
      if (conflict) {
        throw new Error(`이 메일은 이미 다른 견적(#${conflict.order_id})에 확정되어 있습니다.`);
      }

      for (const r of rowsForOrder) {
        if (!r.id) continue;
        if (r.mail_message_id === mailMessageId) {
          const { error } = await supabase
            .from('order_mail_learning_matches')
            .update({
              status: 'matched',
              matched_at: new Date().toISOString(),
              error_message: null,
            })
            .eq('id', r.id);
          if (error) throw error;
        } else if (r.status === 'candidate' || r.status === 'matched') {
          const { error } = await supabase
            .from('order_mail_learning_matches')
            .update({ status: 'rejected' })
            .eq('id', r.id);
          if (error) throw error;
        }
      }

      await loadList();
      return { ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '확정 실패';
      setError(msg);
      return { ok: false as const, error: msg };
    }
  }, [loadList]);

  return {
    rows,
    loading,
    matchingOrderId,
    queueActive,
    queueDone,
    queueTotal,
    error,
    progress,
    loadList,
    matchOne,
    matchAll,
    cancelMatch,
    selectCandidate,
  };
}
