-- 학습샘플: 견적서 ↔ 메일 다중 후보 + 사람 확정
-- status: candidate(후보) | matched(확정) | rejected | unmatched | failed

alter table public.order_mail_learning_matches
  drop constraint if exists order_mail_learning_matches_order_unique;

alter table public.order_mail_learning_matches
  drop constraint if exists order_mail_learning_matches_status_check;

alter table public.order_mail_learning_matches
  add constraint order_mail_learning_matches_status_check
  check (status in ('candidate', 'matched', 'rejected', 'unmatched', 'failed'));

-- 동일 견적+메일 후보 중복 방지
create unique index if not exists order_mail_learning_matches_order_mail_uidx
  on public.order_mail_learning_matches (order_id, mail_message_id)
  where mail_message_id is not null;

-- 견적당 확정(matched) 1건
create unique index if not exists order_mail_learning_matches_order_matched_uidx
  on public.order_mail_learning_matches (order_id)
  where status = 'matched';

-- 견적당 unmatched/failed 센티널(메일 없음) 1건
create unique index if not exists order_mail_learning_matches_order_empty_uidx
  on public.order_mail_learning_matches (order_id)
  where mail_message_id is null and status in ('unmatched', 'failed');

-- 한 메일은 확정 매칭 1견적만
drop index if exists order_mail_learning_matches_mail_matched_uidx;
create unique index order_mail_learning_matches_mail_matched_uidx
  on public.order_mail_learning_matches (mail_message_id)
  where status = 'matched' and mail_message_id is not null;

comment on table public.order_mail_learning_matches is
  '학습샘플: 견적서→메일 후보(N) + 사람 확정(matched 1). 라벨 1-1. 견적서 · Ref 키 매칭.';
