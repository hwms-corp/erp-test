/**
 * GT gold vs 추출 결과 비교 (메일·품목 정확도 지표)
 * 실제 matched 데이터 없이도 픽스처로 파이프라인 검증 가능.
 */

import type { CanonicalExtraction } from '@/types/aiMail';
import type { LearningGtGold, LearningGtGoldItem } from '@/lib/learningGt';

export type LearningGtFieldScore = {
  name: string;
  ok: boolean;
  gold: string | number | null;
  pred: string | number | null;
};

export type LearningGtItemScore = {
  index: number;
  ok: boolean;
  name_ok: boolean;
  spec_ok: boolean;
  qty_ok: boolean;
  unit_ok: boolean;
};

export type LearningGtSampleEval = {
  gt_id: string;
  classify_ok: boolean;
  field_exact_match: number;
  line_item_accuracy: number;
  fields: LearningGtFieldScore[];
  items: LearningGtItemScore[];
  pred_item_count: number;
  gold_item_count: number;
  fail_tags: string[];
};

export type LearningGtEvalSummary = {
  evaluated_at: string;
  sample_count: number;
  classify_accuracy: number;
  field_exact_match_avg: number;
  line_item_accuracy_avg: number;
  /** 품목 정확도가 목표 핵심 */
  primary_metric: 'line_item_accuracy_avg';
  fail_tag_histogram: Record<string, number>;
};

function norm(s: string | number | null | undefined): string {
  if (s == null) return '';
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

export function valuesEqual(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return norm(a) === norm(b);
    return Math.abs(na - nb) < 1e-9;
  }
  return norm(a) === norm(b);
}

/** CanonicalExtraction → 단순 gold 형태 (비교용) */
export function canonicalToFlatGold(ext: CanonicalExtraction): LearningGtGold {
  return {
    document_type: ext.document_type === 'quotation_request' ? 'quotation_request' : 'quotation_request',
    customer: {
      name: ext.customer.name.value ?? '',
      contact_name: ext.customer.contact_name.value,
      email: ext.customer.email.value,
    },
    request: {
      document_no: ext.request.document_no.value ?? '',
      request_date: ext.request.request_date.value ?? '',
      vessel: ext.request.vessel.value,
      contact_person: ext.request.contact_person.value,
    },
    items: ext.items.map((it, i) => ({
      product_name: it.product_name.value ?? '',
      specification: it.specification.value,
      quantity: it.quantity.value ?? 0,
      unit: it.unit.value ?? '',
      remark: it.remark.value,
      seq: i + 1,
    })),
  };
}

function scoreItem(pred: LearningGtGoldItem | undefined, gold: LearningGtGoldItem, index: number): LearningGtItemScore {
  if (!pred) {
    return {
      index,
      ok: false,
      name_ok: false,
      spec_ok: false,
      qty_ok: false,
      unit_ok: false,
    };
  }
  const name_ok = valuesEqual(pred.product_name, gold.product_name);
  const spec_ok = valuesEqual(pred.specification, gold.specification);
  const qty_ok = valuesEqual(pred.quantity, gold.quantity);
  const unit_ok = valuesEqual(pred.unit, gold.unit);
  return {
    index,
    ok: name_ok && spec_ok && qty_ok && unit_ok,
    name_ok,
    spec_ok,
    qty_ok,
    unit_ok,
  };
}

/**
 * 순서 무시 품목 매칭: gold 각 행에 대해 가장 잘 맞는 pred 1:1 배정(그리디).
 */
function scoreItemsUnordered(predItems: LearningGtGoldItem[], goldItems: LearningGtGoldItem[]): LearningGtItemScore[] {
  const used = new Set<number>();
  const out: LearningGtItemScore[] = [];
  for (let gi = 0; gi < goldItems.length; gi += 1) {
    const gold = goldItems[gi];
    let bestIdx = -1;
    let bestScore = -1;
    for (let pi = 0; pi < predItems.length; pi += 1) {
      if (used.has(pi)) continue;
      const s = scoreItem(predItems[pi], gold, gi);
      const pts = Number(s.name_ok) + Number(s.spec_ok) + Number(s.qty_ok) + Number(s.unit_ok);
      if (pts > bestScore) {
        bestScore = pts;
        bestIdx = pi;
      }
    }
    if (bestIdx < 0) {
      out.push(scoreItem(undefined, gold, gi));
    } else {
      used.add(bestIdx);
      out.push(scoreItem(predItems[bestIdx], gold, gi));
    }
  }
  // 초과 pred는 실패로 추가하지 않음 — gold 기준 recall 중심
  return out;
}

function collectFailTags(
  fields: LearningGtFieldScore[],
  items: LearningGtItemScore[],
  classifyOk: boolean,
  predCount: number,
  goldCount: number,
): string[] {
  const tags: string[] = [];
  if (!classifyOk) tags.push('classify_wrong');
  for (const f of fields) {
    if (!f.ok) tags.push(`field_miss:${f.name}`);
  }
  if (predCount === 0 && goldCount > 0) tags.push('items_empty');
  if (predCount > 0 && goldCount > 0 && predCount !== goldCount) tags.push('items_count_mismatch');
  for (const it of items) {
    if (!it.ok) {
      if (!it.name_ok) tags.push('item_name_miss');
      if (!it.spec_ok) tags.push('item_spec_miss');
      if (!it.qty_ok) tags.push('item_qty_miss');
      if (!it.unit_ok) tags.push('item_unit_miss');
    }
  }
  return [...new Set(tags)];
}

export function evaluateGoldVsPred(input: {
  gt_id: string;
  gold: LearningGtGold;
  pred: LearningGtGold;
  pred_document_type?: string;
  /** 기본 unordered (첨부 표 순서 흔들림 대비) */
  item_match?: 'ordered' | 'unordered';
}): LearningGtSampleEval {
  const { gold, pred } = input;
  const fields: LearningGtFieldScore[] = [
    {
      name: 'request.document_no',
      ok: valuesEqual(pred.request.document_no, gold.request.document_no),
      gold: gold.request.document_no,
      pred: pred.request.document_no,
    },
    {
      name: 'customer.name',
      ok: valuesEqual(pred.customer.name, gold.customer.name),
      gold: gold.customer.name,
      pred: pred.customer.name,
    },
    {
      name: 'request.vessel',
      ok: valuesEqual(pred.request.vessel, gold.request.vessel),
      gold: gold.request.vessel,
      pred: pred.request.vessel,
    },
    {
      name: 'request.contact_person',
      ok: valuesEqual(
        pred.request.contact_person ?? pred.customer.contact_name,
        gold.request.contact_person ?? gold.customer.contact_name,
      ),
      gold: gold.request.contact_person ?? gold.customer.contact_name,
      pred: pred.request.contact_person ?? pred.customer.contact_name,
    },
  ];

  const mode = input.item_match ?? 'unordered';
  const items =
    mode === 'ordered'
      ? gold.items.map((g, i) => scoreItem(pred.items[i], g, i))
      : scoreItemsUnordered(pred.items, gold.items);

  const fieldHits = fields.filter(f => f.ok).length;
  const itemHits = items.filter(i => i.ok).length;
  const classify_ok =
    (input.pred_document_type ?? 'quotation_request') === 'quotation_request' &&
    gold.document_type === 'quotation_request';

  const fail_tags = collectFailTags(
    fields,
    items,
    classify_ok,
    pred.items.length,
    gold.items.length,
  );

  return {
    gt_id: input.gt_id,
    classify_ok,
    field_exact_match: fields.length ? fieldHits / fields.length : 0,
    line_item_accuracy: items.length ? itemHits / items.length : gold.items.length === 0 ? 1 : 0,
    fields,
    items,
    pred_item_count: pred.items.length,
    gold_item_count: gold.items.length,
    fail_tags,
  };
}

export function summarizeLearningGtEvals(rows: LearningGtSampleEval[]): LearningGtEvalSummary {
  const n = rows.length || 1;
  const fail_tag_histogram: Record<string, number> = {};
  for (const r of rows) {
    for (const t of r.fail_tags) {
      fail_tag_histogram[t] = (fail_tag_histogram[t] || 0) + 1;
    }
  }
  return {
    evaluated_at: new Date().toISOString(),
    sample_count: rows.length,
    classify_accuracy: rows.filter(r => r.classify_ok).length / n,
    field_exact_match_avg: rows.reduce((s, r) => s + r.field_exact_match, 0) / n,
    line_item_accuracy_avg: rows.reduce((s, r) => s + r.line_item_accuracy, 0) / n,
    primary_metric: 'line_item_accuracy_avg',
    fail_tag_histogram,
  };
}
