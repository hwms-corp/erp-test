# 학습 GT 파이프라인 (erp-test ↔ mail-ai-api)

> **목표:** mail-ai-api 메일 추출·분류 정확도 향상 (특히 첨부·품목).  
> GT = ERP `order_mail_learning_matches` 에서 **status=matched** 인 사람 확정분.

## 사람 조작 (버튼 2개만)
| 위치 | 버튼 | 동작 |
|------|------|------|
| ERP 학습샘플 | **매칭** (·전체 매칭·상세 확정) | 확정 결과를 DB에 저장 |
| mail-ai-api admin **기존데이터 학습** | **학습** | DB matched를 pull → **누적** 학습 → 개선 팩을 추출/분류에 적용 |

- ERP **JSON 다운로드 / GT 스냅샷 버튼 없음** (제거됨).
- 확정 시 mail-ai-api로 자동 push 하지 않음. admin이 DB에서 불러옴.

## 데이터 흐름
```
ERP 「매칭」→ order_mail_learning_matches(matched) + mail/order/items
        ↓  (pull)
admin「기존데이터 학습」리스트
        ↓  「학습」
이전 디폴트 개선팩 + 신규 matched → 새 디폴트 개선팩 저장
        ↓
classify / extract 런타임이 개선팩 사용
```

## 누적 학습
- 학습 결과는 **새 디폴트**로 저장.
- 다음 학습 = 기존 디폴트 + 추가로 쌓인 matched (처음부터 재학습 아님).
- 모델 파인튜닝이 아니라, 추출/분류 정확도용 **규칙·사전·양식·조건 팩** 갱신.

## ERP 측
- 매칭/확정 UI, DB, 뷰 `v_learning_gt_matched`
- 스키마·eval 참고 라이브러리·fixture CLI는 개발/검증용으로 유지 (`npm run learning-gt:pipeline`)
- export 다운로드 UI 없음

## mail-ai-api 측 (admin)
상세: `docs/LEARNING_GT_MAIL_AI_API.md`
