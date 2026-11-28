-- Use one effective interpretation for all INR contribution indicators:
-- a not-concerned due contributes neither a claim nor a payment allocation.

create or replace function public.get_contribution_year_summary(
  p_year integer,
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(member_id uuid, member_number text, first_name text, last_name text, sex text,
  initial_claim_inr bigint, total_paid_inr bigint, remaining_inr bigint, treasurer_comment text,
  payment_status text, total_count bigint)
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
  with dues as (
    select d.id, d.member_id, d.due_on,
      case when d.is_not_concerned then 0 else d.amount_due_inr end as amount_due_inr,
      d.is_not_concerned,
      case when d.is_not_concerned then 0 else coalesce(sum(a.amount_inr), 0)::bigint end as paid_inr
    from public.contribution_dues d
    left join public.contribution_allocations a on a.due_id = d.id
    where d.currency_code = 'INR' and d.period_start >= make_date(p_year, 1, 1)
      and d.period_start < make_date(p_year + 1, 1, 1)
    group by d.id, d.member_id, d.due_on, d.amount_due_inr, d.is_not_concerned
  ), summary as (
    select d.member_id, sum(d.amount_due_inr)::bigint as claim_inr,
      sum(d.paid_inr)::bigint as paid_inr,
      greatest(0, sum(d.amount_due_inr) - sum(d.paid_inr))::bigint as remaining_inr,
      bool_or(not d.is_not_concerned and d.due_on <= (now() at time zone 'Asia/Kolkata')::date
        and d.amount_due_inr > d.paid_inr) as overdue
    from dues d group by d.member_id
  ), latest_notes as (
    select distinct on (p.member_id) p.member_id, p.note
    from public.contribution_payments p
    join public.contribution_allocations a on a.payment_id = p.id
    join public.contribution_dues d on d.id = a.due_id and d.currency_code = 'INR' and not d.is_not_concerned
    where p.currency_code = 'INR'
      and d.period_start >= make_date(p_year, 1, 1) and d.period_start < make_date(p_year + 1, 1, 1)
      and nullif(trim(p.note), '') is not null
    order by p.member_id, p.paid_on desc, p.created_at desc
  ), rows as (
    select m.id as member_id, m.member_number, m.first_name, m.last_name, details.sex,
      s.claim_inr, s.paid_inr, s.remaining_inr, latest_notes.note as comment,
      case when s.remaining_inr = 0 then 'up_to_date'
        when s.overdue then 'overdue' when s.paid_inr > 0 then 'partial' else 'up_to_date' end as payment_status
    from summary s join public.members m on m.id = s.member_id
    left join public.member_private_details details on details.member_id = m.id
    left join latest_notes on latest_notes.member_id = m.id
    where public.is_finance_staff()
      and (coalesce(trim(p_search), '') = '' or concat_ws(' ', m.first_name, m.last_name, m.member_number) ilike '%' || trim(p_search) || '%')
  )
  select rows.member_id, rows.member_number, rows.first_name, rows.last_name, rows.sex,
    rows.claim_inr, rows.paid_inr, rows.remaining_inr, rows.comment, rows.payment_status, count(*) over()::bigint
  from rows where p_status is null or p_status = '' or rows.payment_status = p_status
  order by rows.last_name, rows.first_name, rows.member_number
  limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_contribution_year_totals(p_year integer)
returns table(total_claim_inr bigint, total_paid_inr bigint, total_overdue_inr bigint,
  up_to_date_members bigint, members_with_balance bigint)
language sql stable set search_path = public
as $$
  with dues as (
    select d.id, d.member_id, d.due_on,
      case when d.is_not_concerned then 0 else d.amount_due_inr end as amount_due_inr,
      d.is_not_concerned,
      case when d.is_not_concerned then 0 else coalesce(sum(a.amount_inr), 0)::bigint end as paid_inr
    from public.contribution_dues d
    left join public.contribution_allocations a on a.due_id = d.id
    where d.currency_code = 'INR' and d.period_start >= make_date(p_year, 1, 1)
      and d.period_start < make_date(p_year + 1, 1, 1)
    group by d.id, d.member_id, d.due_on, d.amount_due_inr, d.is_not_concerned
  ), member_totals as (
    select member_id, sum(amount_due_inr)::bigint as claim_inr, sum(paid_inr)::bigint as paid_inr,
      sum(greatest(0, amount_due_inr - paid_inr))::bigint as remaining_inr,
      coalesce(sum(greatest(0, amount_due_inr - paid_inr)) filter
        (where not is_not_concerned and due_on <= (now() at time zone 'Asia/Kolkata')::date), 0)::bigint as overdue_inr
    from dues group by member_id
  )
  select coalesce(sum(claim_inr), 0)::bigint, coalesce(sum(paid_inr), 0)::bigint,
    coalesce(sum(overdue_inr), 0)::bigint,
    count(*) filter (where overdue_inr = 0)::bigint,
    count(*) filter (where remaining_inr > 0)::bigint
  from member_totals where public.is_finance_staff();
$$;

create or replace function public.get_contribution_month_breakdown(p_member_id uuid, p_year integer)
returns table(due_id uuid, month_number integer, month_due_inr bigint, month_paid_inr bigint,
  month_remaining_inr bigint, payment_status text)
language sql stable set search_path = public
as $$
  with months as (select generate_series(1, 12)::integer as month_number), monthly as (
    select d.id, extract(month from d.period_start)::integer as month_number,
      case when d.is_not_concerned then 0 else d.amount_due_inr end::bigint as due_inr,
      d.is_not_concerned,
      case when d.is_not_concerned then 0 else coalesce(sum(a.amount_inr), 0)::bigint end as paid_inr
    from public.contribution_dues d
    left join public.contribution_allocations a on a.due_id = d.id
    where d.member_id = p_member_id and d.currency_code = 'INR'
      and d.period_start >= make_date(p_year, 1, 1) and d.period_start < make_date(p_year + 1, 1, 1)
    group by d.id, d.period_start, d.amount_due_inr, d.is_not_concerned
  )
  select monthly.id, months.month_number, coalesce(monthly.due_inr, 0)::bigint,
    coalesce(monthly.paid_inr, 0)::bigint,
    greatest(0, coalesce(monthly.due_inr, 0) - coalesce(monthly.paid_inr, 0))::bigint,
    case when monthly.id is null then 'not_generated'
      when monthly.is_not_concerned then 'not_concerned'
      when monthly.paid_inr >= monthly.due_inr then 'paid'
      when monthly.paid_inr > 0 then 'partial' else 'unpaid' end
  from months left join monthly using (month_number)
  where public.is_finance_staff()
  order by months.month_number;
$$;

-- A dedicated aggregate for month counts avoids changing the established
-- return shape and grants of get_contribution_year_totals.
create or replace function public.get_contribution_month_status_totals(p_year integer)
returns table(unpaid_months bigint, partially_paid_months bigint)
language sql stable set search_path = public
as $$
  with per_due as (
    select d.id, d.is_not_concerned, d.amount_due_inr,
      case when d.is_not_concerned then 0 else coalesce(sum(a.amount_inr), 0)::bigint end as paid_inr
    from public.contribution_dues d
    left join public.contribution_allocations a on a.due_id = d.id
    where d.currency_code = 'INR' and d.period_start >= make_date(p_year, 1, 1)
      and d.period_start < make_date(p_year + 1, 1, 1)
    group by d.id, d.is_not_concerned, d.amount_due_inr
  )
  select count(*) filter (where not is_not_concerned and paid_inr = 0 and amount_due_inr > 0)::bigint,
    count(*) filter (where not is_not_concerned and paid_inr > 0 and paid_inr < amount_due_inr)::bigint
  from per_due where public.is_finance_staff();
$$;

revoke all on function public.get_contribution_month_status_totals(integer) from public;
grant execute on function public.get_contribution_month_status_totals(integer) to authenticated;
