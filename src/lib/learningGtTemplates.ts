/**
 * 송신자 도메인·제목 패턴 기준 메일 양식 클러스터
 */

import type { LearningGtSample } from '@/lib/learningGt';

export type LearningGtTemplateCluster = {
  cluster_id: string;
  from_domain: string | null;
  sample_count: number;
  sample_gt_ids: string[];
  /** 제목에서 자주 보이는 토큰 */
  subject_tokens: { token: string; count: number }[];
  typical_fields_in_subject: string[];
  avg_item_count: number;
  has_attachments_rate: number;
};

export type LearningGtTemplateBook = {
  built_at: string;
  sample_count: number;
  clusters: LearningGtTemplateCluster[];
};

function emailDomain(from: string | null | undefined): string | null {
  if (!from) return null;
  const m = from.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase() : null;
}

function subjectTokens(subject: string | null): string[] {
  return (subject || '')
    .toUpperCase()
    .split(/[^A-Z0-9가-힣]+/g)
    .filter(t => t.length >= 2 && t.length <= 24)
    .slice(0, 40);
}

export function buildLearningGtTemplates(samples: LearningGtSample[]): LearningGtTemplateBook {
  const byDomain = new Map<string, LearningGtSample[]>();
  for (const s of samples) {
    const d = emailDomain(s.mail.from_addr) || '(unknown)';
    const list = byDomain.get(d) || [];
    list.push(s);
    byDomain.set(d, list);
  }

  const clusters: LearningGtTemplateCluster[] = [];
  for (const [domain, list] of byDomain) {
    const tok = new Map<string, number>();
    let itemsSum = 0;
    let attHits = 0;
    let subjDoc = 0;
    let subjVessel = 0;
    let subjPartner = 0;
    for (const s of list) {
      for (const t of subjectTokens(s.mail.subject)) {
        tok.set(t, (tok.get(t) || 0) + 1);
      }
      itemsSum += s.gold.items.length;
      if (s.mail.attachments.length) attHits += 1;
      const sub = (s.mail.subject || '').toLowerCase();
      if (s.gold.request.document_no && sub.includes(s.gold.request.document_no.toLowerCase())) subjDoc += 1;
      if (s.gold.request.vessel && sub.includes(s.gold.request.vessel.toLowerCase())) subjVessel += 1;
      if (s.gold.customer.name && sub.includes(s.gold.customer.name.toLowerCase())) subjPartner += 1;
    }
    const n = list.length;
    const typical: string[] = [];
    if (subjDoc / n >= 0.4) typical.push('document_no');
    if (subjPartner / n >= 0.4) typical.push('customer.name');
    if (subjVessel / n >= 0.4) typical.push('vessel');

    clusters.push({
      cluster_id: `from:${domain}`,
      from_domain: domain === '(unknown)' ? null : domain,
      sample_count: n,
      sample_gt_ids: list.map(s => s.gt_id).slice(0, 50),
      subject_tokens: [...tok.entries()]
        .map(([token, count]) => ({ token, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30),
      typical_fields_in_subject: typical,
      avg_item_count: itemsSum / n,
      has_attachments_rate: attHits / n,
    });
  }

  clusters.sort((a, b) => b.sample_count - a.sample_count);
  return {
    built_at: new Date().toISOString(),
    sample_count: samples.length,
    clusters,
  };
}
