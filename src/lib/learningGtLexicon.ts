/**
 * GT 샘플에서 필드별 lexicon / 고빈도 용어 집계
 */

import type { LearningGtSample } from '@/lib/learningGt';

export type LearningGtLexicon = {
  built_at: string;
  sample_count: number;
  document_no_patterns: string[];
  customer_names: { value: string; count: number }[];
  vessels: { value: string; count: number }[];
  contacts: { value: string; count: number }[];
  product_name_tokens: { token: string; count: number }[];
  units: { unit: string; count: number }[];
  /** 메일 본문/제목에 자주 나오는 gold 값 (가중 힌트) */
  subject_hit_rates: {
    field: string;
    /** gold 값이 subject에 포함된 비율 */
    rate: number;
    hits: number;
    total: number;
  }[];
};

function bump(map: Map<string, number>, key: string) {
  const k = key.trim();
  if (!k) return;
  map.set(k, (map.get(k) || 0) + 1);
}

function topMap(map: Map<string, number>, n: number): { value: string; count: number }[] {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, n);
}

function tokenizeProductName(name: string): string[] {
  return name
    .toUpperCase()
    .split(/[^A-Z0-9가-힣]+/g)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && t.length <= 32);
}

export function buildLearningGtLexicon(samples: LearningGtSample[]): LearningGtLexicon {
  const customers = new Map<string, number>();
  const vessels = new Map<string, number>();
  const contacts = new Map<string, number>();
  const units = new Map<string, number>();
  const tokens = new Map<string, number>();
  const docNos: string[] = [];

  let subjDoc = 0;
  let subjCustomer = 0;
  let subjVessel = 0;
  let n = 0;

  for (const s of samples) {
    n += 1;
    const g = s.gold;
    if (g.request.document_no) docNos.push(g.request.document_no);
    bump(customers, g.customer.name);
    if (g.request.vessel) bump(vessels, g.request.vessel);
    const contact = g.request.contact_person || g.customer.contact_name;
    if (contact) bump(contacts, contact);
    for (const it of g.items) {
      bump(units, it.unit || '');
      for (const t of tokenizeProductName(it.product_name)) bump(tokens, t);
    }

    const subject = (s.mail.subject || '').toLowerCase();
    if (g.request.document_no && subject.includes(g.request.document_no.toLowerCase())) subjDoc += 1;
    if (g.customer.name && subject.includes(g.customer.name.toLowerCase())) subjCustomer += 1;
    if (g.request.vessel && subject.includes(g.request.vessel.toLowerCase())) subjVessel += 1;
  }

  const denom = Math.max(n, 1);
  return {
    built_at: new Date().toISOString(),
    sample_count: samples.length,
    document_no_patterns: [...new Set(docNos)].slice(0, 200),
    customer_names: topMap(customers, 100).map(({ value, count }) => ({ value, count })),
    vessels: topMap(vessels, 100),
    contacts: topMap(contacts, 100),
    product_name_tokens: topMap(tokens, 200).map(({ value, count }) => ({ token: value, count })),
    units: topMap(units, 50).map(({ value, count }) => ({ unit: value, count })),
    subject_hit_rates: [
      { field: 'document_no', rate: subjDoc / denom, hits: subjDoc, total: n },
      { field: 'customer.name', rate: subjCustomer / denom, hits: subjCustomer, total: n },
      { field: 'vessel', rate: subjVessel / denom, hits: subjVessel, total: n },
    ],
  };
}
