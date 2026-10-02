/**
 * 학습 GT 스냅샷: matched 견적↔메일 → mail-ai-api eval/학습용 JSON
 */

import { supabase } from '@/lib/supabase';
import type { MailAttachment, MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';
import type { OrderMailLearningMatchRow } from '@/lib/orderMailMatch';

export const LEARNING_GT_SCHEMA_VERSION = '1.0.0';

export type LearningGtGoldItem = {
  product_name: string;
  specification: string | null;
  quantity: number;
  unit: string;
  remark: string | null;
  seq: number;
};

/** mail-ai-api CanonicalExtraction 과 맞춘 정답(사람이 ERP에 넣은 값) */
export type LearningGtGold = {
  document_type: 'quotation_request';
  customer: {
    name: string;
    contact_name: string | null;
    email: string | null;
  };
  request: {
    document_no: string;
    request_date: string;
    vessel: string | null;
    contact_person: string | null;
  };
  items: LearningGtGoldItem[];
};

export type LearningGtAttachmentMeta = {
  id: number;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  gmail_attachment_id: string | null;
};

export type LearningGtSample = {
  gt_id: string;
  matched_at: string;
  match: {
    id: number | null;
    score: number | null;
    engine_version: string | null;
    match_reasons: unknown;
    evidence: unknown;
  };
  mail: {
    id: number;
    subject: string | null;
    from_addr: string | null;
    to_addr: string | null;
    snippet: string | null;
    body_text: string | null;
    received_at: string;
    attachments: LearningGtAttachmentMeta[];
  };
  gold: LearningGtGold;
  order: {
    id: number;
    doc_no: string;
    order_date: string;
    partner_id: number;
    partner_name: string;
    created_at: string | null;
  };
};

export type LearningGtManifest = {
  schema_version: string;
  snapshot_id: string;
  created_at: string;
  source: 'erp-test/order_mail_learning_matches';
  status_filter: 'matched';
  sample_count: number;
  with_attachments: number;
  with_items: number;
  purpose: string;
  files: { manifest: string; samples: string };
  derived_hints: {
    from_domains: { domain: string; count: number }[];
    unit_histogram: { unit: string; count: number }[];
    note: string;
  };
};

export type LearningGtSnapshot = {
  manifest: LearningGtManifest;
  samples: LearningGtSample[];
};

function emailDomain(from: string | null | undefined): string | null {
  if (!from) return null;
  const m = from.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase() : null;
}

function buildGold(
  order: OrderWithPartner,
  items: OrderItem[],
  partnerEmail: string | null,
): LearningGtGold {
  return {
    document_type: 'quotation_request',
    customer: {
      name: order.partner_name,
      contact_name: order.contact_person,
      email: partnerEmail,
    },
    request: {
      document_no: order.doc_no,
      request_date: order.order_date,
      vessel: order.vessel,
      contact_person: order.contact_person,
    },
    items: items.map(it => ({
      product_name: it.name,
      specification: it.spec,
      quantity: Number(it.qty),
      unit: it.unit,
      remark: it.remark,
      seq: it.seq,
    })),
  };
}

async function loadMatchedRows(): Promise<OrderMailLearningMatchRow[]> {
  const { data, error } = await supabase
    .from('order_mail_learning_matches')
    .select('*')
    .eq('status', 'matched')
    .not('mail_message_id', 'is', null)
    .order('matched_at', { ascending: false });
  if (error) throw error;
  return (data || []) as OrderMailLearningMatchRow[];
}

/**
 * matched GT 전량 스냅샷 빌드 (첨부 바이너리 제외, 메타만).
 */
export async function buildLearningGtSnapshot(opts?: {
  onProgress?: (msg: string) => void;
}): Promise<LearningGtSnapshot> {
  const report = (m: string) => opts?.onProgress?.(m);
  report('matched 행 조회 중…');
  const matches = await loadMatchedRows();
  if (matches.length === 0) {
    const snapshotId = `gt-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    return {
      manifest: emptyManifest(snapshotId, 0, 0, 0, [], []),
      samples: [],
    };
  }

  const orderIds = [...new Set(matches.map(m => m.order_id))];
  const mailIds = [...new Set(
    matches.map(m => m.mail_message_id).filter((id): id is number => id != null),
  )];

  report(`견적 ${orderIds.length} · 메일 ${mailIds.length} 로드 중…`);

  const orderById = new Map<number, OrderWithPartner>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const ids = orderIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('v_orders_with_partner')
      .select('*')
      .in('id', ids);
    if (error) throw error;
    for (const o of (data || []) as OrderWithPartner[]) orderById.set(o.id, o);
  }

  const itemsByOrder = new Map<number, OrderItem[]>();
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
      const list = itemsByOrder.get(it.order_id) || [];
      list.push(it);
      itemsByOrder.set(it.order_id, list);
    }
  }

  const partnerIds = [...new Set(
    [...orderById.values()].map(o => o.partner_id).filter(Boolean),
  )];
  const partnerEmailById = new Map<number, string | null>();
  for (let i = 0; i < partnerIds.length; i += 200) {
    const ids = partnerIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('partners')
      .select('id, email')
      .in('id', ids);
    if (error) throw error;
    for (const p of data || []) {
      partnerEmailById.set(p.id as number, (p.email as string | null) || null);
    }
  }

  const mailById = new Map<number, MailMessage>();
  for (let i = 0; i < mailIds.length; i += 200) {
    const ids = mailIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('mail_messages')
      .select('id, subject, from_addr, to_addr, snippet, body_text, received_at')
      .in('id', ids);
    if (error) throw error;
    for (const m of (data || []) as MailMessage[]) mailById.set(m.id, m);
  }

  const attsByMail = new Map<number, LearningGtAttachmentMeta[]>();
  for (let i = 0; i < mailIds.length; i += 200) {
    const ids = mailIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('mail_attachments')
      .select('id, mail_message_id, filename, mime_type, size_bytes, gmail_attachment_id')
      .in('mail_message_id', ids)
      .order('id', { ascending: true });
    if (error) throw error;
    for (const a of (data || []) as MailAttachment[]) {
      const mid = a.mail_message_id as number;
      const list = attsByMail.get(mid) || [];
      list.push({
        id: a.id,
        filename: a.filename,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        gmail_attachment_id: a.gmail_attachment_id ?? null,
      });
      attsByMail.set(mid, list);
    }
  }

  report(`샘플 ${matches.length}건 조립 중…`);
  const samples: LearningGtSample[] = [];
  const domainCount = new Map<string, number>();
  const unitCount = new Map<string, number>();
  let withAtt = 0;
  let withItems = 0;

  for (const row of matches) {
    const mailId = row.mail_message_id;
    if (mailId == null) continue;
    const order = orderById.get(row.order_id);
    const mail = mailById.get(mailId);
    if (!order || !mail) continue;

    const items = itemsByOrder.get(order.id) || [];
    const atts = attsByMail.get(mailId) || [];
    if (atts.length) withAtt += 1;
    if (items.length) withItems += 1;

    const domain = emailDomain(mail.from_addr);
    if (domain) domainCount.set(domain, (domainCount.get(domain) || 0) + 1);
    for (const it of items) {
      const u = (it.unit || '').trim() || '(empty)';
      unitCount.set(u, (unitCount.get(u) || 0) + 1);
    }

    samples.push({
      gt_id: `order:${order.id}|mail:${mailId}`,
      matched_at: row.matched_at,
      match: {
        id: row.id ?? null,
        score: row.score != null ? Number(row.score) : null,
        engine_version: row.engine_version,
        match_reasons: row.match_reasons,
        evidence: row.evidence,
      },
      mail: {
        id: mail.id,
        subject: mail.subject,
        from_addr: mail.from_addr,
        to_addr: mail.to_addr,
        snippet: mail.snippet,
        body_text: mail.body_text,
        received_at: mail.received_at,
        attachments: atts,
      },
      gold: buildGold(order, items, partnerEmailById.get(order.partner_id) ?? null),
      order: {
        id: order.id,
        doc_no: order.doc_no,
        order_date: order.order_date,
        partner_id: order.partner_id,
        partner_name: order.partner_name,
        created_at: order.created_at ?? null,
      },
    });
  }

  const snapshotId = `gt-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const fromDomains = [...domainCount.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
  const unitHistogram = [...unitCount.entries()]
    .map(([unit, count]) => ({ unit, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  return {
    manifest: emptyManifest(
      snapshotId,
      samples.length,
      withAtt,
      withItems,
      fromDomains,
      unitHistogram,
    ),
    samples,
  };
}

function emptyManifest(
  snapshotId: string,
  sampleCount: number,
  withAttachments: number,
  withItems: number,
  fromDomains: { domain: string; count: number }[],
  unitHistogram: { unit: string; count: number }[],
): LearningGtManifest {
  return {
    schema_version: LEARNING_GT_SCHEMA_VERSION,
    snapshot_id: snapshotId,
    created_at: new Date().toISOString(),
    source: 'erp-test/order_mail_learning_matches',
    status_filter: 'matched',
    sample_count: sampleCount,
    with_attachments: withAttachments,
    with_items: withItems,
    purpose:
      'Ground truth for mail-ai-api extract/classify eval. gold = human ERP quote; mail+attachments = input.',
    files: {
      manifest: 'manifest.json',
      samples: 'samples.jsonl',
    },
    derived_hints: {
      from_domains: fromDomains,
      unit_histogram: unitHistogram,
      note: 'Hints only — rebuild lexicon/templates on mail-ai-api from samples.jsonl',
    },
  };
}

/** 브라우저에서 manifest + jsonl 두 파일 다운로드 */
export function downloadLearningGtSnapshot(snapshot: LearningGtSnapshot) {
  const { manifest, samples } = snapshot;
  const id = manifest.snapshot_id;
  downloadBlob(
    `${id}-manifest.json`,
    JSON.stringify(manifest, null, 2),
    'application/json',
  );
  const jsonl = samples.map(s => JSON.stringify(s)).join('\n') + (samples.length ? '\n' : '');
  downloadBlob(`${id}-samples.jsonl`, jsonl, 'application/x-ndjson');
}

function downloadBlob(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** matched 건수만 빠르게 */
export async function countMatchedLearningGt(): Promise<number> {
  const { count, error } = await supabase
    .from('order_mail_learning_matches')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'matched')
    .not('mail_message_id', 'is', null);
  if (error) throw error;
  return count ?? 0;
}
