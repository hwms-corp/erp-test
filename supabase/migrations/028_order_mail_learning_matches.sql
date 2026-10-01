-- 학습샘플: 견적서 → 메일 1:1 매칭 결과 저장
-- + 분류 API와 분리된 매칭 엔진(API) 설정 컬럼

create table if not exists public.order_mail_learning_matches (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders (id) on delete cascade,
  mail_message_id bigint null references public.mail_messages (id) on delete set null,
  status text not null check (status in ('matched', 'unmatched', 'failed')),
  score numeric(6, 5) null,
  match_reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  engine_version text null,
  error_message text null,
  matched_at timestamptz not null default now(),
  matched_by bigint null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_mail_learning_matches_order_unique unique (order_id)
);

-- 한 메일은 학습샘플에서 하나의 견적에만 매칭 (matched 행만)
create unique index if not exists order_mail_learning_matches_mail_matched_uidx
  on public.order_mail_learning_matches (mail_message_id)
  where status = 'matched' and mail_message_id is not null;

create index if not exists order_mail_learning_matches_status_idx
  on public.order_mail_learning_matches (status);

comment on table public.order_mail_learning_matches is
  '학습샘플: 견적서→메일 1:1 매칭 결과. 메뉴 재진입 시 API 재호출 없이 이 테이블을 사용.';

-- mail_ai_settings 에 견적→메일 매칭 엔진 설정 (분류 API와 분리)
alter table public.mail_ai_settings
  add column if not exists match_api_base_url text,
  add column if not exists match_api_key text;

comment on column public.mail_ai_settings.match_api_base_url is
  '견적서→메일 학습매칭 엔진 Base URL (분류용 api_base_url 과 분리)';
comment on column public.mail_ai_settings.match_api_key is
  '견적서→메일 학습매칭 엔진 API Key';

alter table public.order_mail_learning_matches enable row level security;

drop policy if exists order_mail_learning_matches_select on public.order_mail_learning_matches;
create policy order_mail_learning_matches_select
  on public.order_mail_learning_matches for select
  to authenticated
  using (true);

drop policy if exists order_mail_learning_matches_insert on public.order_mail_learning_matches;
create policy order_mail_learning_matches_insert
  on public.order_mail_learning_matches for insert
  to authenticated
  with check (true);

drop policy if exists order_mail_learning_matches_update on public.order_mail_learning_matches;
create policy order_mail_learning_matches_update
  on public.order_mail_learning_matches for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists order_mail_learning_matches_delete on public.order_mail_learning_matches;
create policy order_mail_learning_matches_delete
  on public.order_mail_learning_matches for delete
  to authenticated
  using (true);
