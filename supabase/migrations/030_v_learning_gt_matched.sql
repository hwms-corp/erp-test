-- 학습 GT: matched 견적↔메일 조인 뷰 (mail-ai-api pull용)
-- 첨부 바이너리 없음. gold 품목은 order_items 별도 조인.

create or replace view public.v_learning_gt_matched as
select
  m.id as match_id,
  m.order_id,
  m.mail_message_id,
  m.score as match_score,
  m.match_reasons,
  m.evidence,
  m.engine_version,
  m.matched_at,
  o.doc_no,
  o.order_date,
  o.partner_id,
  o.contact_person,
  o.vessel,
  o.created_at as order_created_at,
  p.name as partner_name,
  p.email as partner_email,
  mm.subject as mail_subject,
  mm.from_addr as mail_from,
  mm.to_addr as mail_to,
  mm.snippet as mail_snippet,
  mm.received_at as mail_received_at,
  length(coalesce(mm.body_text, '')) as mail_body_len
from public.order_mail_learning_matches m
join public.orders o on o.id = m.order_id and o.deleted_at is null
left join public.partners p on p.id = o.partner_id
join public.mail_messages mm on mm.id = m.mail_message_id and mm.deleted_at is null
where m.status = 'matched'
  and m.mail_message_id is not null;

comment on view public.v_learning_gt_matched is
  '학습 GT: status=matched 만. mail-ai-api 스냅샷/eval pull용. 품목은 order_items 조인.';

grant select on public.v_learning_gt_matched to authenticated;
grant select on public.v_learning_gt_matched to service_role;
