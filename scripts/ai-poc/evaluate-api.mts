/**
 * Ground Truth 회귀 — mail-ai-api(실엔진) 대비 KPI
 *
 * 사용:
 *   set VITE_AI_DOC_API_URL / VITE_AI_DOC_API_KEY (또는 AI_DOC_*)
 *   npx tsx scripts/ai-poc/evaluate-api.mts
 *
 * 휴리스틱 전용은 evaluate.mts 유지 (오프라인).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanonicalExtraction } from '../../src/types/aiMail.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

/** .env 간단 로드 (추가 패키지 없이) */
function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(join(ROOT, '.env'));

const FIX = join(__dirname, 'fixtures');
const OUT = join(__dirname, 'results');

const API_BASE = (
  process.env.VITE_AI_DOC_API_URL
  || process.env.AI_DOC_API_URL
  || 'http://localhost:4040'
).replace(/\/$/, '');
const API_KEY =
  process.env.VITE_AI_DOC_API_KEY
  || process.env.AI_DOC_API_KEY
  || 'aidoc_demo_haewon_dev_key_change_me';

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
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return norm(String(a)) === norm(String(b));
}

function evaluate(pred: CanonicalExtraction, truth: CanonicalExtraction) {
  const fields: { name: string; ok: boolean }[] = [];
  const pairs: [string, unknown, unknown][] = [
    ['customer.name', pred.customer?.name?.value, truth.customer?.name?.value],
    ['request.document_no', pred.request?.document_no?.value, truth.request?.document_no?.value],
    ['request.delivery_date', pred.request?.delivery_date?.value, truth.request?.delivery_date?.value],
    ['request.vessel', pred.request?.vessel?.value, truth.request?.vessel?.value],
  ];
  for (const [name, a, b] of pairs) {
    fields.push({ name, ok: fieldMatch(a, b) });
  }

  const minLen = Math.min(pred.items?.length ?? 0, truth.items?.length ?? 0);
  let itemHits = 0;
  let itemTotal = Math.max(pred.items?.length ?? 0, truth.items?.length ?? 0);
  for (let i = 0; i < minLen; i++) {
    const p = pred.items[i];
    const t = truth.items[i];
    const ok =
      fieldMatch(p.product_name?.value, t.product_name?.value)
      && fieldMatch(p.specification?.value, t.specification?.value)
      && fieldMatch(p.quantity?.value, t.quantity?.value);
    if (ok) itemHits += 1;
  }
  if (!itemTotal) itemTotal = 1;

  let sourceOk = 0;
  let sourceN = 0;
  const checkSrc = (f: { source_file?: string | null } | null | undefined) => {
    if (!f || f.source_file == null) return;
    sourceN += 1;
    const s = String(f.source_file).toLowerCase();
    if (s === 'subject' || s === 'body' || s.length > 0) sourceOk += 1;
  };
  checkSrc(pred.customer?.name);
  checkSrc(pred.request?.document_no);
  for (const it of pred.items ?? []) checkSrc(it.product_name);

  return {
    field_exact_match: fields.filter(f => f.ok).length / fields.length,
    line_item_accuracy: itemHits / itemTotal,
    classify_ok: pred.document_type === truth.document_type,
    source_filled_rate: sourceN ? sourceOk / sourceN : 0,
    fields,
    pred_items: pred.items?.length ?? 0,
    truth_items: truth.items?.length ?? 0,
    overall_confidence: pred.overall_confidence ?? 0,
  };
}

async function apiExtract(text: string, retries = 3): Promise<CanonicalExtraction> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_BASE}/v1/documents/extract`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `extract ${res.status}`);
      return json.data as CanonicalExtraction;
    } catch (e) {
      lastErr = e;
      const wait = 1500 * (i + 1);
      console.warn(`retry ${i + 1}/${retries} after ${wait}ms:`, String(e));
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function main() {
  if (!existsSync(join(FIX, 'index.json'))) {
    console.error('fixtures/index.json 없음 — generate-ground-truth 먼저 실행');
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  const index = JSON.parse(readFileSync(join(FIX, 'index.json'), 'utf8')) as IndexRow[];

  console.log(`API: ${API_BASE}`);
  console.log(`fixtures: ${index.length}`);

  const rows = [];
  let classifyOk = 0;
  let fieldSum = 0;
  let itemSum = 0;
  let sourceSum = 0;
  let confSum = 0;
  let fail = 0;

  for (const row of index) {
    const body = readFileSync(join(FIX, row.body_file), 'utf8');
    const truth = JSON.parse(readFileSync(join(FIX, row.truth_file), 'utf8')) as CanonicalExtraction;
    try {
      const pred = await apiExtract(body);
      const ev = evaluate(pred, truth);
      if (ev.classify_ok) classifyOk += 1;
      fieldSum += ev.field_exact_match;
      itemSum += ev.line_item_accuracy;
      sourceSum += ev.source_filled_rate;
      confSum += ev.overall_confidence;
      rows.push({ id: row.id, language: row.language, ...ev, error: null });
      console.log(
        `${row.id} field=${(ev.field_exact_match * 100).toFixed(0)}% items=${(ev.line_item_accuracy * 100).toFixed(0)}% src=${(ev.source_filled_rate * 100).toFixed(0)}%`,
      );
    } catch (e) {
      fail += 1;
      rows.push({ id: row.id, language: row.language, error: String(e) });
      console.error(`${row.id} FAIL`, e);
    }
  }

  const n = Math.max(1, index.length - fail);
  const summary = {
    engine: 'mail-ai-api',
    api_base: API_BASE,
    evaluated_at: new Date().toISOString(),
    total: index.length,
    failed_calls: fail,
    classify_accuracy: classifyOk / n,
    field_exact_match_avg: fieldSum / n,
    line_item_accuracy_avg: itemSum / n,
    source_filled_rate_avg: sourceSum / n,
    overall_confidence_avg: confSum / n,
  };

  writeFileSync(join(OUT, 'summary-api.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT, 'details-api.json'), JSON.stringify(rows, null, 2));
  console.log('\n=== summary-api ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
