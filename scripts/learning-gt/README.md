# 학습 GT 프로그램 (데이터 없이 로직 검증)

라이브 `matched` 없이도 fixture로 파이프라인을 돌린다.  
실제 샘플은 나중에 「GT 스냅샷」JSONL을 같은 형식으로 넣으면 된다.

```bash
npm run learning-gt:pipeline
```

산출: `scripts/learning-gt/results/`
- `lexicon.json` / `templates.json` / `of-ambiguity.json`
- `eval-summary.json` / `eval-details.json` / `fail-bank.json`

소스 라이브러리 (`src/lib/`):
- `learningGt.ts` — 스냅샷 스키마·export
- `learningGtEval.ts` — gold vs pred (품목 핵심)
- `learningGtLexicon.ts` / `learningGtTemplates.ts`
- `learningGtOfAmbiguity.ts` — A of B
- `learningGtFailBank.ts`
