# AI 메일 실패·검토 샘플 팩 (2026-09-28)

mail-ai-api 성능 개선 전, **실DB + GT KPI**에서 뽑은 타깃 목록입니다.  
정답(사람이 확인한 필드)은 아직 비어 있으니, 튜닝할 때 메일 id로 ERP AI 메일함에서 열어 확인하면 됩니다.

## 파일

| 파일 | 내용 |
|------|------|
| `samples.json` | 실메일 20건 (검토필요 12 + 비견적 의 5 + 자동후보 스팟 3) |
| `gt-kpi-field-gaps.json` | GT 50건 KPI에서 틀린 필드 요약 |

## KPI에서 바로 나온 개선 포인트

- `field_exact_match_avg = 0.75` 인 이유: **50건 모두 `request.document_no`만 실패**
- 거래처명·납기·선명·품목 라인은 GT 기준 전부 일치
- → mail-ai-api 1순위 개선 후보는 **문서번호(RFQ No / 견적번호 / 询价单号 등) 추출**

## 실메일 현황 (삭제 제외, 측정 시점)

| process_status | 건수 | 비고 |
|----------------|------|------|
| received (미분류) | ~5259 | 대기 큐 |
| rejected (비견적) | ~4809 | 상당수는 회신(`Re:`) 등 |
| ready_auto | ~53 | 고신뢰 후보 |
| review_required | 22 | 자동등록 게이트/수동재실행 |
| failed | 0 | 현재 실패 큐 비어 있음 |

## `samples.json` 태그

| tag_guess | 의미 |
|-----------|------|
| `auto_register_gate` | 신뢰도/필수항목 부족으로 검토필요 (다수) |
| `manual_rerun_review` | 수동 AI 재실행 후 검토필요 |
| `classify_possible_fn` | 제목에 견적 키워드 있는데 `rejected`인 **원본**(Re: 제외) — 분류 FN 의심 |
| `spotcheck_extraction` | `ready_auto` — 추출 품질 스팟체크용 |

## 다음에 사람이 해주면 좋은 것 (선택)

각 샘플 메일을 ERP에서 열고, 정답 문서번호·거래처·품목 몇 줄을 `notes`로 적어 두면 API 회귀에 바로 쓸 수 있습니다.  
필수는 아니고, **문서번호 추출 개선**부터 가도 됩니다.
