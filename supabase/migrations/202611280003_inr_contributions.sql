-- Cotisations INR avec conservation intégrale des lignes XOF existantes.
-- Aucun montant historique n'est converti ou réécrit par cette migration.

alter type public.payment_method add value if not exists 'online';

alter table public.financial_transactions alter column amount_fcfa drop not null;
alter table public.financial_transactions add column if not exists amount_inr bigint;
alter table public.financial_transactions add column if not exists currency_code text not null default 'XOF';
alter table public.financial_transactions add constraint financial_transactions_currency_amount_check
  check (
    (currency_code = 'XOF' and amount_fcfa is not null and amount_fcfa > 0 and amount_inr is null)
    or (currency_code = 'INR' and amount_inr is not null and amount_inr > 0 and amount_fcfa is null)
  );

alter table public.contribution_plans alter column amount_fcfa drop not null;
alter table public.contribution_plans add column if not exists amount_inr bigint;
alter table public.contribution_plans add column if not exists currency_code text not null default 'XOF';
alter table public.contribution_plans add constraint contribution_plans_currency_amount_check
  check (
    (currency_code = 'XOF' and amount_fcfa is not null and amount_fcfa > 0 and amount_inr is null)
    or (currency_code = 'INR' and amount_inr is not null and amount_inr > 0 and amount_fcfa is null)
  );

alter table public.contribution_dues alter column amount_due_fcfa drop not null;
alter table public.contribution_dues add column if not exists amount_due_inr bigint;
alter table public.contribution_dues add column if not exists currency_code text not null default 'XOF';
alter table public.contribution_dues add constraint contribution_dues_currency_amount_check
  check (
    (currency_code = 'XOF' and amount_due_fcfa is not null and amount_due_fcfa > 0 and amount_due_inr is null)
    or (currency_code = 'INR' and amount_due_inr is not null and amount_due_inr > 0 and amount_due_fcfa is null)
  );

alter table public.contribution_payments alter column amount_fcfa drop not null;
alter table public.contribution_payments add column if not exists amount_inr bigint;
alter table public.contribution_payments add column if not exists currency_code text not null default 'XOF';
alter table public.contribution_payments add column if not exists reference text;
alter table public.contribution_payments add column if not exists recorded_by_label text;
alter table public.contribution_payments alter column reference set default ('ADEIO-XOF-' || upper(substr(extensions.gen_random_uuid()::text, 1, 12)));
update public.contribution_payments set reference = 'ADEIO-XOF-' || upper(substr(id::text, 1, 12)) where reference is null;
alter table public.contribution_payments alter column reference set not null;
alter table public.contribution_payments add constraint contribution_payments_reference_unique unique (reference);
alter table public.contribution_payments add constraint contribution_payments_currency_amount_check
  check (
    (currency_code = 'XOF' and amount_fcfa is not null and amount_fcfa > 0 and amount_inr is null)
    or (currency_code = 'INR' and amount_inr is not null and amount_inr > 0 and amount_fcfa is null)
  );

alter table public.contribution_allocations alter column amount_fcfa drop not null;
alter table public.contribution_allocations add column if not exists amount_inr bigint;
alter table public.contribution_allocations add constraint contribution_allocations_currency_amount_check
  check (
    (amount_fcfa is not null and amount_fcfa > 0 and amount_inr is null)
    or (amount_inr is not null and amount_inr > 0 and amount_fcfa is null)
  );

alter table public.financial_reports add column if not exists total_income_inr bigint;
alter table public.financial_reports add column if not exists total_expense_inr bigint;
alter table public.financial_reports add column if not exists net_balance_inr bigint;

create unique index if not exists contribution_dues_inr_member_month_idx
  on public.contribution_dues(member_id, period_start) where currency_code = 'INR';
create index if not exists contribution_dues_inr_year_idx
  on public.contribution_dues(currency_code, period_start, member_id);
create index if not exists financial_transactions_currency_period_idx
  on public.financial_transactions(currency_code, occurred_on desc) where is_published;
create index if not exists contribution_payments_inr_date_idx
  on public.contribution_payments(paid_on desc, member_id) where currency_code = 'INR';

create or replace function public.get_financial_summary(p_from date default null, p_to date default null)
returns table(total_income_fcfa bigint, total_expense_fcfa bigint, net_balance_fcfa bigint, transaction_count bigint)
language sql stable set search_path = public
as $$
  select coalesce(sum(amount_fcfa) filter (where direction = 'income'), 0)::bigint,
    coalesce(sum(amount_fcfa) filter (where direction = 'expense'), 0)::bigint,
    (coalesce(sum(amount_fcfa) filter (where direction = 'income'), 0)
      - coalesce(sum(amount_fcfa) filter (where direction = 'expense'), 0))::bigint,
    count(*)::bigint
  from public.financial_transactions
  where is_published and currency_code = 'XOF'
    and (p_from is null or occurred_on >= p_from)
    and (p_to is null or occurred_on <= p_to);
$$;

create or replace function public.validate_contribution_payment()
returns trigger language plpgsql set search_path = public
as $$
declare linked_transaction public.financial_transactions%rowtype;
begin
  select * into linked_transaction from public.financial_transactions where id = new.financial_transaction_id;
  if not found or linked_transaction.direction <> 'income'
     or linked_transaction.currency_code <> new.currency_code
     or linked_transaction.payment_method <> new.payment_method
     or (new.currency_code = 'XOF' and linked_transaction.amount_fcfa is distinct from new.amount_fcfa)
     or (new.currency_code = 'INR' and linked_transaction.amount_inr is distinct from new.amount_inr) then
    raise exception 'Le reçu doit correspondre à une recette publiée dans la même devise, du même montant et du même moyen de paiement.' using errcode = '23514';
  end if;
  return new;
end;
$$;

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
      raise exception 'Une affectation XOF doit être enregistrée exclusivement en FCFA.' using errcode = '23514';
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

create or replace function public.get_financial_summary_by_currency(p_from date default null, p_to date default null)
returns table(currency_code text, total_income bigint, total_expense bigint, net_balance bigint, transaction_count bigint)
language sql stable set search_path = public
as $$
  select currencies.currency_code,
    coalesce(sum(t.amount_fcfa) filter (where t.direction = 'income' and t.currency_code = 'XOF'), 0)::bigint
      + coalesce(sum(t.amount_inr) filter (where t.direction = 'income' and t.currency_code = 'INR'), 0)::bigint as total_income,
    coalesce(sum(t.amount_fcfa) filter (where t.direction = 'expense' and t.currency_code = 'XOF'), 0)::bigint
      + coalesce(sum(t.amount_inr) filter (where t.direction = 'expense' and t.currency_code = 'INR'), 0)::bigint as total_expense,
    (coalesce(sum(t.amount_fcfa) filter (where t.direction = 'income' and t.currency_code = 'XOF'), 0)
      + coalesce(sum(t.amount_inr) filter (where t.direction = 'income' and t.currency_code = 'INR'), 0)
      - coalesce(sum(t.amount_fcfa) filter (where t.direction = 'expense' and t.currency_code = 'XOF'), 0)
      - coalesce(sum(t.amount_inr) filter (where t.direction = 'expense' and t.currency_code = 'INR'), 0))::bigint as net_balance,
    count(t.id)::bigint
  from (values ('XOF'::text), ('INR'::text)) currencies(currency_code)
  left join public.financial_transactions t on t.currency_code = currencies.currency_code and t.is_published
    and (p_from is null or t.occurred_on >= p_from) and (p_to is null or t.occurred_on <= p_to)
  group by currencies.currency_code
  order by currencies.currency_code;
$$;
revoke all on function public.get_financial_summary_by_currency(date, date) from public;
grant execute on function public.get_financial_summary_by_currency(date, date) to authenticated;

create or replace function public.generate_contribution_dues_inr(p_plan_id uuid, p_year integer)
returns integer language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  plan_row public.contribution_plans%rowtype;
  member_row record;
  month_start date;
  due_count integer := 0;
begin
  if not public.is_finance_staff() then raise exception 'Accès réservé au personnel financier.' using errcode = '42501'; end if;
  if p_year not between 1900 and 2200 then raise exception 'Année financière invalide.' using errcode = '22023'; end if;
  select * into plan_row from public.contribution_plans where id = p_plan_id and is_active and currency_code = 'INR' for update;
  if not found then raise exception 'Le plan INR est introuvable ou inactif.' using errcode = 'P0002'; end if;
  if extract(year from plan_row.starts_on)::integer <> p_year or extract(month from plan_row.starts_on)::integer <> 1
     or plan_row.ends_on <> make_date(p_year, 12, 31) or plan_row.periodicity <> 'monthly' then
    raise exception 'Le plan mensuel doit couvrir janvier à décembre de l’année sélectionnée.' using errcode = '22023';
  end if;

  for member_row in
    select id from public.members
    where joined_year <= p_year and exit_year >= p_year
    order by id
  loop
    for month_start in select generate_series(make_date(p_year, 1, 1), make_date(p_year, 12, 1), interval '1 month')::date loop
      insert into public.contribution_dues(member_id, plan_id, period_start, period_end, due_on,
        amount_due_fcfa, amount_due_inr, currency_code, created_by)
      values (member_row.id, plan_row.id, month_start,
        (month_start + interval '1 month - 1 day')::date,
        (month_start + interval '1 month - 1 day')::date,
        null, plan_row.amount_inr, 'INR', auth.uid())
      on conflict do nothing;
      if found then due_count := due_count + 1; end if;
    end loop;
  end loop;
  return due_count;
end;
$$;
revoke all on function public.generate_contribution_dues_inr(uuid, integer) from public;
grant execute on function public.generate_contribution_dues_inr(uuid, integer) to authenticated;

create or replace function public.get_finance_contribution_members(p_year integer, p_member_id uuid default null)
returns table(id uuid, member_number text, first_name text, last_name text)
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
  select m.id, m.member_number, m.first_name, m.last_name
  from public.members m
  where public.is_finance_staff()
    and p_year between 1900 and 2200
    and m.status = 'active'
    and m.joined_year <= p_year and m.exit_year >= p_year
    and (p_member_id is null or m.id = p_member_id)
  order by m.last_name, m.first_name, m.member_number
  limit 500;
$$;
revoke all on function public.get_finance_contribution_members(integer, uuid) from public;
grant execute on function public.get_finance_contribution_members(integer, uuid) to authenticated;

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
    select d.id, d.member_id, d.due_on, d.amount_due_inr,
      coalesce(sum(a.amount_inr), 0)::bigint as paid_inr
    from public.contribution_dues d
    left join public.contribution_allocations a on a.due_id = d.id
    where d.currency_code = 'INR' and d.period_start >= make_date(p_year, 1, 1) and d.period_start < make_date(p_year + 1, 1, 1)
    group by d.id, d.member_id, d.due_on, d.amount_due_inr
  ), summary as (
    select d.member_id, sum(d.amount_due_inr)::bigint as claim_inr,
      sum(d.paid_inr)::bigint as paid_inr,
      greatest(0, sum(d.amount_due_inr) - sum(d.paid_inr))::bigint as remaining_inr,
      bool_or(d.due_on <= (now() at time zone 'Asia/Kolkata')::date and d.amount_due_inr > d.paid_inr) as overdue
    from dues d
    group by d.member_id
  ), latest_notes as (
    select distinct on (p.member_id) p.member_id, p.note
    from public.contribution_payments p
    join public.contribution_allocations a on a.payment_id = p.id
    join public.contribution_dues d on d.id = a.due_id and d.currency_code = 'INR'
    where p.currency_code = 'INR'
      and d.period_start >= make_date(p_year, 1, 1) and d.period_start < make_date(p_year + 1, 1, 1)
      and nullif(trim(p.note), '') is not null
    order by p.member_id, p.paid_on desc, p.created_at desc
  ), rows as (
    select m.id as member_id, m.member_number, m.first_name, m.last_name, details.sex,
      s.claim_inr, s.paid_inr, s.remaining_inr, latest_notes.note as comment,
      case when s.remaining_inr = 0 then 'up_to_date'
        when s.overdue then 'overdue'
        when s.paid_inr > 0 then 'partial'
        else 'up_to_date' end as payment_status
    from summary s
    join public.members m on m.id = s.member_id
    left join public.member_private_details details on details.member_id = m.id
    left join latest_notes on latest_notes.member_id = m.id
    where public.is_finance_staff()
      and (coalesce(trim(p_search), '') = '' or concat_ws(' ', m.first_name, m.last_name, m.member_number) ilike '%' || trim(p_search) || '%')
  )
  select rows.member_id, rows.member_number, rows.first_name, rows.last_name, rows.sex,
    rows.claim_inr, rows.paid_inr, rows.remaining_inr, rows.comment, rows.payment_status,
    count(*) over()::bigint
  from rows
  where p_status is null or p_status = '' or rows.payment_status = p_status
  order by rows.last_name, rows.first_name, rows.member_number
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.get_contribution_year_summary(integer, text, text, integer, integer) from public;
grant execute on function public.get_contribution_year_summary(integer, text, text, integer, integer) to authenticated;

create or replace function public.get_contribution_year_totals(p_year integer)
returns table(total_claim_inr bigint, total_paid_inr bigint, total_overdue_inr bigint,
  up_to_date_members bigint, members_with_balance bigint)
language sql stable set search_path = public
as $$
  with dues as (
    select d.id, d.member_id, d.due_on, d.amount_due_inr, coalesce(sum(a.amount_inr), 0)::bigint as paid_inr
    from public.contribution_dues d
    left join public.contribution_allocations a on a.due_id = d.id
    where d.currency_code = 'INR' and d.period_start >= make_date(p_year, 1, 1) and d.period_start < make_date(p_year + 1, 1, 1)
    group by d.id, d.member_id, d.due_on, d.amount_due_inr
  ), member_totals as (
    select member_id, sum(amount_due_inr)::bigint as claim_inr, sum(paid_inr)::bigint as paid_inr,
      sum(greatest(0, amount_due_inr - paid_inr))::bigint as remaining_inr,
      coalesce(sum(greatest(0, amount_due_inr - paid_inr)) filter (where due_on <= (now() at time zone 'Asia/Kolkata')::date), 0)::bigint as overdue_inr
    from dues group by member_id
  )
  select coalesce(sum(claim_inr), 0)::bigint, coalesce(sum(paid_inr), 0)::bigint,
    coalesce(sum(overdue_inr), 0)::bigint,
    count(*) filter (where overdue_inr = 0)::bigint,
    count(*) filter (where remaining_inr > 0)::bigint
  from member_totals where public.is_finance_staff();
$$;
revoke all on function public.get_contribution_year_totals(integer) from public;
grant execute on function public.get_contribution_year_totals(integer) to authenticated;

create or replace function public.get_contribution_month_breakdown(p_member_id uuid, p_year integer)
returns table(due_id uuid, month_number integer, month_due_inr bigint, month_paid_inr bigint,
  month_remaining_inr bigint, payment_status text)
language sql stable set search_path = public
as $$
  with months as (
    select generate_series(1, 12)::integer as month_number
  ), monthly as (
    select d.id, extract(month from d.period_start)::integer as month_number,
      d.amount_due_inr::bigint as due_inr, coalesce(sum(a.amount_inr), 0)::bigint as paid_inr
    from public.contribution_dues d
    left join public.contribution_allocations a on a.due_id = d.id
    where d.member_id = p_member_id and d.currency_code = 'INR'
      and d.period_start >= make_date(p_year, 1, 1) and d.period_start < make_date(p_year + 1, 1, 1)
    group by d.id, d.period_start, d.amount_due_inr
  )
  select monthly.id, months.month_number,
    coalesce(monthly.due_inr, 0)::bigint, coalesce(monthly.paid_inr, 0)::bigint,
    greatest(0, coalesce(monthly.due_inr, 0) - coalesce(monthly.paid_inr, 0))::bigint,
    case when monthly.id is null then 'not_generated'
      when monthly.paid_inr >= monthly.due_inr then 'paid'
      when monthly.paid_inr > 0 then 'partial'
      else 'unpaid' end
  from months
  left join monthly using (month_number)
  where public.is_finance_staff()
  order by months.month_number;
$$;
revoke all on function public.get_contribution_month_breakdown(uuid, integer) from public;
grant execute on function public.get_contribution_month_breakdown(uuid, integer) to authenticated;

create or replace function public.get_contribution_payment_history(
  p_year integer,
  p_month integer default null,
  p_method public.payment_method default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(payment_id uuid, reference text, member_id uuid, member_number text, full_name text,
  paid_on date, amount_inr bigint, payment_method public.payment_method, note text,
  recorded_by text, months integer[], total_count bigint)
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
  with filtered as (
    select p.id, p.reference, p.member_id, m.member_number,
      concat_ws(' ', m.first_name, m.last_name) as full_name,
      p.paid_on, p.amount_inr, p.payment_method, p.note, p.recorded_by_label,
      array_agg(distinct extract(month from d.period_start)::integer order by extract(month from d.period_start)::integer) as paid_months
    from public.contribution_payments p
    join public.members m on m.id = p.member_id
    join public.contribution_allocations a on a.payment_id = p.id
    join public.contribution_dues d on d.id = a.due_id and d.currency_code = 'INR'
    where public.is_finance_staff() and p.currency_code = 'INR'
      and d.period_start >= make_date(p_year, 1, 1) and d.period_start < make_date(p_year + 1, 1, 1)
      and (p_month is null or extract(month from d.period_start)::integer = p_month)
      and (p_method is null or p.payment_method = p_method)
      and (coalesce(trim(p_search), '') = '' or concat_ws(' ', m.first_name, m.last_name, m.member_number) ilike '%' || trim(p_search) || '%')
    group by p.id, p.reference, p.member_id, m.member_number, m.first_name, m.last_name,
      p.paid_on, p.amount_inr, p.payment_method, p.note, p.recorded_by_label
  )
  select filtered.id, filtered.reference, filtered.member_id, filtered.member_number, filtered.full_name,
    filtered.paid_on, filtered.amount_inr, filtered.payment_method, filtered.note, filtered.recorded_by_label,
    filtered.paid_months, count(*) over()::bigint
  from filtered order by filtered.paid_on desc, filtered.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.get_contribution_payment_history(integer, integer, public.payment_method, text, integer, integer) from public;
grant execute on function public.get_contribution_payment_history(integer, integer, public.payment_method, text, integer, integer) to authenticated;

create or replace function public.record_contribution_payment_manual(
  p_member_id uuid,
  p_paid_on date,
  p_amount_inr bigint,
  p_payment_method public.payment_method,
  p_financial_year integer,
  p_allocations jsonb,
  p_note text default null
)
returns table(payment_id uuid, payment_reference text)
language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  member_row public.members%rowtype;
  category_id uuid;
  transaction_id uuid;
  new_payment_id uuid;
  reference_value text := 'ADEIO-INR-' || upper(substr(extensions.gen_random_uuid()::text, 1, 12));
  allocation_record record;
  allocated_total bigint;
  allocation_count bigint;
  distinct_allocation_count bigint;
  due_row public.contribution_dues%rowtype;
begin
  if not public.is_finance_staff() then raise exception 'Accès réservé au personnel financier.' using errcode = '42501'; end if;
  if p_paid_on is null or p_amount_inr is null or p_amount_inr <= 0 or p_amount_inr > 1000000000000
     or p_financial_year not between 1900 and 2200
     or p_payment_method not in ('cash', 'online')
     or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0
     or length(coalesce(p_note, '')) > 500 then
    raise exception 'Les données du paiement sont invalides.' using errcode = '22023';
  end if;
  select coalesce(sum((item ->> 'amount_inr')::bigint), 0), count(*)::bigint,
         count(distinct (item ->> 'due_id')::uuid)::bigint
  into allocated_total, allocation_count, distinct_allocation_count
  from jsonb_array_elements(p_allocations) item;
  if allocated_total <> p_amount_inr or allocation_count <> distinct_allocation_count
     or exists (select 1 from jsonb_array_elements(p_allocations) item where (item ->> 'amount_inr')::bigint <= 0) then
    raise exception 'La somme des affectations doit correspondre exactement au montant reçu, sans doublon.' using errcode = '23514';
  end if;
  select * into member_row from public.members where id = p_member_id and status = 'active';
  if not found then raise exception 'Le membre est introuvable ou inactif.' using errcode = 'P0002'; end if;
  select id into category_id from public.transaction_categories
    where name = 'Cotisations' and direction = 'income' and is_active limit 1;
  if category_id is null then
    insert into public.transaction_categories(name, direction) values ('Cotisations', 'income') returning id into category_id;
  end if;

  insert into public.financial_transactions(occurred_on, direction, category_id, label, amount_fcfa, amount_inr,
    currency_code, payment_method, created_by)
  values (p_paid_on, 'income', category_id, 'Cotisation · ' || member_row.member_number || ' · ' || reference_value,
    null, p_amount_inr, 'INR', p_payment_method, auth.uid()) returning id into transaction_id;
  insert into public.contribution_payments(member_id, paid_on, amount_fcfa, amount_inr, currency_code,
    payment_method, financial_transaction_id, note, reference, recorded_by_label, created_by)
  values (p_member_id, p_paid_on, null, p_amount_inr, 'INR', p_payment_method, transaction_id,
    nullif(trim(p_note), ''), reference_value, nullif(auth.jwt() ->> 'email', ''), auth.uid()) returning id into new_payment_id;

  for allocation_record in
    select (item ->> 'due_id')::uuid as due_id, (item ->> 'amount_inr')::bigint as amount_inr
    from jsonb_array_elements(p_allocations) item order by (item ->> 'due_id')::uuid
  loop
    select * into due_row from public.contribution_dues
    where id = allocation_record.due_id and member_id = p_member_id and currency_code = 'INR'
      and period_start >= make_date(p_financial_year, 1, 1)
      and period_start < make_date(p_financial_year + 1, 1, 1)
    for update;
    if not found then raise exception 'Un mois sélectionné ne correspond pas à ce membre, à cette année ou à un plan INR.' using errcode = '23514'; end if;
    insert into public.contribution_allocations(payment_id, due_id, member_id, amount_fcfa, amount_inr)
    values (new_payment_id, due_row.id, p_member_id, null, allocation_record.amount_inr);
  end loop;
  if allocated_total <> p_amount_inr then raise exception 'La répartition du paiement est incomplète.' using errcode = '23514'; end if;

  update public.financial_transactions set is_published = true, published_at = now() where id = transaction_id;
  return query select new_payment_id, reference_value;
end;
$$;
revoke all on function public.record_contribution_payment_manual(uuid, date, bigint, public.payment_method, integer, jsonb, text) from public;
grant execute on function public.record_contribution_payment_manual(uuid, date, bigint, public.payment_method, integer, jsonb, text) to authenticated;
