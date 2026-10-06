# 견적서 → 메일 학습매칭 (erp-test ↔ mail-ai-api)

## 목적
사람이 작성한 **견적서**를 기준으로, Gmail 라벨 **`1-1. 견적서`** 메일을 찾아  
학습용 GT 샘플을 만든다. **키 = 견적번호(doc_no) ↔ 메일 Ref no.**

## 핵심 규칙 (2026-10 재설계)
| 항목 | 내용 |
|------|------|
| 후보 메일 | 라벨 `1-1. 견적서`만 (`gmail_labels` → `mail_messages.gmail_label_ids`) |
| 기간 | **없음** (15일 윈도우 제거) |
| 첨부 | **없음** (OCR/base64 제거). 제목·본문·발신자만 |
| 키 | ERP `orders.doc_no` ↔ 메일 제목/본문의 Ref/문서번호 (정규화·유사 매칭) |
| 보조 | 거래처명·담당자 (from/subject/body) |
| UX | 행별 「매칭」+ **「전체 매칭」큐**(1건 완료→즉시 표시→다음) |
| 결과 | **다중 후보** 저장 → 상세에서 사람이 1건 **확정** |

## ERP 동작
1. 목록: 견적 + `order_mail_learning_matches` (후보 N / 확정 / 비매칭)
2. 「매칭」또는 「전체 매칭」:
   - 라벨 메일 풀 로드 (캐시)
   - 엔진 API 있으면 텍스트 전용 호출, 없으면 **ERP 로컬 Ref 휴리스틱**
   - 후보를 `status=candidate`로 다건 insert (기존 행 삭제 후)
3. 상세: 후보 리스트 → 「이 메일로 확정」→ `matched` / 나머지 `rejected`
4. 확정된 견적은 전체 매칭 큐에서 건너뜀

## 설정
`mail_ai_settings.match_api_base_url` / `match_api_key`  
(분류용 `api_*` 와 분리. 엔진 미배포여도 ERP 로컬 매칭으로 동작)

## erp-test 연동 위치

| 역할 | 경로 |
|------|------|
| 스펙 | `docs/ORDER_MAIL_MATCH_ENGINE.md` (본 문서) |
| Ref 추출·로컬 매칭 | `src/lib/orderMailMatch.ts` |
| API 클라이언트 | `src/lib/orderMailMatchClient.ts` → `POST /v1/order-mail-match` |
| 훅 (건별·전체 큐·확정) | `src/hooks/useOrderMailMatch.ts` |
| 목록 UI | `src/views/OrderMailMatchListPanel.tsx` |
| 상세·후보 선택 | `src/views/OrderMailMatchDetailView.tsx` |
| DB | `028_…`, `029_order_mail_learning_multi_candidates.sql` |

---

## mail-ai-api 에이전트 작업 가이드

### 해야 할 일
`POST /v1/order-mail-match` 를 **텍스트 Ref 다중 후보** API로 맞춘다.

### 하지 말 것
- 첨부 OCR / base64 처리
- 15일 lookback / 날짜 윈도우
- 품목 coverage·단가 비교
- 분류(`/v1/documents/classify`)·추출 파이프라인 변경

### Request
```json
{
  "order": {
    "id": 123,
    "doc_no": "HW260929001",
    "order_date": "2026-09-29",
    "created_at": "2026-09-29T05:12:00Z",
    "partner_name": "코리아마린서비스",
    "partner_name_hints": ["Korea Marine Service", "kmseng"],
    "partner_email": "kmseng@kmseng.com",
    "contact_person": "안정범",
    "vessel": "ADVANTAGE VERDICT",
    "items": []
  },
  "candidates": [
    {
      "mail_id": 10411,
      "subject": "... REF NO. [HW609-7590] ...",
      "from_addr": "...",
      "to_addr": "...",
      "received_at": "2026-09-28T08:11:39Z",
      "body_text": "...",
      "snippet": "..."
    }
  ],
  "options": {
    "mode": "ref_text",
    "no_attachments": true,
    "no_date_window": true,
    "return_candidates": true,
    "exclude_prices": true,
    "partner_ko_en_equivalent": true
  }
}
```

ERP는 이미 라벨 필터된 메일만 넘긴다. 엔진은 **입력 후보만** 본다.

### Response (필수)
```json
{
  "status": "candidates",
  "candidates": [
    {
      "mail_id": 10411,
      "score": 0.93,
      "extracted_ref": "HW609-7590",
      "reasons": ["ref_fuzzy", "partner_from"],
      "evidence": {
        "extracted_ref": "HW609-7590",
        "order_doc_no": "HW260929001",
        "ref_score": 0.88
      }
    }
  ],
  "engine_version": "order-mail-match@ref-0.2.0"
}
```

- 후보 0건: `{ "status": "unmatched", "candidates": [] }`
- 구버전 `{ status:"matched", mail_id }` 단일 응답도 ERP가 candidates로 정규화함 (과도기 OK)
- **attachments 필드 무시** (와도 OCR 하지 말 것)

### 엔진 로직 권장
1. 각 메일 subject/body에서 Ref 토큰 추출 (`REF NO`, `Doc No`, 대괄호, `영문+숫자` 패턴)
2. 정규화(대문자·하이픈/공백 제거) 후 `order.doc_no`와 exact / contains / fuzzy
3. 애매하면 LLM으로 “같은 문서번호인가?”만 판별 (전량 LLM 금지)
4. 거래처·담당은 가산점만
5. score 내림차순으로 candidates 반환 (상한 20 권장)

### 인증
기존 match API Key (`Authorization: Bearer …`). 분류 키와 별도.

### 헬스
`GET /health` + ERP가 빈 candidates로 POST probe (401/404만 실패).

### 완료 기준
- [ ] `mode=ref_text` / `no_attachments` 동작
- [ ] `candidates[]` 다중 반환
- [ ] 첨부·날짜 로직 제거
- [ ] erp-test에서 엔진 키 넣으면 로컬 폴백 대신 엔진 결과 저장 (`engine_version` 확인)

---

## DB status
`candidate` | `matched`(사람 확정) | `rejected` | `unmatched` | `failed`  
견적당 `matched` 최대 1, 메일당 `matched` 최대 1.

## 학습 GT (추출·분류 정확도용)
ERP는 매칭·확정만 DB에 저장. JSON 다운로드 없음.  
mail-ai-api admin **「기존데이터 학습」** 이 `matched` / `v_learning_gt_matched` 를 pull 후 「학습」(누적).  
→ `docs/LEARNING_GT_PIPELINE.md` · `docs/LEARNING_GT_MAIL_AI_API.md`


