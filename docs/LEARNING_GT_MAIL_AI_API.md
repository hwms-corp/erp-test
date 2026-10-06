# mail-ai-api: 기존데이터 학습 (B안)

ERP가 첨부 바이트까지 조립한 payload를 주고, API는 **기존 classify/extract만** 돌린다.

## 하지 말 것
- `LEARNING_ATTACHMENT_URL` 로 ERP `gmail-attachment`를 직접 두드리기 (A안 폐기)
- Gmail OAuth를 mail-ai-api에 넣기
- 학습 전용 OCR 파이프라인 신설
- 매칭 테이블/ERP에 첨부 base64 캐시 요구

## 「학습」버튼
1. `exclude_gt_ids` = 이미 반영한 trained_ids
2. ERP 호출:
```
POST {LEARNING_GT_PAYLOAD_URL}
X-Internal-Key: {LEARNING_GT_PAYLOAD_KEY}
Content-Type: application/json

{ "limit": 30, "exclude_gt_ids": ["order:1|mail:2"] }
```
3. 응답 `samples[]` 각 건에 대해:
   - `text` + `files[]` → **기존** classifyText / extractText (첨부 있으면 OCR 생략 금지)
   - 출력 vs `gold` (특히 `gold.items`) 비교
   - 틀린 품명·단위·라벨만 개선팩에 **누적**
   - `gt_id`를 trained_ids에 추가
4. Admin에 첨부 N개 투입 / skip 사유 요약 표시

## Railway env
```
LEARNING_GT_PAYLOAD_URL=https://xxxx.supabase.co/functions/v1/learning-gt-payloads
LEARNING_GT_PAYLOAD_KEY=...
LEARNING_GT_PAYLOAD_HEADER=X-Internal-Key
```
`LEARNING_DB_URL`로 목록 UI를 유지해도 되나, **학습 실행의 입력은 payload API**가 정본.

## ERP 응답 스키마 (요약)
```json
{
  "ok": true,
  "schema_version": "1.0.0",
  "mode": "erp_assembles_files",
  "sample_count": 1,
  "files_attached_total": 2,
  "files_skipped_total": 0,
  "samples": [
    {
      "gt_id": "order:123|mail:456",
      "matched_at": "2026-10-01T00:00:00Z",
      "text": "subject\\nfrom\\nbody",
      "files": [
        {
          "filename": "RFQ.pdf",
          "mime_type": "application/pdf",
          "content_base64": "..."
        }
      ],
      "files_skipped": [
        { "attachment_id": 9, "filename": "logo.png", "reason": "low_priority_cid_image" }
      ],
      "gold": {
        "document_type": "quotation_request",
        "customer": { "name": "...", "contact_name": "...", "email": null },
        "request": {
          "document_no": "Q-001",
          "request_date": "2026-09-01",
          "vessel": "...",
          "contact_person": "..."
        },
        "items": [
          {
            "product_name": "...",
            "specification": "...",
            "quantity": 1,
            "unit": "PCS",
            "remark": null,
            "seq": 1
          }
        ]
      },
      "mail": { "id": 456, "subject": "...", "from_addr": "...", "body_text": "..." },
      "order": { "id": 123, "doc_no": "Q-001", "partner_name": "..." },
      "match": { "id": 1, "score": 95, "engine_version": "..." }
    }
  ]
}
```

`files[].content_base64` 는 **표준 base64** (Gmail url-safe 아님).  
실서비스 `/v1/documents/classify|extract` 의 `files[]` 와 동일 형태.

## /v1 SaaS
변경 없음. 클라이언트가 준 files[]만 사용.
