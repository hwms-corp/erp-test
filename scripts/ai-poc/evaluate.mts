/**
 * PoC KPI 평가 — Ground Truth vs 휴리스틱 추출 Exact Match
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFromText, classifyDocument } from './extract-heuristic.mts';
import type { CanonicalExtraction } from '../../src/types/aiMail.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, 'fixtures');
const OUT = join(__dirname, 'results');

interface IndexRow {
  id: string;
  language: string;
  body_file: string;
  truth_file: string;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function fieldMatch(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return norm(String(a)) === norm(String(b));
}

function evaluate(pred: CanonicalExtraction, truth: CanonicalExtraction) {
  const fields: { name: string; ok: boolean }[] = [];
  fields.push({ name: 'customer.name', ok: fieldMatch(pred.customer.name.value, truth.customer.name.value) });
  fields.push({
    name: 'request.delivery_date',
    ok: fieldMatch(pred.request.delivery_date.value, truth.request.delivery_date.value),
  });
  fields.push({
    name: 'request.vessel',
    ok: fieldMatch(pred.request.vessel.value, truth.request.vessel.value),
  });

  const minLen = Math.min(pred.items.length, truth.items.length);
  let itemHits = 0;
  let itemTotal = 0;
  for (let i = 0; i < Math.max(pred.items.length, truth.items.length); i++) {
    itemTotal += 1;
    if (i >= minLen) continue;
    const p = pred.items[i];
    const t = truth.items[i];
    const ok =
      fieldMatch(p.product_name.value, t.product_name.value) &&
      fieldMatch(p.specification.value, t.specification.value) &&
      fieldMatch(p.quantity.value, t.quantity.value);
    if (ok) itemHits += 1;
  }

  const fieldHits = fields.filter(f => f.ok).length;
  return {
    field_exact_match: fieldHits / fields.length,
    line_item_accuracy: itemTotal ? itemHits / itemTotal : 0,
    classify_ok: pred.document_type === truth.document_type,
    fields,
    pred_items: pred.items.length,
    truth_items: truth.items.length,
  };
}

mkdirSync(OUT, { recursive: true });
const index = JSON.parse(readFileSync(join(FIX, 'index.json'), 'utf8')) as IndexRow[];

const rows = [];
let classifyOk = 0;
let fieldSum = 0;
let itemSum = 0;

for (const row of index) {
  const body = readFileSync(join(FIX, row.body_file), 'utf8');
  const truth = JSON.parse(readFileSync(join(FIX, row.truth_file), 'utf8')) as CanonicalExtraction;
  const cls = classifyDocument(body);
  const pred = extractFromText(body);
  const ev = evaluate(pred, truth);
  if (cls.document_type === 'quotation_request') classifyOk += 1;
  fieldSum += ev.field_exact_match;
  itemSum += ev.line_item_accuracy;
  rows.push({ id: row.id, language: row.language, ...ev, classify: cls });
}

const n = index.length;
const summary = {
  evaluated_at: new Date().toISOString(),
  sample_count: n,
  document_classification_accuracy: classifyOk / n,
  field_exact_match: fieldSum / n,
  line_item_accuracy: itemSum / n,
  note: 'Heuristic PoC baseline. Replace with multimodal LLM for production KPI.',
};

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
writeFileSync(join(OUT, 'details.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
