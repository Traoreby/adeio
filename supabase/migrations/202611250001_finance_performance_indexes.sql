-- Missing indexes for the high-volume finance dashboard and filtered lists.
create index if not exists financial_transactions_published_period_idx
  on public.financial_transactions(occurred_on desc, direction, category_id)
  where is_published;

create index if not exists contribution_dues_member_plan_due_idx
  on public.contribution_dues(member_id, plan_id, due_on desc);

-- Arrears aggregation filters dues by date and joins their allocations by due.
create index if not exists contribution_dues_due_on_idx
  on public.contribution_dues(due_on);
create index if not exists contribution_allocations_due_member_idx
  on public.contribution_allocations(due_id, member_id);

-- Existing indexes verified in 202611230001_initial_schema.sql:
-- contribution_payments(member_id, paid_on desc),
-- contribution_dues(member_id, due_on),
-- audit_log(created_at desc), and financial_transactions(occurred_on, direction, category_id).

create or replace function public.get_finance_overdue_page(
  p_as_of date default current_date,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  member_id uuid,
  member_number text,
  first_name text,
  last_name text,
  overdue_periods bigint,
  oldest_due_on date,
  overdue_amount_fcfa bigint,
  total_count bigint
)
language sql stable set search_path = public
as $$
  with due_scope as (
    select d.id, d.member_id, d.due_on, d.amount_due_fcfa
    from public.contribution_dues d
    where d.due_on <= p_as_of
  ), paid_by_due as (
    select a.due_id, sum(a.amount_fcfa)::bigint as paid_fcfa
    from public.contribution_allocations a
    join due_scope d on d.id = a.due_id
    group by a.due_id
  ), overdue_dues as (
    select d.member_id, d.due_on,
      (d.amount_due_fcfa - coalesce(p.paid_fcfa, 0))::bigint as remaining_fcfa
    from due_scope d
    left join paid_by_due p on p.due_id = d.id
    where d.amount_due_fcfa > coalesce(p.paid_fcfa, 0)
  ), overdue_members as (
    select d.member_id, count(*)::bigint as overdue_periods,
      min(d.due_on) as oldest_due_on, sum(d.remaining_fcfa)::bigint as overdue_amount_fcfa
    from overdue_dues d
    group by d.member_id
  )
  select m.id, m.member_number, m.first_name, m.last_name,
    o.overdue_periods, o.oldest_due_on, o.overdue_amount_fcfa,
    count(*) over() as total_count
  from overdue_members o
  join public.members m on m.id = o.member_id
  where public.is_finance_staff()
  order by o.oldest_due_on, m.last_name, m.first_name, m.member_number
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.get_finance_overdue_page(date, integer, integer) from public;
grant execute on function public.get_finance_overdue_page(date, integer, integer) to authenticated;

create or replace function public.get_finance_overdue_export(p_as_of date default current_date)
returns table(
  member_number text,
  first_name text,
  last_name text,
  overdue_periods bigint,
  oldest_due_on date,
  overdue_amount_fcfa bigint
)
language sql stable set search_path = public
as $$
  with due_scope as (
    select d.id, d.member_id, d.due_on, d.amount_due_fcfa
    from public.contribution_dues d
    where d.due_on <= p_as_of
  ), paid_by_due as (
    select a.due_id, sum(a.amount_fcfa)::bigint as paid_fcfa
    from public.contribution_allocations a
    join due_scope d on d.id = a.due_id
    group by a.due_id
  ), overdue_dues as (
    select d.member_id, d.due_on,
      (d.amount_due_fcfa - coalesce(p.paid_fcfa, 0))::bigint as remaining_fcfa
    from due_scope d
    left join paid_by_due p on p.due_id = d.id
    where d.amount_due_fcfa > coalesce(p.paid_fcfa, 0)
  ), overdue_members as (
    select d.member_id, count(*)::bigint as overdue_periods,
      min(d.due_on) as oldest_due_on, sum(d.remaining_fcfa)::bigint as overdue_amount_fcfa
    from overdue_dues d
    group by d.member_id
  )
  select m.member_number, m.first_name, m.last_name,
    o.overdue_periods, o.oldest_due_on, o.overdue_amount_fcfa
  from overdue_members o
  join public.members m on m.id = o.member_id
  where public.is_finance_staff()
  order by o.oldest_due_on, m.last_name, m.first_name, m.member_number;
$$;
revoke all on function public.get_finance_overdue_export(date) from public;
grant execute on function public.get_finance_overdue_export(date) to authenticated;
