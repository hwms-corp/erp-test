# 학습 GT 파이프라인 (erp-test → mail-ai-api)

> **목표:** mail-ai-api가 메일(제목·본문·송신자) + **첨부(특히 품목)** 를  
> 정확히 추출·분류해 견적서에 자동 저장할 수 있을 때까지 정확도를 끌어올린다.  
> `order_mail_learning_matches(status=matched)` 는 그 **정답지(GT)** 이다.

## 시작 순서 (지금 → 다음)

| 단계 | 담당 | 내용 | 상태 |
|------|------|------|------|
| **0** | erp-test | matched GT **스냅샷 export** (JSON/JSONL) + 스키마 고정 | **진행 중** |
| **1** | mail-ai-api | GT pull / snapshot 로드 + **회귀 eval** (필드·품목) | 다음 |
| **2** | 양쪽 | GT로 **lexicon·템플릿 클러스터** 빌드 | |
| **3** | mail-ai-api | **첨부 OCR·표·재검증** 파이프라인 강화 (품목 핵심) | |
| **4** | mail-ai-api | 본문/제목 추출·중의성(A of B)·전처리 | |
| **5** | 양쪽 | 실패 케이스 뱅크 + 배포 게이트(eval 점수) | |
| **6** | 환류 | 틀린 건 사람 수정 → matched 재적립 → 새 스냅샷 | |

매칭 직후 API push / 요청마다 재학습은 **하지 않음**.

---

## Step 0 — erp-test GT 스냅샷 (본 단계)

### 무엇을 만드나
사람이 확정한 `matched` 행만 모아, mail-ai-api가 바로 쓸 수 있는 파일을 만든다.

```
learning-gt-{snapshot_id}/
  manifest.json    # 메타·건수·스키마 버전
  samples.jsonl    # 1행 = 1 GT 샘플
```

UI: 학습샘플 목록 → **「GT 스냅샷」** 버튼으로 다운로드.  
코드: `src/lib/learningGt.ts` · `buildLearningGtSnapshot()`.

### 샘플 스키마 (samples.jsonl 한 줄)
```json
{
  "gt_id": "order:123|mail:456",
  "matched_at": "...",
  "match": { "score": 1, "engine_version": "...", "evidence": {} },
  "mail": {
    "id": 456,
    "subject": "...",
    "from_addr": "...",
    "to_addr": "...",
    "snippet": "...",
    "body_text": "...",
    "received_at": "...",
    "attachments": [
      { "id": 1, "filename": "RFQ.pdf", "mime_type": "application/pdf", "size_bytes": 12345 }
    ]
  },
  "gold": {
    "document_type": "quotation_request",
    "customer": { "name": "...", "contact_name": "...", "email": "..." },
    "request": {
      "document_no": "HW...",
      "request_date": "2026-09-29",
      "vessel": "...",
      "contact_person": "..."
    },
    "items": [
      { "product_name": "...", "specification": "...", "quantity": 1, "unit": "EA", "remark": null }
    ]
  },
  "order": { "id": 123, "doc_no": "HW...", "partner_id": 1 }
}
```

`gold` = ERP에 사람이 넣어 둔 견적 값 → **추출·분류의 정답**.  
첨부 **바이너리는 export에 넣지 않음** — mail-ai-api가 `mail_attachments.id`로 gmail-attachment/스토리지에서 로드.

### DB 뷰 (엔진 pull용)
`v_learning_gt_matched` — matched 조인 요약. mail-ai-api가 Supabase read로 조회 가능.

---

## Step 1 — mail-ai-api: pull + 회귀 eval

1. matched 조회 또는 erp export JSONL 로드 → `gt_snapshots/{id}/` 고정
2. 각 샘플에 대해 기존 classify/extract 실행 (메일+첨부)
3. 비교 지표 (필수):
   - `request.document_no` / customer.name / vessel / contact
   - **`items[]` line accuracy** (이름·규격·수량·단위) ← 최중요
   - classify = quotation_request
4. `summary.json` 저장, 이전 스냅샷 대비 회귀 시 배포 차단

체크리스트: `docs/LEARNING_GT_MAIL_AI_API.md`

---

## Step 2 — lexicon · 템플릿
- GT `gold` + 메일 from 도메인으로 거래처별 양식 클러스터
- 필드별 고빈도 토큰/패턴 사전 (품명·단위·vessel)
- export `manifest.derived` 또는 별도 `lexicon.json` 빌드

## Step 3 — 첨부 파이프라인
- OCR / 표 / 이미지화·재검증 횟수
- GT 첨부로 읽기 성공률·품목 F1 벤치 분리

## Step 4~6
- A of B, 인용문 제거, 실패 뱅크, 환류

---

## 역할 분담
| | erp-test | mail-ai-api |
|--|----------|-------------|
| GT 생산 | matched 확정 UI | — |
| GT 제공 | 스냅샷 다운로드 + DB 뷰 | pull / 파일 로드 |
| 추론 개선 | — | extract/classify/OCR |
| 평가 | — | eval vs gold |
| 환류 | 수정→재확정 | 실패 리포트 |

## 비추천
- 매칭 완료 즉시 mail-ai-api로 push
- 분류 HTTP 요청마다 GT 재학습
