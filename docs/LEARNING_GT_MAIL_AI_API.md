# mail-ai-api: GT 프로그램 · eval 체크리스트

**지금은 실 matched 전달보다, fixture/스키마로 eval·OCR 프로그램을 먼저.**  
erp-test: `npm run learning-gt:pipeline` · `docs/LEARNING_GT_PIPELINE.md`

## P1 프로그램 (데이터 나중)
- [ ] `samples.jsonl` 스키마 파서 (erp fixture와 동일)
- [ ] gold vs extract 비교 — **`line_item_accuracy` 필수**, field_exact, classify
- [ ] snapshot 디렉터리 고정 로더 (`gt_snapshots/{id}/`)
- [ ] 첨부 id → 바이너리 로드 어댑터 (stub OK)
- [ ] `summary.json` / `details.json` / fail_bank 출력
- [ ] fixture만으로 CI 스모크

## P2+ (추출 정확도)
- [ ] 첨부 OCR·표·재검증 + 품목 eval 연동
- [ ] lexicon/templates 라우팅
- [ ] A of B 규칙

## 실데이터 연결 (나중에)
- [ ] erp 「GT 스냅샷」또는 `v_learning_gt_matched` pull
- [ ] 배포 게이트: 이전 snapshot 대비 회귀 차단

## 하지 말 것
- matched 변경마다 자동 재학습 / 실시간 push
