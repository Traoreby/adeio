-- Phase 3: member dues, immutable contribution receipts, and published reports.
-- All financial access remains enforced by RLS; admin alone does not grant arrears access.

drop policy if exists members_select_scoped on public.members;
create policy members_select_scoped on public.members for select to authenticated
  using (
    public.is_admin_user()
    or public.is_finance_staff()
    or user_id = auth.uid()
    or (public.is_assoc_member() and (status = 'active' or public.setting_enabled('former_members_visibility')))
  );

create table public.financial_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null check (length(trim(title)) between 3 and 160),
  period_start date not null,
  period_end date not null,
  summary text,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type = 'application/pdf'),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (period_end >= period_start)
);
create index financial_reports_period_idx on public.financial_reports(period_end desc, published_at desc);
alter table public.financial_reports enable row level security;

create policy financial_reports_read on public.financial_reports for select to authenticated
  using ((published_at is not null and public.is_assoc_member()) or public.is_finance_staff());
create policy financial_reports_finance_insert on public.financial_reports for insert to authenticated
  with check (public.is_finance_staff());
create policy financial_reports_finance_update on public.financial_reports for update to authenticated
  using (public.is_finance_staff()) with check (public.is_finance_staff());
create policy financial_reports_finance_delete on public.financial_reports for delete to authenticated
  using (public.is_finance_staff());

create or replace function public.prevent_published_financial_report_rewrite()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.published_at is not null then
    raise exception 'Un bilan publié est immuable ; publiez une nouvelle version.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.prevent_published_financial_report_rewrite() from public;
create trigger protect_published_financial_reports
  before update or delete on public.financial_reports
  for each row execute function public.prevent_published_financial_report_rewrite();
create trigger audit_financial_reports
  after insert or update or delete on public.financial_reports
  for each row execute function public.write_audit_log();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('financial-reports', 'financial-reports', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

drop policy if exists financial_reports_storage_read on storage.objects;
create policy financial_reports_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'financial-reports' and (public.is_assoc_member() or public.is_finance_staff()));
drop policy if exists financial_reports_storage_manage on storage.objects;
create policy financial_reports_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'financial-reports' and public.is_finance_staff());
create policy financial_reports_storage_delete_orphan on storage.objects for delete to authenticated
  using (bucket_id = 'financial-reports' and public.is_finance_staff() and not exists (
    select 1 from public.financial_reports r where r.storage_path = name
  ));

-- Keep evidence files for published operations immutable. Finance staff can remove
-- a file only while its transaction is still an unpublished draft.
drop policy if exists financial_attachments_finance_manage on storage.objects;
create policy financial_attachments_finance_read on storage.objects for select to authenticated
  using (bucket_id = 'financial-attachments' and public.is_finance_staff());
create policy financial_attachments_finance_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'financial-attachments' and public.is_finance_staff());
create policy financial_attachments_draft_cleanup on storage.objects for delete to authenticated
  using (bucket_id = 'financial-attachments' and public.is_finance_staff() and exists (
    select 1 from public.financial_transactions t
    where t.id::text = split_part(name, '/', 2) and not t.is_published
  ));

insert into public.transaction_categories(name, direction) values
  ('Cotisations', 'income'),
  ('Dons', 'income'),
  ('Événements · recettes', 'income'),
  ('Fonctionnement', 'expense'),
  ('Événements · dépenses', 'expense'),
  ('Transport', 'expense'),
  ('Communication', 'expense'),
  ('Matériel', 'expense'),
  ('Autres recettes', 'income'),
  ('Autres dépenses', 'expense')
on conflict (name) do nothing;

create or replace function public.get_financial_summary(p_from date default null, p_to date default null)
returns table(total_income_fcfa bigint, total_expense_fcfa bigint, net_balance_fcfa bigint, transaction_count bigint)
language sql stable set search_path = public
as $$
  select
    coalesce(sum(amount_fcfa) filter (where direction = 'income'), 0)::bigint,
    coalesce(sum(amount_fcfa) filter (where direction = 'expense'), 0)::bigint,
    (coalesce(sum(amount_fcfa) filter (where direction = 'income'), 0)
      - coalesce(sum(amount_fcfa) filter (where direction = 'expense'), 0))::bigint,
    count(*)::bigint
  from public.financial_transactions
  where is_published
    and (p_from is null or occurred_on >= p_from)
    and (p_to is null or occurred_on <= p_to);
$$;
revoke all on function public.get_financial_summary(date, date) from public;
grant execute on function public.get_financial_summary(date, date) to authenticated;

create or replace function public.get_finance_overdue_summary(p_as_of date default current_date)
returns table(members_overdue bigint, overdue_periods bigint, overdue_amount_fcfa bigint)
language sql stable set search_path = public
as $$
  select count(distinct member_id)::bigint, count(*)::bigint, coalesce(sum(outstanding), 0)::bigint
  from (
    select d.member_id, d.amount_due_fcfa - coalesce(sum(a.amount_fcfa), 0)::bigint as outstanding
    from public.contribution_dues d
    left join public.contribution_allocations a on a.due_id = d.id
    where d.due_on <= p_as_of
    group by d.id, d.member_id, d.amount_due_fcfa
    having d.amount_due_fcfa > coalesce(sum(a.amount_fcfa), 0)
  ) as unpaid
  where public.is_finance_staff();
$$;
revoke all on function public.get_finance_overdue_summary(date) from public;
grant execute on function public.get_finance_overdue_summary(date) to authenticated;

create or replace function public.generate_contribution_dues(p_plan_id uuid, p_through date default current_date)
returns integer language plpgsql set search_path = public, auth
as $$
declare
  plan_row public.contribution_plans%rowtype;
  member_row record;
  period_start date;
  period_end date;
  period_index integer;
  period_step integer;
  due_count integer := 0;
  effective_end date;
begin
  if not public.is_finance_staff() then
    raise exception 'Accès réservé au personnel financier.' using errcode = '42501';
  end if;
  select * into plan_row from public.contribution_plans where id = p_plan_id and is_active;
  if not found then raise exception 'Le plan de cotisation est introuvable ou inactif.' using errcode = 'P0002'; end if;
  effective_end := least(p_through, coalesce(plan_row.ends_on, p_through));
  if effective_end < plan_row.starts_on then return 0; end if;

  for member_row in
    select id, joined_year from public.members where status = 'active' order by id
  loop
    period_index := 0;
    period_start := greatest(plan_row.starts_on, make_date(member_row.joined_year, 1, 1));
    loop
      if plan_row.periodicity = 'monthly' then
        period_start := (greatest(plan_row.starts_on, make_date(member_row.joined_year, 1, 1))::timestamp
          + make_interval(months => period_index))::date;
        period_end := ((greatest(plan_row.starts_on, make_date(member_row.joined_year, 1, 1))::timestamp
          + make_interval(months => period_index + 1))::date - 1);
      elsif plan_row.periodicity = 'yearly' then
        period_start := ((greatest(plan_row.starts_on, make_date(member_row.joined_year, 1, 1))::timestamp
          + make_interval(years => period_index))::date);
        period_end := (((greatest(plan_row.starts_on, make_date(member_row.joined_year, 1, 1))::timestamp
          + make_interval(years => period_index + 1))::date) - 1);
      else
        period_step := plan_row.custom_period_days;
        period_start := greatest(plan_row.starts_on, make_date(member_row.joined_year, 1, 1)) + (period_index * period_step);
        period_end := period_start + period_step - 1;
      end if;
      exit when period_start > effective_end;
      insert into public.contribution_dues(member_id, plan_id, period_start, period_end, due_on, amount_due_fcfa, created_by)
      values (member_row.id, plan_row.id, period_start, period_end, period_end, plan_row.amount_fcfa, auth.uid())
      on conflict (member_id, plan_id, period_start) do nothing;
      if found then due_count := due_count + 1; end if;
      period_index := period_index + 1;
      if period_index > 2400 then raise exception 'Période trop longue pour générer les cotisations.' using errcode = '22023'; end if;
    end loop;
  end loop;
  return due_count;
end;
$$;
revoke all on function public.generate_contribution_dues(uuid, date) from public;
grant execute on function public.generate_contribution_dues(uuid, date) to authenticated;

create or replace function public.record_contribution_payment(
  p_member_id uuid,
  p_paid_on date,
  p_amount_fcfa bigint,
  p_payment_method public.payment_method,
  p_note text default null
)
returns uuid language plpgsql set search_path = public, auth
as $$
declare
  member_row public.members%rowtype;
  category_id uuid;
  transaction_id uuid;
  payment_id uuid;
  due_row record;
  remaining_amount bigint := p_amount_fcfa;
  allocation_amount bigint;
begin
  if not public.is_finance_staff() then
    raise exception 'Accès réservé au personnel financier.' using errcode = '42501';
  end if;
  if p_amount_fcfa is null or p_amount_fcfa <= 0 or p_amount_fcfa > 1000000000000 then
    raise exception 'Montant de cotisation invalide.' using errcode = '22023';
  end if;
  select * into member_row from public.members where id = p_member_id and status = 'active';
  if not found then raise exception 'Le membre actif est introuvable.' using errcode = 'P0002'; end if;
  select id into category_id from public.transaction_categories where name = 'Cotisations' and direction = 'income' and is_active limit 1;
  if category_id is null then
    insert into public.transaction_categories(name, direction) values ('Cotisations', 'income') returning id into category_id;
  end if;

  insert into public.financial_transactions(occurred_on, direction, category_id, label, amount_fcfa, payment_method, created_by)
  values (p_paid_on, 'income', category_id, 'Cotisation · ' || member_row.member_number, p_amount_fcfa, p_payment_method, auth.uid())
  returning id into transaction_id;

  insert into public.contribution_payments(member_id, paid_on, amount_fcfa, payment_method, financial_transaction_id, note, created_by)
  values (p_member_id, p_paid_on, p_amount_fcfa, p_payment_method, transaction_id, nullif(trim(p_note), ''), auth.uid())
  returning id into payment_id;

  for due_row in
    select d.id, d.amount_due_fcfa - coalesce((
      select sum(a.amount_fcfa) from public.contribution_allocations a where a.due_id = d.id
    ), 0)::bigint as outstanding
    from public.contribution_dues d
    where d.member_id = p_member_id
      and d.due_on <= p_paid_on
      and d.amount_due_fcfa > coalesce((
        select sum(a.amount_fcfa) from public.contribution_allocations a where a.due_id = d.id
      ), 0)
    order by d.due_on, d.period_start, d.id
    for update of d
  loop
    exit when remaining_amount = 0;
    allocation_amount := least(remaining_amount, due_row.outstanding);
    insert into public.contribution_allocations(payment_id, due_id, member_id, amount_fcfa)
    values (payment_id, due_row.id, p_member_id, allocation_amount);
    remaining_amount := remaining_amount - allocation_amount;
  end loop;
  if remaining_amount > 0 then
    raise exception 'Le montant dépasse le total des cotisations échues restantes. Générez d’abord les périodes dues.' using errcode = '23514';
  end if;

  update public.financial_transactions set is_published = true, published_at = now() where id = transaction_id;
  return payment_id;
end;
$$;
revoke all on function public.record_contribution_payment(uuid, date, bigint, public.payment_method, text) from public;
grant execute on function public.record_contribution_payment(uuid, date, bigint, public.payment_method, text) to authenticated;

create index if not exists contribution_allocations_due_idx on public.contribution_allocations(due_id);
create index if not exists contribution_dues_overdue_idx on public.contribution_dues(due_on, member_id);

-- Corrections must always point to a published entry of the opposite direction.
create or replace function public.validate_transaction_correction()
returns trigger language plpgsql set search_path = public
as $$
declare original_direction public.financial_direction;
begin
  if new.correction_of is null then return new; end if;
  if new.correction_of = new.id then
    raise exception 'Une écriture ne peut pas se corriger elle-même.' using errcode = '23514';
  end if;
  select direction into original_direction from public.financial_transactions
    where id = new.correction_of and is_published;
  if not found or original_direction = new.direction then
    raise exception 'Une correction doit cibler une écriture publiée de nature opposée.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_transaction_correction() from public;
create trigger validate_financial_transaction_correction
  before insert or update of correction_of, direction, is_published on public.financial_transactions
  for each row execute function public.validate_transaction_correction();
