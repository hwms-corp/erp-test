# 학습 GT 파이프라인 (B안)

> **목표:** 추출·분류 정확도(특히 첨부·품목).  
> GT = `order_mail_learning_matches.status=matched`

## 사람 버튼 2개
| 위치 | 버튼 | 동작 |
|------|------|------|
| ERP 학습샘플 | **매칭** | 텍스트로 견적↔메일 확정 → DB만 저장 (**첨부 base64 저장 안 함**) |
| mail-ai-api admin **기존데이터 학습** | **학습** | ERP payload API로 **text+files[]+gold** 받아 기존 classify/extract 실행 → gold 비교 → 개선팩 **누적** |

## B안 핵심
- 실서비스와 동일: **클라이언트가 files[]를 넣어** 엔진 호출.
- 학습 때 “클라이언트” = ERP Edge `learning-gt-payloads` (Gmail에서 첨부 조립).
- mail-ai-api는 Gmail OAuth·첨부 URL을 **모름**. OCR은 엔진 한곳.

```
Admin「학습」
  → GET/POST {SUPABASE}/functions/v1/learning-gt-payloads
       Header: X-Internal-Key: <LEARNING_INTERNAL_KEY>
  ← samples[{ text, files[{filename,mime_type,content_base64}], gold }]
  → 기존 classify/extract(text, files)
  → gold(특히 items)와 diff → 개선팩 누적 (trained_ids 스킵)
```

## ERP Edge: `learning-gt-payloads`
- Secret: `LEARNING_INTERNAL_KEY` (+ 기존 `GMAIL_*`, `SUPABASE_*`)
- `verify_jwt = false` (내부 키 인증)
- 매칭 테이블에 첨부 본체를 넣지 **않음**. 학습 요청 시 Gmail on-demand.

## mail-ai-api Railway
```
LEARNING_GT_PAYLOAD_URL=https://<PROJECT_REF>.supabase.co/functions/v1/learning-gt-payloads
LEARNING_GT_PAYLOAD_KEY=<LEARNING_INTERNAL_KEY와 동일>
LEARNING_GT_PAYLOAD_HEADER=X-Internal-Key   # 기본이면 생략 가능
```
`LEARNING_ATTACHMENT_URL` 방식(A안)은 쓰지 않음.

## 배포 (ERP)
```bash
npx supabase secrets set LEARNING_INTERNAL_KEY=긴랜덤키
npx supabase functions deploy learning-gt-payloads --no-verify-jwt
```

상세 admin 지시: `docs/LEARNING_GT_MAIL_AI_API.md`  
mail-ai-api 에이전트 복붙: `docs/LEARNING_GT_MAIL_AI_API_AGENT_PROMPT.md`
