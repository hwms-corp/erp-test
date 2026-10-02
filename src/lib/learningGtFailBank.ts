/**
 * 실패 태그 → 실패 뱅크 엔트리 (유형별 개선 큐)
 */

import type { LearningGtSampleEval } from '@/lib/learningGtEval';

export type LearningGtFailBankEntry = {
  gt_id: string;
  tags: string[];
  primary_tag: string;
  field_exact_match: number;
  line_item_accuracy: number;
};

export type LearningGtFailBank = {
  built_at: string;
  entry_count: number;
  by_primary_tag: Record<string, number>;
  entries: LearningGtFailBankEntry[];
};

const PRIORITY = [
  'items_empty',
  'item_name_miss',
  'item_spec_miss',
  'item_qty_miss',
  'item_unit_miss',
  'items_count_mismatch',
  'field_miss:request.document_no',
  'field_miss:customer.name',
  'field_miss:request.vessel',
  'classify_wrong',
];

function primaryTag(tags: string[]): string {
  for (const p of PRIORITY) {
    if (tags.includes(p)) return p;
  }
  return tags[0] || 'unknown';
}

export function buildLearningGtFailBank(evals: LearningGtSampleEval[]): LearningGtFailBank {
  const entries: LearningGtFailBankEntry[] = [];
  const by_primary_tag: Record<string, number> = {};
  for (const ev of evals) {
    if (!ev.fail_tags.length) continue;
    // 품목·필드가 완벽하면 뱅크 제외
    if (ev.line_item_accuracy >= 1 && ev.field_exact_match >= 1 && ev.classify_ok) continue;
    const primary_tag = primaryTag(ev.fail_tags);
    by_primary_tag[primary_tag] = (by_primary_tag[primary_tag] || 0) + 1;
    entries.push({
      gt_id: ev.gt_id,
      tags: ev.fail_tags,
      primary_tag,
      field_exact_match: ev.field_exact_match,
      line_item_accuracy: ev.line_item_accuracy,
    });
  }
  entries.sort((a, b) => a.line_item_accuracy - b.line_item_accuracy);
  return {
    built_at: new Date().toISOString(),
    entry_count: entries.length,
    by_primary_tag,
    entries,
  };
}
