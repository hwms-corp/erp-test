# Ground Truth baseline (mail-ai-api)

측정:

```bash
npm run ai:poc:eval:api
```

결과 파일:

- `scripts/ai-poc/results/summary-api.json`
- `scripts/ai-poc/results/details-api.json`

오프라인 휴리스틱:

```bash
npm run ai:poc:eval
```

품질 개선 후 `summary-api.json`의 `field_exact_match_avg` / `line_item_accuracy_avg` / `source_filled_rate_avg` 를 이 문서에 기록해 비교합니다.

| 일시 | API | field_exact | line_item | source_filled | note |
|------|-----|-------------|-----------|---------------|------|
| 2026-09-22 | Railway mail-ai-api | 0.75 | 1.00 | 1.00 | Wave B 도입, failed_calls=2(일시 502/DNS), classify=1.00, conf≈0.88 |
