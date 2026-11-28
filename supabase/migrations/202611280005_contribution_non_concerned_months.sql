-- Persist treasurer-approved months that are not due for a member.
-- Original due amounts and payment records remain untouched; summaries exclude
-- these rows through the flag rather than rewriting financial values.

alter table public.contribution_dues
  add column if not exists is_not_concerned boolean not null default false,
  add column if not exists not_concerned_reason text,
  add column if not exists not_concerned_by uuid,
  add column if not exists not_concerned_at timestamptz;

alter table public.contribution_dues
  add constraint contribution_dues_non_concerned_metadata_check
  check (
    (not is_not_concerned and not_concerned_reason is null and not_concerned_by is null and not_concerned_at is null)
    or (not_concerned_reason is not null and length(trim(not_concerned_reason)) between 3 and 500
      and not_concerned_by is not null and not_concerned_at is not null)
  );

create or replace function public.guard_contribution_due_concern_status()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare paid_amount bigint;
begin
  if new.is_not_concerned is distinct from old.is_not_concerned then
    if not public.is_finance_staff() or auth.uid() is null then
      raise exception 'Cette décision est réservée au personnel financier autorisé.' using errcode = '42501';
    end if;
    if length(trim(coalesce(new.not_concerned_reason, ''))) not between 3 and 500 then
      raise exception 'Indiquez un motif de 3 à 500 caractères.' using errcode = '22023';
    end if;
    if new.is_not_concerned then
      select coalesce(sum(a.amount_inr), 0)::bigint into paid_amount
      from public.contribution_allocations a where a.due_id = old.id;
      if paid_amount > 0 then
        raise exception 'Un mois déjà payé, même partiellement, ne peut pas devenir non concerné.' using errcode = '23514';
      end if;
    end if;
    new.not_concerned_by := auth.uid();
    new.not_concerned_at := now();
  elsif new.not_concerned_reason is distinct from old.not_concerned_reason
     or new.not_concerned_by is distinct from old.not_concerned_by
     or new.not_concerned_at is distinct from old.not_concerned_at then
    raise exception 'Le motif et les métadonnées ne peuvent changer qu’avec le statut du mois.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists contribution_dues_concern_status_guard on public.contribution_dues;
create trigger contribution_dues_concern_status_guard
before update on public.contribution_dues
for each row execute function public.guard_contribution_due_concern_status();

create or replace function public.set_contribution_due_not_concerned(
  p_due_id uuid,
  p_is_not_concerned boolean,
  p_reason text
)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare due_row public.contribution_dues%rowtype;
begin
  if not public.is_finance_staff() then
    raise exception 'Accès réservé au personnel financier.' using errcode = '42501';
  end if;
  if p_due_id is null or p_is_not_concerned is null
     or length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Le mois, le statut ou le motif est invalide.' using errcode = '22023';
  end if;
  select * into due_row from public.contribution_dues
  where id = p_due_id and currency_code = 'INR'
  for update;
  if not found then raise exception 'L’échéance INR est introuvable.' using errcode = 'P0002'; end if;
  if due_row.is_not_concerned = p_is_not_concerned then
    raise exception 'Le mois possède déjà ce statut.' using errcode = '22023';
  end if;
  update public.contribution_dues
  set is_not_concerned = p_is_not_concerned,
      not_concerned_reason = trim(p_reason)
  where id = p_due_id;
  return p_is_not_concerned;
end;
$$;
revoke all on function public.set_contribution_due_not_concerned(uuid, boolean, text) from public;
grant execute on function public.set_contribution_due_not_concerned(uuid, boolean, text) to authenticated;

-- Keep the existing trigger and audit trail; reject payment allocations against
-- any month marked not due.
create or replace function public.validate_contribution_allocation()
returns trigger language plpgsql set search_path = public
as $$
declare
  payment_row public.contribution_payments%rowtype;
  due_row public.contribution_dues%rowtype;
  allocated_payment bigint;
  allocated_due bigint;
  new_amount bigint;
begin
  select * into payment_row from public.contribution_payments where id = new.payment_id for update;
  select * into due_row from public.contribution_dues where id = new.due_id for update;
  if not found or payment_row.member_id <> new.member_id or due_row.member_id <> new.member_id
     or payment_row.currency_code <> due_row.currency_code then
    raise exception 'Le paiement, l’échéance et le membre doivent correspondre.' using errcode = '23514';
  end if;
  if due_row.is_not_concerned then
    raise exception 'Aucun paiement ne peut être affecté à un mois non concerné.' using errcode = '23514';
  end if;

  if payment_row.currency_code = 'INR' then
    new_amount := new.amount_inr;
    if new.amount_fcfa is not null or new_amount is null then
      raise exception 'Une affectation INR doit être enregistrée exclusivement en roupies.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
      select coalesce(sum(amount_inr), 0) into allocated_payment from public.contribution_allocations
        where payment_id = new.payment_id and not (payment_id = old.payment_id and due_id = old.due_id);
      select coalesce(sum(amount_inr), 0) into allocated_due from public.contribution_allocations
        where due_id = new.due_id and not (payment_id = old.payment_id and due_id = old.due_id);
    else
      select coalesce(sum(amount_inr), 0) into allocated_payment from public.contribution_allocations where payment_id = new.payment_id;
      select coalesce(sum(amount_inr), 0) into allocated_due from public.contribution_allocations where due_id = new.due_id;
    end if;
    if allocated_payment + new_amount > payment_row.amount_inr then
      raise exception 'Le total affecté dépasse le montant reçu.' using errcode = '23514';
    end if;
    if allocated_due + new_amount > due_row.amount_due_inr then
      raise exception 'Le total affecté dépasse le solde de ce mois.' using errcode = '23514';
    end if;
  else
    new_amount := new.amount_fcfa;
    if new.amount_inr is not null or new_amount is null then
      raise exception 'Une affectation ancienne doit garder la devise de ses écritures.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
      select coalesce(sum(amount_fcfa), 0) into allocated_payment from public.contribution_allocations
        where payment_id = new.payment_id and not (payment_id = old.payment_id and due_id = old.due_id);
      select coalesce(sum(amount_fcfa), 0) into allocated_due from public.contribution_allocations
        where due_id = new.due_id and not (payment_id = old.payment_id and due_id = old.due_id);
    else
      select coalesce(sum(amount_fcfa), 0) into allocated_payment from public.contribution_allocations where payment_id = new.payment_id;
      select coalesce(sum(amount_fcfa), 0) into allocated_due from public.contribution_allocations where due_id = new.due_id;
    end if;
    if allocated_payment + new_amount > payment_row.amount_fcfa then
      raise exception 'Le total affecté dépasse le montant reçu.' using errcode = '23514';
    end if;
    if allocated_due + new_amount > due_row.amount_due_fcfa then
      raise exception 'Le total affecté dépasse le solde de cette échéance.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

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
      coalesce(sum(a.amount_inr), 0)::bigint as paid_inr
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
      d.is_not_concerned, coalesce(sum(a.amount_inr), 0)::bigint as paid_inr
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
      d.is_not_concerned, coalesce(sum(a.amount_inr), 0)::bigint as paid_inr
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

create or replace function public.get_finance_overdue_summary_inr(p_as_of date default current_date)
returns table(members_overdue bigint, overdue_periods bigint, overdue_amount_inr bigint)
language sql stable set search_path = public
as $$
  with due_scope as (
    select d.id, d.member_id, d.due_on, d.amount_due_inr from public.contribution_dues d
    where d.currency_code = 'INR' and not d.is_not_concerned and d.due_on <= p_as_of
  ), paid_by_due as (
    select a.due_id, sum(a.amount_inr)::bigint as paid_inr
    from public.contribution_allocations a join due_scope d on d.id = a.due_id group by a.due_id
  ), overdue as (
    select d.member_id, d.id, d.amount_due_inr - coalesce(p.paid_inr, 0) as remaining_inr
    from due_scope d left join paid_by_due p on p.due_id = d.id
    where d.amount_due_inr > coalesce(p.paid_inr, 0)
  )
  select count(distinct member_id)::bigint, count(*)::bigint, coalesce(sum(remaining_inr), 0)::bigint
  from overdue where public.is_finance_staff();
$$;

create or replace function public.get_finance_overdue_export_inr(p_as_of date default current_date)
returns table(member_number text, first_name text, last_name text, overdue_periods bigint, oldest_due_on date, overdue_amount_inr bigint)
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
  with due_scope as (
    select d.id, d.member_id, d.due_on, d.amount_due_inr from public.contribution_dues d
    where d.currency_code = 'INR' and not d.is_not_concerned and d.due_on <= p_as_of
  ), paid_by_due as (
    select a.due_id, sum(a.amount_inr)::bigint as paid_inr
    from public.contribution_allocations a join due_scope d on d.id = a.due_id group by a.due_id
  ), overdue as (
    select d.member_id, d.due_on, d.amount_due_inr - coalesce(p.paid_inr, 0) as remaining_inr
    from due_scope d left join paid_by_due p on p.due_id = d.id
    where d.amount_due_inr > coalesce(p.paid_inr, 0)
  ), by_member as (
    select member_id, count(*)::bigint as period_count, min(due_on) as oldest_due,
      sum(remaining_inr)::bigint as remaining_inr from overdue group by member_id
  )
  select m.member_number, m.first_name, m.last_name, o.period_count, o.oldest_due, o.remaining_inr
  from by_member o join public.members m on m.id = o.member_id
  where public.is_finance_staff()
  order by o.oldest_due, m.last_name, m.first_name, m.member_number;
$$;
