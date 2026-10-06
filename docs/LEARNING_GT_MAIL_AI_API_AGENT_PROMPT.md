# mail-ai-api 에이전트용 복붙 프롬프트 (B안)

아래 블록 전체를 mail-ai-api 에이전트 채팅에 **그대로** 붙여넣으면 된다.

---

```
[작업] Admin「기존데이터 학습」을 B안으로 구현해줘.

## 배경 (erp-test 쪽은 이미 완료)
- GT = ERP DB order_mail_learning_matches.status='matched' (견적↔메일 정답쌍)
- 매칭 단계에서는 첨부 base64를 매칭 테이블에 저장하지 않음 (텍스트 매칭만)
- 학습 정확도(특히 품목 OCR)를 위해 ERP Edge가 학습 요청 시 Gmail에서 첨부를 읽어 text+files[]+gold 를 조립해 줌
- mail-ai-api는 Gmail OAuth / 첨부 URL을 몰라도 됨. 받은 files[]로 기존 classify/extract만 돌림

## ERP payload API (이미 배포 대상)
POST {LEARNING_GT_PAYLOAD_URL}
Header:
  X-Internal-Key: {LEARNING_GT_PAYLOAD_KEY}
  Content-Type: application/json
Body:
  { "limit": 30, "exclude_gt_ids": ["order:123|mail:456", ...] }

응답 핵심:
{
  "ok": true,
  "schema_version": "1.0.0",
  "mode": "erp_assembles_files",
  "sample_count": N,
  "files_attached_total": N,
  "files_skipped_total": N,
  "samples": [
    {
      "gt_id": "order:123|mail:456",
      "text": "subject\\nfrom\\nbody",
      "files": [
        { "filename": "RFQ.pdf", "mime_type": "application/pdf", "content_base64": "..." }
      ],
      "files_skipped": [{ "attachment_id": 9, "filename": "logo.png", "reason": "..." }],
      "gold": {
        "document_type": "quotation_request",
        "customer": { "name": "...", "contact_name": "...", "email": null },
        "request": { "document_no": "...", "request_date": "...", "vessel": "...", "contact_person": "..." },
        "items": [
          { "product_name": "...", "specification": "...", "quantity": 1, "unit": "PCS", "remark": null, "seq": 1 }
        ]
      }
    }
  ]
}

- files[].content_base64 = 표준 base64 (Gmail url-safe 아님)
- /v1/documents/classify|extract 의 files[] 와 동일 형태
- 첨부 없으면 files=[] 로 올 수 있음 (본문만 학습)

## 구현할 것
1) Railway env 추가
   LEARNING_GT_PAYLOAD_URL=https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/learning-gt-payloads
   LEARNING_GT_PAYLOAD_KEY=<ERP LEARNING_INTERNAL_KEY 와 동일 값>
   LEARNING_GT_PAYLOAD_HEADER=X-Internal-Key   # 기본값이면 생략 가능

2) Admin「기존데이터 학습」버튼 플로우
   a. trained_ids(이미 학습한 gt_id) 로드
   b. ERP payload API 호출 (exclude_gt_ids = trained_ids, limit 기본 30)
   c. samples[] 각 건:
      - 기존 classify/extract(text, files) 실행 (files 있으면 OCR 생략 금지 — 실서비스와 동일 경로)
      - pred vs gold 비교 (특히 gold.items: 품명/규격/수량/단위)
      - 틀린 것만 개선팩(lexicon/templates/of-ambiguity 등 기존 학습 산출)에 **누적**
      - gt_id 를 trained_ids 에 추가 (다음 실행 시 스킵)
   d. UI에 sample_count / files_attached_total / files_skipped 요약 표시

3) 폐기·하지 말 것
   - LEARNING_ATTACHMENT_URL / ERP gmail-attachment 직접 호출 (A안)
   - mail-ai-api에 Gmail OAuth 추가
   - 학습 전용 OCR 파이프라인 신설
   - ERP 매칭 테이블에 첨부 base64 저장 요구
   - /v1 SaaS 공개 API 시그니처 변경 (클라이언트가 files[] 넣는 방식 유지)

4) LEARNING_DB_URL 로 matched 목록 UI를 유지해도 됨. 단 **학습 실행 입력의 정본은 payload API** (DB에서 본문만 긁어 학습하면 첨부 누락).

## 완료 기준
- Admin「학습」한 번으로 ERP matched 샘플을 받아 text+files로 classify/extract → gold.diff → 개선팩 누적
- 첨부 있는 샘플에서 files[]가 엔진에 실제로 들어가는 것 확인 (로그/요약)
- trained_ids로 재학습 스킵
- A안 env/코드 잔재 제거

한국어로 진행 결과 요약해줘.
```
