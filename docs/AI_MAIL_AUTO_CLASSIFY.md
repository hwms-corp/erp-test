# AI 메일 자동분류 — 개발 가이드

## 구성

| 경로 | 역할 |
|------|------|
| `src/types/aiMail.ts` | Canonical Schema + 메일 타입 |
| `src/lib/aiDocClient.ts` | AI SaaS API 클라이언트 |
| `src/lib/mailMatching.ts` | 거래처 매칭 / draft 변환 / Confidence 정책 |
| `src/hooks/useMail.ts` | 메일 CRUD + AI 파이프라인 + 견적 등록 |
| `src/views/MailInboxView.tsx` | ERP 메일함 |
| `src/views/MailReviewView.tsx` | 원문 vs 추출 검토 + draft 등록 |
| `scripts/ai-poc/` | Ground Truth 50건 + KPI 평가 |
| `../mail-ai-api/` (별도 저장소) | Document Intelligence API — https://github.com/kby920909/mail-ai-api |
| `supabase/migrations/017_ai_mail.sql` | 메일함 테이블 |
| `supabase/functions/gmail-watch/` | Gmail Pub/Sub push 수신 |

> AI API는 ERP와 분리되어 있습니다. 로컬 경로 예: `D:\Cursor\mail-ai-api`

## 로컬 실행

1. Supabase에 `017_ai_mail.sql` 실행
2. AI API `.env` (`mail-ai-api/.env`):
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
PORT=4040
AI_DOC_DEMO_API_KEY=aidoc_demo_haewon_dev_key_change_me
```
3. AI API:
```bash
cd D:\Cursor\mail-ai-api && npm install && npm run dev
```
   - 기동 로그에 `OpenAI: enabled` 가 보이면 ChatGPT 연동 성공
4. ERP `.env`에 추가:
```
VITE_AI_DOC_API_URL=http://localhost:4040
VITE_AI_DOC_API_KEY=aidoc_demo_haewon_dev_key_change_me
```
5. ERP `npm run dev` 후 사이드바 **AI 메일함**
## PoC KPI

```bash
npm run ai:poc:generate
npm run ai:poc:eval
```

결과: `scripts/ai-poc/results/summary.json`

## Gmail 실시간 (Workspace)

### 준비물 (GCP에서 이미 완료했어야 함)
- `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`
- Topic: `projects/<PROJECT_ID>/topics/gmail-push`
- Topic IAM: `gmail-api-push@system.gserviceaccount.com` = Pub/Sub Publisher

### DB
Supabase SQL Editor에서 `supabase/migrations/018_gmail_sync_state.sql` 실행

### Secrets + 배포
```bash
npx.cmd supabase login
npx.cmd supabase link --project-ref <SUPABASE_PROJECT_REF>
npx.cmd supabase secrets set ^
  GMAIL_CLIENT_ID=... ^
  GMAIL_CLIENT_SECRET=... ^
  GMAIL_REFRESH_TOKEN=... ^
  GMAIL_TOPIC_NAME=projects/<PROJECT_ID>/topics/gmail-push ^
  GMAIL_USER=me ^
  AI_DOC_API_URL=https://xxxx.ngrok-free.app ^
  AI_DOC_API_KEY=aidoc_demo_haewon_dev_key_change_me
npx.cmd supabase functions deploy gmail-watch --no-verify-jwt
```

- `AI_DOC_API_URL` 은 **공인 URL**이어야 함 (`localhost` 불가). 로컬 테스트 시 ngrok 등 사용.
- Pub/Sub 구독 **확인 기한**을 120초 이상으로 설정 (AI 호출 시간 확보).

함수 URL:
`https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-watch`

헬스 체크 시 `ai_configured: true` 이면 AI secrets 연결됨.
### Pub/Sub Push 구독
1. Pub/Sub → 구독 만들기
2. 주제: `gmail-push`
3. 전송: Push
4. 엔드포인트: 위 함수 URL
5. 구독 ID 예: `gmail-push-sub`

### Watch 등록 (최초 1회, 이후 자동 갱신)
```bash
curl -X POST "https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-watch?action=watch"
```

자동 갱신:
- 메일 push 처리 시 만료 48시간 이내면 자동 `users.watch` 재등록
- GitHub Actions `.github/workflows/gmail-watch-renew.yml` — 매일 03:00 UTC에 `?action=renew` 호출
- 수동: `?action=renew` 또는 `?action=renew-if-needed`

### 테스트
1. 수신 메일함으로 테스트 메일 발송
2. Supabase → Edge Functions → gmail-watch 로그 확인
3. ERP **AI 메일함**에 메일 표시 확인
4. (지금은) 수동 AI 재실행 → 검토 → 견적 등록
   - AI secrets + 공인 `AI_DOC_API_URL` 있으면 수신 시 자동 분류/추출

## mail-ai-api 서버 배포 (Vercel ERP용)

ERP를 Vercel에 올리면 `localhost`/`loca.lt` 는 쓸 수 없습니다. 별도 저장소 `mail-ai-api`를 공인 서버에 배포하세요.  
저장소: https://github.com/kby920909/mail-ai-api · 로컬: `D:\Cursor\mail-ai-api`

### Railway (권장)
1. https://railway.app 가입/로그인
2. **New Project → Deploy from GitHub** → `kby920909/mail-ai-api` 연결
3. Root Directory: 저장소 루트
4. Variables에 설정:
   ```
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   AI_DOC_DEMO_API_KEY=kbymailsystemapi-0001
   PORT=4040
   HOST=0.0.0.0
   ```
5. 배포 후 Public URL 발급 (예: `https://mail-ai-api-xxxx.up.railway.app`)
6. 헬스: `https://.../health` → `{ ok: true }`

### 배포 후 연결
1. Supabase:
   ```powershell
   npx.cmd supabase secrets set AI_DOC_API_URL="https://당신-railway-주소" AI_DOC_API_KEY="kbymailsystemapi-0001"
   npx.cmd supabase functions deploy gmail-watch --no-verify-jwt
   ```
2. Vercel / ERP 환경변수:
   ```
   VITE_AI_DOC_API_URL=https://당신-railway-주소
   VITE_AI_DOC_API_KEY=kbymailsystemapi-0001
   ```
3. ERP 재배포

### 실서버에서 되는 것 / 안 되는 것
| 기능 | mail-ai-api 서버 없이 | 서버 배포 후 |
|------|---------------------|-------------|
| Gmail → AI 메일함 수신 | O (Edge+Supabase) | O |
| 메일 목록/원문 보기 | O | O |
| 수신 시 자동 분류/추출 | X (`수신`만) | O |
| 첨부 PDF/이미지 OCR | X | O (Vision + PDF file input) |
| 거래처 자동 매칭 (추출 직후) | X | O (`matched_partner_id`) |
| 견적 자동등록 (관리자 스위치) | X | O (기본 OFF, ON 시 draft+검토대기+메일 `견적등록`) |
| AI 재실행 / 추출 | X (브라우저가 API 못 부름) | O |
| 견적 등록·검토 | 추출 있으면 O | O |

## OCR (첨부 PDF/이미지)

수신 메일 본문뿐 아니라 PDF·이미지 첨부를 Gmail에서 받아 AI API로 넘깁니다.

- Edge `gmail-watch`: 첨부 다운로드 → `content_base64`로 classify/extract 요청
- `mail-ai-api`: 이미지는 Vision(`image_url`), PDF는 file modality (실패 시 본문만 폴백)
- 한도: 파일 최대 5개, 개당 약 8MB

배포 시 **Railway(`mail-ai-api`) + `gmail-watch` 둘 다** 갱신해야 OCR이 동작합니다.