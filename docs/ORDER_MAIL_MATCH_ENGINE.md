# 견적서 → 메일 학습매칭 엔진 스펙 (erp-test ↔ mail-ai-api)

## 목적
사람이 작성한 **견적서**를 기준으로 **원본 RFQ 메일**(첨부 OCR/텍스트 포함)을 1:1로 찾아  
mail-ai-api 학습용 GT 샘플을 만든다.

- 기존 분류 엔진: `메일 → 견적`
- 이 엔진: `견적 → 메일` (역방향)

## ERP 동작
1. 학습샘플 메뉴: 견적 리스트만 로드 + `order_mail_learning_matches` 조인 (기본 비매칭)
2. 행별 「매칭」클릭 시에만 API 호출
3. 후보 메일 1차 필터( ERP ):
   - `is_sent = false`, 삭제 아님
   - `order.created_at - 15일 ≤ received_at < order.created_at`
   - 이미 다른 견적에 `matched`로 묶인 메일 제외
4. 결과를 DB에 저장 → 재진입 시 API 미호출
5. 「다시 매칭」은 명시 버튼만

## 설정
`mail_ai_settings.match_api_base_url` / `match_api_key`  
(분류용 `api_base_url` / `api_key` 와 **분리**)

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
2. **금액·단가 제외** (견적 후입력)
3. **거래처 한·영 동일음/통용표기** 동등 처리  
   (예: 메일 `Korea Marine Service` ↔ ERP `코리아마린서비스`)
4. 입력 후보만 대상으로 하고, ERP가 준 15일 윈도우 밖은 보지 않음

## erp-test 클라이언트
`src/lib/orderMailMatchClient.ts` → `POST {match_api_base_url}/v1/order-mail-match`
