# mail-ai-api: 기존데이터 학습 (admin)

erp-test는 **매칭·DB 저장만** 담당. JSON 수동 전달 없음.  
admin이 Supabase/ERP DB에서 `matched`를 pull 한다.

## 메뉴
- 기존「추출채점」을 확장하고 메뉴명을 **「기존데이터 학습」** 으로 변경.
- 새 메뉴는 꼭 필요할 때만.

## 필수 기능
1. **학습용 리스트 불러오기**  
   - `order_mail_learning_matches` where `status='matched'`  
   - 조인: mail_messages, mail_attachments(메타), orders, order_items, partners  
   - 뷰 참고: `v_learning_gt_matched` (+ items 별도)
2. **「학습」버튼 (누적)**  
   - 입력: 현재 디폴트 개선팩(없으면 빈 상태) + DB matched 전체(또는 미학습 신규분+기존 팩)  
   - 출력: 추출/분류 정확도 개선용 팩 (lexicon, 양식 클러스터, 단어/위치 힌트, A of B 조건 등)  
   - 저장: **새 디폴트**로 덮어쓰기/버전 저장  
   - 다음 학습 시 이 디폴트를 이어받음 (풀 재학습 금지)
3. **런타임 적용**  
   - classify / extract 호출 시 최신 디폴트 개선팩을 사용

## 하지 말 것
- ERP에서 JSON 파일 업로드를 요구
- matched 변경마다 자동 재학습 (「학습」버튼만)
- 모델 파인튜닝을 필수로 가정

## ERP 참고
- `docs/LEARNING_GT_PIPELINE.md`
- 스키마/지표 참고: erp-test `src/lib/learningGt*.ts`, `scripts/learning-gt/fixtures/`
