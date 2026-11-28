-- Active financial writes and summaries are INR-only. Existing legacy rows are
-- retained unchanged; no historical value is converted or deleted.

create or replace function public.get_financial_summary_inr(p_from date default null, p_to date default null)
returns table(total_income_inr bigint, total_expense_inr bigint, net_balance_inr bigint, transaction_count bigint)
language sql stable set search_path = public
as $$
  select coalesce(sum(amount_inr) filter (where direction = 'income'), 0)::bigint,
    coalesce(sum(amount_inr) filter (where direction = 'expense'), 0)::bigint,
    (coalesce(sum(amount_inr) filter (where direction = 'income'), 0)
      - coalesce(sum(amount_inr) filter (where direction = 'expense'), 0))::bigint,
    count(*)::bigint
  from public.financial_transactions
  where is_published and currency_code = 'INR'
    and (p_from is null or occurred_on >= p_from)
    and (p_to is null or occurred_on <= p_to);
$$;
revoke all on function public.get_financial_summary_inr(date, date) from public;
grant execute on function public.get_financial_summary_inr(date, date) to authenticated;

create or replace function public.get_finance_overdue_summary_inr(p_as_of date default current_date)
returns table(members_overdue bigint, overdue_periods bigint, overdue_amount_inr bigint)
language sql stable set search_path = public
as $$
  with due_scope as (
    select d.id, d.member_id, d.due_on, d.amount_due_inr
    from public.contribution_dues d where d.currency_code = 'INR' and d.due_on <= p_as_of
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
revoke all on function public.get_finance_overdue_summary_inr(date) from public;
grant execute on function public.get_finance_overdue_summary_inr(date) to authenticated;

create or replace function public.get_finance_overdue_export_inr(p_as_of date default current_date)
returns table(member_number text, first_name text, last_name text, overdue_periods bigint, oldest_due_on date, overdue_amount_inr bigint)
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
  with due_scope as (
    select d.id, d.member_id, d.due_on, d.amount_due_inr
    from public.contribution_dues d where d.currency_code = 'INR' and d.due_on <= p_as_of
  ), paid_by_due as (
    select a.due_id, sum(a.amount_inr)::bigint as paid_inr
    from public.contribution_allocations a join due_scope d on d.id = a.due_id group by a.due_id
  ), overdue as (
    select d.member_id, d.due_on, d.amount_due_inr - coalesce(p.paid_inr, 0) as remaining_inr
    from due_scope d left join paid_by_due p on p.due_id = d.id
    where d.amount_due_inr > coalesce(p.paid_inr, 0)
  ), by_member as (
    select member_id, count(*)::bigint as period_count, min(due_on) as oldest_due,
      sum(remaining_inr)::bigint as remaining_inr
    from overdue group by member_id
  )
  select m.member_number, m.first_name, m.last_name, o.period_count, o.oldest_due, o.remaining_inr
  from by_member o join public.members m on m.id = o.member_id
  where public.is_finance_staff()
  order by o.oldest_due, m.last_name, m.first_name, m.member_number;
$$;
revoke all on function public.get_finance_overdue_export_inr(date) from public;
grant execute on function public.get_finance_overdue_export_inr(date) to authenticated;

create or replace function public.get_finance_member_contribution_identity(p_member_id uuid)
returns table(id uuid, member_number text, first_name text, last_name text, sex text, status text)
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
  select m.id, m.member_number, m.first_name, m.last_name, d.sex::text, m.status::text
  from public.members m
  left join public.member_private_details d on d.member_id = m.id
  where m.id = p_member_id and public.is_finance_staff();
$$;
revoke all on function public.get_finance_member_contribution_identity(uuid) from public;
grant execute on function public.get_finance_member_contribution_identity(uuid) to authenticated;

create or replace function public.enforce_inr_finance_write()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if new.currency_code is distinct from 'INR' or new.amount_fcfa is not null or new.amount_inr is null then
    raise exception 'Les nouvelles écritures financières doivent être enregistrées en INR.' using errcode = '23514';
  end if;
  return new;
end;
$$;

alter table public.contribution_payments
  alter column reference set default ('ADEIO-INR-' || upper(substr(extensions.gen_random_uuid()::text, 1, 12)));

drop trigger if exists financial_transactions_inr_only on public.financial_transactions;
create trigger financial_transactions_inr_only before insert or update on public.financial_transactions
for each row execute function public.enforce_inr_finance_write();
drop trigger if exists contribution_plans_inr_only on public.contribution_plans;
create trigger contribution_plans_inr_only before insert or update on public.contribution_plans
for each row execute function public.enforce_inr_finance_write();

create or replace function public.enforce_inr_contribution_due_write()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if new.currency_code is distinct from 'INR' or new.amount_due_fcfa is not null or new.amount_due_inr is null then
    raise exception 'Les nouvelles échéances doivent être enregistrées en INR.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists contribution_dues_inr_only on public.contribution_dues;
create trigger contribution_dues_inr_only before insert or update on public.contribution_dues
for each row execute function public.enforce_inr_contribution_due_write();
drop trigger if exists contribution_payments_inr_only on public.contribution_payments;
create trigger contribution_payments_inr_only before insert or update on public.contribution_payments
for each row execute function public.enforce_inr_finance_write();

create or replace function public.enforce_inr_contribution_allocation()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare payment_currency text; due_currency text; payment_member uuid; due_member uuid;
begin
  select currency_code, member_id into payment_currency, payment_member
  from public.contribution_payments where id = new.payment_id;
  select currency_code, member_id into due_currency, due_member
  from public.contribution_dues where id = new.due_id;
  if payment_currency is distinct from 'INR' or due_currency is distinct from 'INR'
     or payment_member is distinct from new.member_id or due_member is distinct from new.member_id
     or new.amount_fcfa is not null or new.amount_inr is null or new.amount_inr <= 0 then
    raise exception 'Les nouvelles affectations doivent relier le même membre et des écritures INR.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists contribution_allocations_inr_only on public.contribution_allocations;
create trigger contribution_allocations_inr_only before insert or update on public.contribution_allocations
for each row execute function public.enforce_inr_contribution_allocation();

create or replace function public.assert_contribution_allocation_total()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare target_payment uuid; payment_row public.contribution_payments%rowtype; total_allocated bigint;
        previous_payment public.contribution_payments%rowtype; previous_total bigint;
begin
  if tg_table_name = 'contribution_payments' then
    if tg_op = 'DELETE' then target_payment := old.id; else target_payment := new.id; end if;
  else
    if tg_op = 'DELETE' then target_payment := old.payment_id; else target_payment := new.payment_id; end if;
  end if;
  select * into payment_row from public.contribution_payments where id = target_payment;
  if not found then return null; end if;
  select coalesce(sum(a.amount_inr), 0)::bigint into total_allocated
  from public.contribution_allocations a where a.payment_id = target_payment;
  if payment_row.currency_code = 'INR' and total_allocated <> payment_row.amount_inr then
    raise exception 'La somme des affectations doit être exactement égale au montant reçu.' using errcode = '23514';
  end if;
  if tg_table_name = 'contribution_allocations' and tg_op = 'UPDATE' and old.payment_id is distinct from new.payment_id then
    select * into previous_payment from public.contribution_payments where id = old.payment_id;
    select coalesce(sum(a.amount_inr), 0)::bigint into previous_total
    from public.contribution_allocations a where a.payment_id = old.payment_id;
    if previous_payment.currency_code = 'INR' and previous_total <> previous_payment.amount_inr then
      raise exception 'La modification laisserait un paiement sans répartition complète.' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists contribution_allocations_total_check on public.contribution_allocations;
create constraint trigger contribution_allocations_total_check
after insert or update or delete on public.contribution_allocations
deferrable initially deferred for each row execute function public.assert_contribution_allocation_total();
drop trigger if exists contribution_payments_total_check on public.contribution_payments;
create constraint trigger contribution_payments_total_check
after insert or update on public.contribution_payments
deferrable initially deferred for each row execute function public.assert_contribution_allocation_total();

-- Keep the historical signatures/grants intact while preventing the retired
-- automatic XOF/oldest-month allocation paths from creating new entries.
create or replace function public.generate_contribution_dues(p_plan_id uuid, p_through date default current_date)
returns integer language plpgsql set search_path = public, auth
as $$
begin
  if not public.is_finance_staff() then raise exception 'Accès réservé au personnel financier.' using errcode = '42501'; end if;
  raise exception 'Cette ancienne génération est désactivée. Utilisez la génération annuelle INR.' using errcode = '0A000';
end;
$$;

create or replace function public.record_contribution_payment(
  p_member_id uuid, p_paid_on date, p_amount_fcfa bigint,
  p_payment_method public.payment_method, p_note text default null
)
returns uuid language plpgsql set search_path = public, auth
as $$
begin
  if not public.is_finance_staff() then raise exception 'Accès réservé au personnel financier.' using errcode = '42501'; end if;
  raise exception 'Cette ancienne saisie est désactivée. Enregistrez un paiement INR avec une répartition mensuelle manuelle.' using errcode = '0A000';
end;
$$;
