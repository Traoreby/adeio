-- One contribution plan per executive term. Existing annual plans are retained;
-- only unambiguous exact-date matches are associated with a term.

alter table public.contribution_plans
  add column if not exists executive_term_id uuid references public.executive_terms(id) on delete restrict,
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'active', 'finished'));

with matches as (
  select p.id as plan_id, min(t.id::text)::uuid as term_id, count(*) as match_count
  from public.contribution_plans p
  join public.executive_terms t on t.starts_on = p.starts_on and t.ends_on = p.ends_on
  group by p.id
)
update public.contribution_plans p
set executive_term_id = matches.term_id
from matches
where matches.plan_id = p.id and matches.match_count = 1
  and (select count(*) from public.contribution_plans p2
       where p2.starts_on = p.starts_on and p2.ends_on = p.ends_on) = 1;

update public.contribution_plans
set status = case
  when ends_on < (now() at time zone 'Asia/Kolkata')::date then 'finished'
  when is_active then 'active'
  else 'draft'
end,
is_active = case
  when ends_on < (now() at time zone 'Asia/Kolkata')::date then false
  else is_active
end;

create unique index if not exists contribution_plans_one_per_term_idx
  on public.contribution_plans(executive_term_id) where executive_term_id is not null;

create table if not exists public.contribution_plan_tariff_changes (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.contribution_plans(id) on delete restrict,
  old_amount_inr bigint not null check (old_amount_inr > 0),
  new_amount_inr bigint not null check (new_amount_inr > 0),
  effective_from date not null,
  reason text not null check (length(trim(reason)) between 5 and 1000),
  impact_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  applied_at timestamptz,
  check (old_amount_inr <> new_amount_inr),
  check ((status = 'pending' and reviewed_by is null and reviewed_at is null and applied_at is null)
      or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null
          and ((status = 'approved' and applied_at is not null) or (status = 'rejected' and applied_at is null))))
);
create unique index if not exists contribution_plan_one_pending_tariff_change_idx
  on public.contribution_plan_tariff_changes(plan_id) where status = 'pending';
create index if not exists contribution_plan_tariff_changes_status_idx
  on public.contribution_plan_tariff_changes(status, requested_at desc);

create table if not exists public.contribution_plan_tariffs (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.contribution_plans(id) on delete restrict,
  amount_inr bigint not null check (amount_inr > 0),
  effective_from date not null,
  source_change_id uuid unique references public.contribution_plan_tariff_changes(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (plan_id, effective_from)
);
create index if not exists contribution_plan_tariffs_lookup_idx
  on public.contribution_plan_tariffs(plan_id, effective_from desc);

insert into public.contribution_plan_tariffs(plan_id, amount_inr, effective_from, created_by)
select p.id, p.amount_inr, p.starts_on, p.created_by
from public.contribution_plans p
where p.currency_code = 'INR'
on conflict (plan_id, effective_from) do nothing;

create or replace function public.is_contribution_plan_manager()
returns boolean language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
  select (public.current_user_has_role('treasurer'::public.app_role) or public.is_super_admin())
    and public.mfa_requirement_passed();
$$;
revoke all on function public.is_contribution_plan_manager() from public, anon;
grant execute on function public.is_contribution_plan_manager() to authenticated;

create or replace function public.guard_contribution_plan_term()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare term_row public.executive_terms%rowtype; rate_change text; lifecycle_change text;
begin
  if tg_op = 'INSERT' then
    if not public.is_contribution_plan_manager() then
      raise exception 'La création d’un plan est réservée au Trésorier ou au Super Admin.' using errcode = '42501';
    end if;
    if new.executive_term_id is null then raise exception 'Un mandat du Bureau exécutif est obligatoire.' using errcode = '23502'; end if;
    select * into term_row from public.executive_terms where id = new.executive_term_id;
    if not found or term_row.ends_on is null
      or term_row.ends_on <> (term_row.starts_on + interval '1 year' - interval '1 day')::date then
      raise exception 'Le mandat doit posséder des dates cohérentes sur douze mois.' using errcode = '23514';
    end if;
    if new.currency_code is distinct from 'INR' or new.amount_inr is null or new.amount_inr <= 0
      or new.periodicity <> 'monthly' then
      raise exception 'Un plan ADEIO utilise un montant mensuel positif en INR.' using errcode = '23514';
    end if;
    new.name := 'Cotisation – ' || term_row.title;
    new.starts_on := term_row.starts_on;
    new.ends_on := term_row.ends_on;
    new.status := 'draft';
    new.is_active := false;
    return new;
  end if;

  if new.executive_term_id is distinct from old.executive_term_id
    or new.name is distinct from old.name
    or new.starts_on is distinct from old.starts_on
    or new.ends_on is distinct from old.ends_on
    or new.periodicity is distinct from old.periodicity
    or new.custom_period_days is distinct from old.custom_period_days
    or new.currency_code is distinct from old.currency_code then
    raise exception 'Le mandat, le nom, les dates et la périodicité d’un plan lié sont immuables.' using errcode = '23514';
  end if;
  if new.amount_fcfa is distinct from old.amount_fcfa then
    raise exception 'Un plan ADEIO lié à un mandat ne peut contenir de montant en FCFA.' using errcode = '23514';
  end if;

  rate_change := current_setting('adeio.approved_plan_tariff_change', true);
  lifecycle_change := current_setting('adeio.plan_lifecycle_change', true);
  if new.amount_inr is distinct from old.amount_inr then
    if rate_change is distinct from 'on' or not public.is_super_admin() then
      raise exception 'Le tarif d’un plan actif ne peut changer que par une demande approuvée par le Super Admin.' using errcode = '42501';
    end if;
    new.amount_fcfa := null;
  end if;
  if new.status is distinct from old.status then
    if lifecycle_change is distinct from 'on'
      or (not public.is_contribution_plan_manager() and coalesce(auth.jwt() ->> 'role', '') <> 'service_role') then
      raise exception 'Le statut du plan doit être modifié par l’action autorisée.' using errcode = '42501';
    end if;
  end if;
  new.is_active := new.status = 'active';
  return new;
end;
$$;

drop trigger if exists contribution_plans_term_guard on public.contribution_plans;
create trigger contribution_plans_term_guard before insert or update on public.contribution_plans
for each row execute function public.guard_contribution_plan_term();

drop trigger if exists audit_contribution_plan_tariff_changes on public.contribution_plan_tariff_changes;
create trigger audit_contribution_plan_tariff_changes after insert or update on public.contribution_plan_tariff_changes
for each row execute function public.write_audit_log();

alter table public.contribution_plan_tariff_changes enable row level security;
alter table public.contribution_plan_tariffs enable row level security;

drop policy if exists contribution_plans_finance_manage on public.contribution_plans;
create policy contribution_plans_finance_manager_insert on public.contribution_plans for insert to authenticated
  with check (public.is_contribution_plan_manager());
create policy contribution_plans_finance_manager_update on public.contribution_plans for update to authenticated
  using (public.is_contribution_plan_manager()) with check (public.is_contribution_plan_manager());
drop policy if exists contribution_plans_finance_manager_read_terms on public.executive_terms;
create policy contribution_plans_finance_manager_read_terms on public.executive_terms for select to authenticated
  using (public.is_finance_staff());

create policy contribution_plan_tariff_changes_read on public.contribution_plan_tariff_changes for select to authenticated
  using (public.is_super_admin() or (requested_by = auth.uid() and public.is_contribution_plan_manager())
    or (public.current_user_has_role('auditor'::public.app_role) and public.mfa_requirement_passed() and status <> 'pending'));
create policy contribution_plan_tariffs_finance_read on public.contribution_plan_tariffs for select to authenticated
  using (public.is_finance_staff());
revoke all on public.contribution_plan_tariff_changes from anon, authenticated;
revoke all on public.contribution_plan_tariffs from anon, authenticated;
grant select on public.contribution_plan_tariff_changes, public.contribution_plan_tariffs to authenticated;

create or replace function public.create_contribution_plan_for_term(p_term_id uuid, p_amount_inr bigint)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare term_row public.executive_terms%rowtype; new_plan_id uuid;
begin
  if not public.is_contribution_plan_manager() then raise exception 'Action réservée au Trésorier ou au Super Admin.' using errcode = '42501'; end if;
  if p_term_id is null or p_amount_inr is null or p_amount_inr <= 0 then raise exception 'Mandat ou montant INR invalide.' using errcode = '22023'; end if;
  select * into term_row from public.executive_terms where id = p_term_id;
  if not found or term_row.ends_on is null
    or term_row.ends_on <> (term_row.starts_on + interval '1 year' - interval '1 day')::date then
    raise exception 'Le mandat sélectionné ne couvre pas exactement douze mois.' using errcode = '23514';
  end if;
  insert into public.contribution_plans(name, amount_fcfa, amount_inr, currency_code, periodicity,
    custom_period_days, starts_on, ends_on, is_active, status, executive_term_id, created_by)
  values ('', null, p_amount_inr, 'INR', 'monthly', null, term_row.starts_on, term_row.ends_on,
    false, 'draft', term_row.id, auth.uid()) returning id into new_plan_id;
  return new_plan_id;
end;
$$;
revoke all on function public.create_contribution_plan_for_term(uuid, bigint) from public, anon;
grant execute on function public.create_contribution_plan_for_term(uuid, bigint) to authenticated;

create or replace function public.set_contribution_plan_active(p_plan_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare plan_row public.contribution_plans%rowtype; local_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_contribution_plan_manager() then raise exception 'Action réservée au Trésorier ou au Super Admin.' using errcode = '42501'; end if;
  select * into plan_row from public.contribution_plans where id = p_plan_id for update;
  if not found or plan_row.executive_term_id is null then raise exception 'Le plan lié au mandat est introuvable.' using errcode = 'P0002'; end if;
  if plan_row.status <> 'draft' then raise exception 'Seul un plan brouillon peut être activé.' using errcode = '23514'; end if;
  if local_today < plan_row.starts_on or local_today > plan_row.ends_on then
    raise exception 'Le mandat sélectionné n’est pas actuellement en cours.' using errcode = '23514';
  end if;
  perform set_config('adeio.plan_lifecycle_change', 'on', true);
  update public.contribution_plans set status = 'active' where id = p_plan_id;
  return true;
end;
$$;
revoke all on function public.set_contribution_plan_active(uuid) from public, anon;
grant execute on function public.set_contribution_plan_active(uuid) to authenticated;

create or replace function public.preview_contribution_dues_for_plan(p_plan_id uuid)
returns table(eligible_members integer, existing_dues integer, dues_to_create integer)
language sql stable security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
  with plan_term as (
    select p.id, p.starts_on, p.ends_on from public.contribution_plans p
    where p.id = p_plan_id and p.status = 'active' and p.currency_code = 'INR'
      and (now() at time zone 'Asia/Kolkata')::date between p.starts_on and p.ends_on
      and public.is_contribution_plan_manager()
  ), eligible as (
    select m.id from public.members m cross join plan_term p
    where m.status = 'active' and m.profile_completed_at is not null
      and m.joined_year <= extract(year from p.ends_on)::integer
      and m.exit_year >= extract(year from p.starts_on)::integer
  ), periods as (
    select e.id as member_id, (p.starts_on + make_interval(months => series.month_index))::date as period_start
    from eligible e cross join plan_term p cross join generate_series(0, 11) as series(month_index)
  ), absent as (
    select p.member_id, p.period_start from periods p
    where not exists (select 1 from public.contribution_dues d
      where d.member_id = p.member_id and d.plan_id = p_plan_id and d.period_start = p.period_start)
  )
  select (select count(*)::integer from eligible),
    (select count(*)::integer from periods) - (select count(*)::integer from absent),
    (select count(*)::integer from absent);
$$;
revoke all on function public.preview_contribution_dues_for_plan(uuid) from public, anon;
grant execute on function public.preview_contribution_dues_for_plan(uuid) to authenticated;

create or replace function public.generate_contribution_dues_inr(p_plan_id uuid, p_year integer)
returns integer language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare plan_row public.contribution_plans%rowtype; term_row public.executive_terms%rowtype;
  member_row record; month_index integer; period_start date; period_end date; rate_inr bigint; due_count integer := 0;
  local_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_contribution_plan_manager() then raise exception 'Accès réservé au Trésorier et au Super Admin.' using errcode = '42501'; end if;
  select * into plan_row from public.contribution_plans where id = p_plan_id and status = 'active' and currency_code = 'INR' for update;
  if not found then raise exception 'Le plan INR est introuvable ou inactif.' using errcode = 'P0002'; end if;
  select * into term_row from public.executive_terms where id = plan_row.executive_term_id;
  if not found or p_year <> extract(year from term_row.starts_on)::integer then
    raise exception 'Le mandat du plan est invalide ou l’année de début ne correspond pas.' using errcode = '22023';
  end if;
  if local_today < term_row.starts_on or local_today > term_row.ends_on then
    raise exception 'Les échéances ne peuvent être générées qu’au cours du mandat.' using errcode = '23514';
  end if;
  for member_row in
    select id from public.members where status = 'active' and profile_completed_at is not null
      and joined_year <= extract(year from term_row.ends_on)::integer
      and exit_year >= extract(year from term_row.starts_on)::integer
    order by id
  loop
    for month_index in 0..11 loop
      period_start := (term_row.starts_on + make_interval(months => month_index))::date;
      period_end := least(term_row.ends_on, (period_start + interval '1 month - 1 day')::date);
      select tariff.amount_inr into rate_inr from public.contribution_plan_tariffs tariff
        where tariff.plan_id = plan_row.id and tariff.effective_from <= period_start
        order by tariff.effective_from desc limit 1;
      rate_inr := coalesce(rate_inr, plan_row.amount_inr);
      insert into public.contribution_dues(member_id, plan_id, period_start, period_end, due_on,
        amount_due_fcfa, amount_due_inr, currency_code, created_by)
      values (member_row.id, plan_row.id, period_start, period_end, period_end, null, rate_inr, 'INR', auth.uid())
      on conflict (member_id, plan_id, period_start) do nothing;
      if found then due_count := due_count + 1; end if;
    end loop;
  end loop;
  return due_count;
end;
$$;
revoke all on function public.generate_contribution_dues_inr(uuid, integer) from public, anon;
grant execute on function public.generate_contribution_dues_inr(uuid, integer) to authenticated;

create or replace function public.generate_active_member_term_dues()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare plan_row record; month_index integer; period_start date; period_end date; rate_inr bigint;
begin
  if new.status <> 'active' or new.profile_completed_at is null or new.exit_year is null then return new; end if;
  for plan_row in
    select p.id, p.amount_inr, t.starts_on, t.ends_on
    from public.contribution_plans p join public.executive_terms t on t.id = p.executive_term_id
    where p.status = 'active' and p.currency_code = 'INR'
      and (now() at time zone 'Asia/Kolkata')::date between t.starts_on and t.ends_on
      and new.joined_year <= extract(year from t.ends_on)::integer
      and new.exit_year >= extract(year from t.starts_on)::integer
  loop
    for month_index in 0..11 loop
      period_start := (plan_row.starts_on + make_interval(months => month_index))::date;
      period_end := least(plan_row.ends_on, (period_start + interval '1 month - 1 day')::date);
      select tariff.amount_inr into rate_inr from public.contribution_plan_tariffs tariff
        where tariff.plan_id = plan_row.id and tariff.effective_from <= period_start
        order by tariff.effective_from desc limit 1;
      rate_inr := coalesce(rate_inr, plan_row.amount_inr);
      insert into public.contribution_dues(member_id, plan_id, period_start, period_end, due_on,
        amount_due_fcfa, amount_due_inr, currency_code, created_by)
      values (new.id, plan_row.id, period_start, period_end, period_end, null, rate_inr, 'INR', auth.uid())
      on conflict (member_id, plan_id, period_start) do nothing;
    end loop;
  end loop;
  return new;
end;
$$;
drop trigger if exists members_generate_active_term_dues on public.members;
create trigger members_generate_active_term_dues after insert or update of status, joined_year, exit_year, profile_completed_at
on public.members for each row execute function public.generate_active_member_term_dues();

create or replace function public.create_contribution_tariff_change_request(
  p_plan_id uuid, p_new_amount_inr bigint, p_effective_from date, p_reason text
)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare plan_row public.contribution_plans%rowtype; local_today date := (now() at time zone 'Asia/Kolkata')::date;
  old_rate bigint; new_request_id uuid; impact jsonb;
begin
  if not public.is_contribution_plan_manager() then raise exception 'Action réservée au Trésorier ou au Super Admin.' using errcode = '42501'; end if;
  if p_new_amount_inr is null or p_new_amount_inr <= 0 or length(trim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'Le nouveau montant et le motif sont obligatoires.' using errcode = '22023';
  end if;
  select * into plan_row from public.contribution_plans where id = p_plan_id and status = 'active'
    and (now() at time zone 'Asia/Kolkata')::date between starts_on and ends_on for update;
  if not found then raise exception 'Le plan actif est introuvable.' using errcode = 'P0002'; end if;
  if date_trunc('month', p_effective_from)::date <= date_trunc('month', local_today)::date
    or not exists (select 1 from generate_series(0, 11) as g(month_index)
      where (plan_row.starts_on + make_interval(months => g.month_index))::date = p_effective_from) then
    raise exception 'Choisissez un mois futur appartenant au mandat.' using errcode = '22023';
  end if;
  select amount_inr into old_rate from public.contribution_plan_tariffs
    where plan_id = plan_row.id and effective_from <= p_effective_from order by effective_from desc limit 1;
  old_rate := coalesce(old_rate, plan_row.amount_inr);
  if p_new_amount_inr = old_rate then raise exception 'Le nouveau tarif est identique au tarif déjà prévu.' using errcode = '22023'; end if;
  if exists (select 1 from public.contribution_plan_tariffs where plan_id = plan_row.id and effective_from = p_effective_from) then
    raise exception 'Un tarif est déjà programmé pour ce mois.' using errcode = '23505';
  end if;
  select jsonb_build_object(
    'unpaid', count(*) filter (where not d.is_not_concerned and coalesce(paid.amount, 0) = 0),
    'partial', count(*) filter (where not d.is_not_concerned and coalesce(paid.amount, 0) > 0 and coalesce(paid.amount, 0) < d.amount_due_inr),
    'alreadyPaid', count(*) filter (where not d.is_not_concerned and coalesce(paid.amount, 0) >= d.amount_due_inr),
    'notConcerned', count(*) filter (where d.is_not_concerned),
    'partialAboveNewRate', count(*) filter (where not d.is_not_concerned and coalesce(paid.amount, 0) > 0 and coalesce(paid.amount, 0) < d.amount_due_inr and coalesce(paid.amount, 0) > p_new_amount_inr)
  ) into impact
  from public.contribution_dues d
  left join lateral (select sum(a.amount_inr)::bigint as amount from public.contribution_allocations a where a.due_id = d.id) paid on true
  where d.plan_id = plan_row.id and d.period_start >= p_effective_from and d.due_on > local_today;
  insert into public.contribution_plan_tariff_changes(plan_id, old_amount_inr, new_amount_inr, effective_from,
    reason, impact_snapshot, requested_by)
  values (plan_row.id, old_rate, p_new_amount_inr, p_effective_from, trim(p_reason), coalesce(impact, '{}'::jsonb), auth.uid())
  returning id into new_request_id;
  return new_request_id;
end;
$$;
revoke all on function public.create_contribution_tariff_change_request(uuid, bigint, date, text) from public, anon;
grant execute on function public.create_contribution_tariff_change_request(uuid, bigint, date, text) to authenticated;

create or replace function public.review_contribution_tariff_change(p_request_id uuid, p_approve boolean, p_review_note text default null)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare request_row public.contribution_plan_tariff_changes%rowtype; plan_row public.contribution_plans%rowtype;
  local_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_super_admin() then raise exception 'Seul le Super Admin peut approuver ou refuser un tarif.' using errcode = '42501'; end if;
  select * into request_row from public.contribution_plan_tariff_changes where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'La demande est introuvable ou déjà traitée.' using errcode = 'P0002'; end if;
  select * into plan_row from public.contribution_plans where id = request_row.plan_id for update;
  if not found or plan_row.status <> 'active' then raise exception 'Le plan n’est plus actif.' using errcode = '23514'; end if;
  if length(trim(coalesce(p_review_note, ''))) > 1000 then raise exception 'La note de décision est trop longue.' using errcode = '22023'; end if;

  if p_approve then
    perform set_config('adeio.approved_plan_tariff_change', 'on', true);
    update public.contribution_plans set amount_inr = request_row.new_amount_inr where id = plan_row.id;
    insert into public.contribution_plan_tariffs(plan_id, amount_inr, effective_from, source_change_id, created_by)
      values (plan_row.id, request_row.new_amount_inr, request_row.effective_from, request_row.id, auth.uid());
    if exists (
      select 1 from public.contribution_dues d
      left join lateral (select coalesce(sum(a.amount_inr), 0)::bigint as paid from public.contribution_allocations a where a.due_id = d.id) p on true
      where d.plan_id = plan_row.id and not d.is_not_concerned
        and d.period_start >= request_row.effective_from and d.due_on > local_today
        and p.paid > 0 and p.paid < d.amount_due_inr
        and p.paid > coalesce((select tariff.amount_inr from public.contribution_plan_tariffs tariff
          where tariff.plan_id = d.plan_id and tariff.effective_from <= d.period_start
          order by tariff.effective_from desc limit 1), plan_row.amount_inr)
    ) then
      raise exception 'Une échéance partielle dépasserait le tarif prévu pour son mois. Choisissez un autre mois ou faites corriger la répartition.' using errcode = '23514';
    end if;
    update public.contribution_dues d set amount_due_inr = coalesce((select tariff.amount_inr
      from public.contribution_plan_tariffs tariff where tariff.plan_id = d.plan_id
        and tariff.effective_from <= d.period_start order by tariff.effective_from desc limit 1), plan_row.amount_inr)
    where d.plan_id = plan_row.id and d.currency_code = 'INR' and not d.is_not_concerned
      and d.period_start >= request_row.effective_from and d.due_on > local_today
      and coalesce((select sum(a.amount_inr) from public.contribution_allocations a where a.due_id = d.id), 0) < d.amount_due_inr;
  end if;
  update public.contribution_plan_tariff_changes set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_review_note), ''),
    applied_at = case when p_approve then now() else null end
  where id = request_row.id;
  return true;
end;
$$;
revoke all on function public.review_contribution_tariff_change(uuid, boolean, text) from public, anon;
grant execute on function public.review_contribution_tariff_change(uuid, boolean, text) to authenticated;

create or replace function public.expire_contribution_plans()
returns integer language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare changed integer;
begin
  if auth.uid() is not null and not public.is_super_admin() then raise exception 'Action réservée au Super Admin.' using errcode = '42501'; end if;
  perform set_config('adeio.plan_lifecycle_change', 'on', true);
  update public.contribution_plans set status = 'finished'
  where status = 'active' and ends_on < (now() at time zone 'Asia/Kolkata')::date;
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.expire_contribution_plans() from public, anon, authenticated;
grant execute on function public.expire_contribution_plans() to service_role;
