# 학습 GT 파이프라인 (erp-test → mail-ai-api)

> **목표:** mail-ai-api가 메일(제목·본문·송신자) + **첨부(특히 품목)** 를  
> 정확히 추출·분류해 견적서에 자동 저장할 수 있을 때까지 정확도를 끌어올린다.  
> `order_mail_learning_matches(status=matched)` 는 그 **정답지(GT)** 이다.

## 운영 원칙 (중요)
1. **지금은 프로그램·로직·스키마를 먼저 완성**한다.  
2. **matched 실데이터 적립·스냅샷 전달은 나중에** (시간 날 때 UI로 쌓고 export).  
3. 개발/검증은 **fixture JSONL** 로 파이프라인을 돌린다 (`npm run learning-gt:pipeline`).  
4. 매칭 직후 API push / 요청마다 재학습은 **하지 않음**.

## 구현 순서 (프로그램 우선)

| 단계 | 담당 | 내용 | 상태 |
|------|------|------|------|
| **P0** | erp-test | GT 스키마 · export · DB 뷰 · **eval/lexicon/templates/A-of-B/fail-bank 라이브러리** · fixture CLI | **진행** |
| **P1** | mail-ai-api | 동일 스키마로 pull 어댑터 + **회귀 eval 러너** (fixture로 먼저) | 다음 |
| **P2** | mail-ai-api | 첨부 OCR·표·재검증 파이프라인 (품목 핵심) + eval 연동 | |
| **P3** | mail-ai-api | 본문 추출 · lexicon/템플릿 라우팅 · A of B 규칙 | |
| **P4** | 양쪽 | 실패 뱅크 → 개선 루프 · 배포 게이트 | |
| **D0** | 사람 | (나중에) matched 적립 → GT 스냅샷 → 실데이터 eval | 데이터 단계 |

---

## P0 — erp-test 프로그램 (데이터 불필요)

### 라이브러리 (`src/lib/`)
| 모듈 | 역할 |
|------|------|
| `learningGt.ts` | 스냅샷 스키마 · matched export (실데이터 있을 때) |
| `learningGtEval.ts` | **gold vs pred** — `line_item_accuracy` 최중요 |
| `learningGtLexicon.ts` | 용어·단위·제목 히트율 |
| `learningGtTemplates.ts` | from 도메인 양식 클러스터 |
| `learningGtOfAmbiguity.ts` | A of B / A/B 중의성 예제 |
| `learningGtFailBank.ts` | 실패 유형 뱅크 |

### CLI
```bash
npm run learning-gt:pipeline
```
fixture → lexicon/templates/of-ambiguity/eval/fail-bank 산출 (`scripts/learning-gt/results/`).

실데이터 쓸 때: UI 「GT 스냅샷」JSONL을 같은 형식으로 `run-pipeline`에 넣거나 mail-ai-api가 로드.

### DB
`v_learning_gt_matched` — 엔진 pull용 뷰 (데이터 없어도 뷰는 존재).

---

## P1 — mail-ai-api (체크리스트)
`docs/LEARNING_GT_MAIL_AI_API.md`  
먼저 fixture/스키마로 eval 러너만 만들고, 실 matched는 나중에 연결.

## 샘플 스키마
`samples.jsonl` 1행 = `{ gt_id, mail, gold, order, match }`  
`gold.items[]` = 추출·분류 정답(품목). 첨부 바이너리는 id만.

## 역할
| | erp-test | mail-ai-api |
|--|----------|-------------|
| 프로그램 | 스키마·지표·파생자산 빌더 | extract/OCR + eval 러너 |
| 데이터(나중) | matched 확정·스냅샷 | pull 후 회귀 |
