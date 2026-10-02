# mail-ai-api: GT pull · 회귀 eval 체크리스트

erp-test `docs/LEARNING_GT_PIPELINE.md` Step 1용.  
**목표 지표의 중심은 품목(items) + 첨부 추출 정확도.**

## Pull
- [ ] Supabase read: `order_mail_learning_matches` where `status='matched'`  
  또는 erp-test가 내려준 `samples.jsonl` 로드
- [ ] 조인: mail_messages, mail_attachments(메타), orders, order_items, partners
- [ ] `gt_snapshots/{snapshot_id}/` 에 복사 고정 (원본 matched가 늘어도 벤치 불변)
- [ ] 첨부 바이너리: attachment id로 ERP gmail-attachment(또는 동일 스토리지)에서 로드

## Eval (필수)
각 GT 샘플에 classify + extract 실행 후 `gold`와 비교:

| 메트릭 | 설명 |
|--------|------|
| `classify_ok` | document_type = quotation_request |
| `field_exact` | document_no, customer.name, vessel, contact 등 |
| `line_item_accuracy` | 품명·규격·수량·단위 매칭 (순서 허용 옵션) |
| `attachment_read_ok` | OCR/파싱 실패율 |
| `source_filled` | evidence/source 채움률 |

- [ ] `summary.json` + `details.json` 저장
- [ ] 이전 snapshot 대비 회귀 시 배포 실패

## 파생 자산 (Step 2+)
- [ ] `lexicon.json` — 필드별 토큰
- [ ] `templates.json` — from 도메인/제목 패턴 클러스터
- [ ] `fail_bank/` — 오추출 유형별 샘플

## 하지 말 것
- erp matched 변경 이벤트마다 자동 재학습
- 분류 키와 학습 GT 키 혼용으로 운영 DB 오염
