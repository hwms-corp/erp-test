/**
 * A of B / A / B 중의성: 메일 텍스트에서 후보를 찾고 gold가 고른 쪽을 기록
 * (규칙·소모델 학습 재료)
 */

export type OfAmbiguityExample = {
  gt_id: string;
  field: string;
  pattern: 'A_of_B' | 'A_slash_B' | 'A_or_B';
  raw: string;
  left: string;
  right: string;
  /** gold가 채택한 쪽 */
  chosen: 'left' | 'right' | 'neither' | 'both';
  gold_value: string;
};

const OF_RE = /\b([A-Za-z0-9][A-Za-z0-9\-/]{1,40})\s+of\s+([A-Za-z0-9][A-Za-z0-9\-/]{1,40})\b/gi;
const SLASH_RE = /\b([A-Za-z0-9][A-Za-z0-9\-]{1,30})\s*\/\s*([A-Za-z0-9][A-Za-z0-9\-]{1,30})\b/g;
const OR_RE = /\b([A-Za-z0-9][A-Za-z0-9\-]{1,30})\s+or\s+([A-Za-z0-9][A-Za-z0-9\-]{1,30})\b/gi;

function pickSide(gold: string, left: string, right: string): OfAmbiguityExample['chosen'] {
  const g = gold.trim().toLowerCase();
  const l = left.trim().toLowerCase();
  const r = right.trim().toLowerCase();
  if (!g) return 'neither';
  const hitL = g === l || g.includes(l) || l.includes(g);
  const hitR = g === r || g.includes(r) || r.includes(g);
  if (hitL && hitR) return 'both';
  if (hitL) return 'left';
  if (hitR) return 'right';
  return 'neither';
}

function scanPattern(
  text: string,
  re: RegExp,
  pattern: OfAmbiguityExample['pattern'],
  gt_id: string,
  field: string,
  gold_value: string,
  out: OfAmbiguityExample[],
) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const left = m[1];
    const right = m[2];
    out.push({
      gt_id,
      field,
      pattern,
      raw: m[0],
      left,
      right,
      chosen: pickSide(gold_value, left, right),
      gold_value,
    });
  }
}

export function collectOfAmbiguityExamples(input: {
  gt_id: string;
  text: string;
  field: string;
  gold_value: string | null | undefined;
}): OfAmbiguityExample[] {
  const gold = (input.gold_value || '').trim();
  if (!gold || !input.text) return [];
  const out: OfAmbiguityExample[] = [];
  scanPattern(input.text, OF_RE, 'A_of_B', input.gt_id, input.field, gold, out);
  scanPattern(input.text, SLASH_RE, 'A_slash_B', input.gt_id, input.field, gold, out);
  scanPattern(input.text, OR_RE, 'A_or_B', input.gt_id, input.field, gold, out);
  return out.filter(e => e.chosen === 'left' || e.chosen === 'right');
}

export type OfAmbiguityStats = {
  built_at: string;
  example_count: number;
  by_pattern: Record<string, { left: number; right: number }>;
  examples: OfAmbiguityExample[];
};

export function summarizeOfAmbiguity(examples: OfAmbiguityExample[]): OfAmbiguityStats {
  const by_pattern: Record<string, { left: number; right: number }> = {};
  for (const e of examples) {
    if (!by_pattern[e.pattern]) by_pattern[e.pattern] = { left: 0, right: 0 };
    if (e.chosen === 'left') by_pattern[e.pattern].left += 1;
    if (e.chosen === 'right') by_pattern[e.pattern].right += 1;
  }
  return {
    built_at: new Date().toISOString(),
    example_count: examples.length,
    by_pattern,
    examples: examples.slice(0, 500),
  };
}
