# 견적서 → 메일 학습매칭 엔진 스펙 (erp-test ↔ mail-ai-api)

## 목적
사람이 작성한 **견적서**를 기준으로 **원본 RFQ 메일**(첨부 OCR/텍스트 포함)을 1:1로 찾아  
mail-ai-api 학습용 GT 샘플을 만든다.

- 기존 분류 엔진: `메일 → 견적`
- 이 엔진: `견적 → 메일` (역방향)

## ERP 동작
1. 학습샘플 메뉴: 견적 리스트만 로드 + `order_mail_learning_matches` 조인 (기본 비매칭)
2. 행별 「매칭」클릭 시에만 API 호출
3. 후보 메일 1차 필터( **ERP** ):
   - `is_sent = false`, 삭제 아님
   - `order.created_at - 15일 ≤ received_at < order.created_at`
   - 이미 다른 견적에 `matched`로 묶인 메일 제외
4. **텍스트 사전 필터( ERP, 첨부 전 )** — `subject` / `from` / `body` / 첨부 **파일명(메타만)**:
   - doc_no · 거래처 힌트/이메일 · vessel · 담당 · 품명 느슨 매칭으로 점수
   - 상위 `TEXT_PREFILTER_TOP_N`(기본 20)만 남김 → **이 단계에서만** Gmail 첨부 base64 다운로드
   - 점수가 전부 0이어도 최신순 topN 폴백 (본문은 비고 RFQ가 첨부에만 있는 경우)
   - mail-ai-api로 200통을 보내 OCR 돌리는 방식이 아님 (느리고 비쌈)
5. 결과를 DB에 저장 → 재진입 시 API 미호출
6. 「다시 매칭」은 명시 버튼만

## 설정
`mail_ai_settings.match_api_base_url` / `match_api_key`  
(분류용 `api_base_url` / `api_key` 와 **분리** — 동일 키 폴백 없음)

## erp-test 연동 위치 (mail-ai-api 에이전트용)

| 역할 | 경로 |
|------|------|
| 스펙 문서 | `docs/ORDER_MAIL_MATCH_ENGINE.md` |
| 학습매칭 API 클라이언트 | `src/lib/orderMailMatchClient.ts` → `POST {match_api}/v1/order-mail-match` |
| 후보 필터·한영 힌트 | `src/lib/orderMailMatch.ts` |
| 목록/건별 매칭 훅 | `src/hooks/useOrderMailMatch.ts` |
| 학습샘플 UI | `src/views/OrderMailMatchListPanel.tsx`, `OrderMailMatchDetailView.tsx` |
| AI 연동 UI (키 2개) | `src/components/AiConnectionModal.tsx` |
| 설정 로드/저장 | `src/hooks/useMail.ts` (`fetchMailAiSettings` / `updateMailAiSettings`) |
| DB | `mail_ai_settings.api_*` = 분류, `mail_ai_settings.match_api_*` = 학습매칭 |
| 마이그레이션 | `supabase/migrations/028_order_mail_learning_matches.sql` |
| 메일함 분류 호출 | `src/lib/aiDocClient.ts` + `src/hooks/useMail.ts` (`classify`/`extract`) — **여기 건드리지 말 것** |

환경변수(빌드 폴백, 분류만):
- `VITE_AI_DOC_API_URL` / `VITE_AI_DOC_API_KEY`

런타임 DB:
- 분류: `api_base_url`, `api_key`
- 학습매칭: `match_api_base_url`, `match_api_key`

## API (제안)

### `GET /health`
기존과 동일.

### `POST /v1/order-mail-match`
견적 1건 + 후보 메일 N통 → best mail 또는 unmatched.

```json
{
  "order": {
    "id": 123,
    "doc_no": "HW260929001",
    "order_date": "2026-09-29",
    "created_at": "2026-09-29T05:12:00Z",
    "partner_name": "코리아마린서비스",
    "partner_name_hints": ["Korea Marine Service", "kmseng", "코리아마린"],
    "partner_email": "kmseng@kmseng.com",
    "contact_person": "안정범",
    "vessel": "ADVANTAGE VERDICT",
    "items": [
      { "name": "...", "spec": "...", "qty": 1, "unit": "EA", "remark": null }
    ]
  },
  "candidates": [
    {
      "mail_id": 10411,
      "subject": "...",
      "from_addr": "...",
      "received_at": "2026-09-28T08:11:39Z",
      "body_text": "...",
      "snippet": "...",
      "attachments": [
        {
          "filename": "RFQ.pdf",
          "mime_type": "application/pdf",
          "content_base64": "..."
        }
      ]
    }
  ],
  "options": {
    "exclude_prices": true,
    "partner_ko_en_equivalent": true
  }
}
```

### Response
```json
{
  "status": "matched",
  "mail_id": 10411,
  "score": 0.97,
  "reasons": ["doc_no", "vessel", "item_name_coverage"],
  "evidence": {
    "fields": [
      { "order_field": "doc_no", "order_value": "...", "mail_evidence": "...", "source": "attachment:RFQ.pdf" }
    ]
  },
  "engine_version": "order-mail-match@0.1.0"
}
```

`status`: `matched` | `unmatched`  
후보가 없거나 확신 부족 시 `unmatched` + `mail_id: null`.

## 엔진 요구사항
1. **첨부 필수**: PDF / xlsx / docx / 이미지 OCR·텍스트 추출 후 비교  
   (ERP가 이미 텍스트로 줄인 후보만 받음 — 엔진 쪽 추가 텍스트 프리필터 불필요)
2. **금액·단가 제외** (견적 후입력)
3. **거래처 한·영 동일음/통용표기** 동등 처리  
   (예: 메일 `Korea Marine Service` ↔ ERP `코리아마린서비스`)
4. 입력 후보만 대상으로 하고, ERP가 준 15일 윈도우 밖은 보지 않음

## 역할 분담 (텍스트 사전 필터)
| 단계 | 담당 | 이유 |
|------|------|------|
| 15일 윈도우 + taken 제외 | **erp-test** | DB에 메일·견적이 있음 |
| subject/body/from/파일명으로 topN | **erp-test** | 첨부 base64 다운로드·전송 전에 후보를 줄여야 함. API에 200통 보내고 OCR하면 늦음 |
| 첨부 OCR·정밀 매칭 | **mail-ai-api** | 엔진 전용. ERP가 넘긴 N통만 처리 |

## erp-test 클라이언트
`src/lib/orderMailMatchClient.ts` → `POST {match_api_base_url}/v1/order-mail-match`
