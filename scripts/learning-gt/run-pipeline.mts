/**
 * 학습 GT 파이프라인 프로그램 검증 (라이브 matched 불필요)
 *
 * 1) fixture samples.jsonl 로드
 * 2) lexicon / templates / A-of-B / fail-bank 빌드
 * 3) gold↔(의도적 불완전 pred) eval 스모크
 *
 * Usage: npm run learning-gt:pipeline
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LearningGtSample } from '../../src/lib/learningGt.ts';
import {
  evaluateGoldVsPred,
  summarizeLearningGtEvals,
} from '../../src/lib/learningGtEval.ts';
import { buildLearningGtLexicon } from '../../src/lib/learningGtLexicon.ts';
import { buildLearningGtTemplates } from '../../src/lib/learningGtTemplates.ts';
import {
  collectOfAmbiguityExamples,
  summarizeOfAmbiguity,
} from '../../src/lib/learningGtOfAmbiguity.ts';
import { buildLearningGtFailBank } from '../../src/lib/learningGtFailBank.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, 'fixtures');
const OUT = join(__dirname, 'results');

function loadSamples(path: string): LearningGtSample[] {
  const text = readFileSync(path, 'utf8');
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => JSON.parse(l) as LearningGtSample);
}

/** 파이프라인 스모크용: gold에서 품목 일부를 깨뜨린 pred */
function makeNoisyPred(sample: LearningGtSample) {
  const gold = sample.gold;
  return {
    ...gold,
    request: {
      ...gold.request,
      // document_no는 맞게 두고 vessel만 비움 → 필드 실패 태그 유도
      vessel: gold.request.vessel ? null : gold.request.vessel,
    },
    items: gold.items.map((it, i) =>
      i === 0
        ? { ...it, quantity: Number(it.quantity) + 1 } // qty 오차
        : it,
    ),
  };
}

mkdirSync(OUT, { recursive: true });
const samples = loadSamples(join(FIX, 'samples.jsonl'));
if (samples.length === 0) {
  console.error('No fixture samples');
  process.exit(1);
}

const lexicon = buildLearningGtLexicon(samples);
const templates = buildLearningGtTemplates(samples);

const ofExamples = samples.flatMap(s => {
  const text = [s.mail.subject, s.mail.body_text].filter(Boolean).join('\n');
  return [
    ...collectOfAmbiguityExamples({
      gt_id: s.gt_id,
      text,
      field: 'items.product_name',
      gold_value: s.gold.items[0]?.product_name,
    }),
    ...collectOfAmbiguityExamples({
      gt_id: s.gt_id,
      text,
      field: 'request.vessel',
      gold_value: s.gold.request.vessel,
    }),
  ];
});
const ofStats = summarizeOfAmbiguity(ofExamples);

const evals = samples.map(s =>
  evaluateGoldVsPred({
    gt_id: s.gt_id,
    gold: s.gold,
    pred: makeNoisyPred(s),
    pred_document_type: 'quotation_request',
  }),
);
const summary = summarizeLearningGtEvals(evals);
const failBank = buildLearningGtFailBank(evals);

writeFileSync(join(OUT, 'lexicon.json'), JSON.stringify(lexicon, null, 2));
writeFileSync(join(OUT, 'templates.json'), JSON.stringify(templates, null, 2));
writeFileSync(join(OUT, 'of-ambiguity.json'), JSON.stringify(ofStats, null, 2));
writeFileSync(join(OUT, 'eval-summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(OUT, 'eval-details.json'), JSON.stringify(evals, null, 2));
writeFileSync(join(OUT, 'fail-bank.json'), JSON.stringify(failBank, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      samples: samples.length,
      clusters: templates.clusters.length,
      lexicon_units: lexicon.units.length,
      of_ambiguity: ofStats.example_count,
      eval: {
        field_exact_match_avg: summary.field_exact_match_avg,
        line_item_accuracy_avg: summary.line_item_accuracy_avg,
      },
      fail_bank_entries: failBank.entry_count,
      out: OUT,
    },
    null,
    2,
  ),
);
