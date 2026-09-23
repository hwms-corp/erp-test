# AI Document Intelligence API (월 구독형 SaaS)

독립 서비스. ERP는 이 API만 호출하며 DB를 직접 공유하지 않습니다.

## 실행

```bash
cd ai-doc-api
npm install
npm run dev
```

기본 포트: `4040`  
데모 API Key: `aidoc_demo_haewon_dev_key_change_me` (환경변수 `AI_DOC_DEMO_API_KEY`로 변경 가능)

## 주요 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/health` | 헬스체크 |
| GET | `/v1/schemas` | Canonical schema 목록 |
| POST | `/v1/documents/classify` | RFQ 여부 분류 |
| POST | `/v1/documents/extract` | Key-Value 추출 |
| POST | `/v1/jobs` | 비동기 Job 생성 (202) |
| GET | `/v1/jobs/:id` | Job 상태/결과 |
| GET | `/v1/usage` | 월 사용량 |
| GET | `/v1/billing/plans` | 구독 플랜 |
| GET | `/v1/billing/subscription` | 현재 구독 |
| POST | `/v1/admin/api-keys` | API Key 발급 |
| POST | `/v1/webhooks/test` | Webhook 테스트 |

인증: `Authorization: Bearer <api_key>` 또는 `X-Api-Key: <api_key>`

## 예시

```bash
curl -s http://localhost:4040/v1/documents/extract ^
  -H "Authorization: Bearer aidoc_demo_haewon_dev_key_change_me" ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"제목: 견적의뢰\\n거래처: 한진해운\\n1. 품명: 밸브 / 사양: DN50 / 수량: 2 EA\"}"
```
