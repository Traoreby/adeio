-- Centralized, non-destructive academic references for member education periods.

create table public.study_programs (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  normalized_name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
create index study_programs_active_name_idx on public.study_programs(is_active, normalized_name);

create table public.member_institutions (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  normalized_name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
create index member_institutions_active_name_idx on public.member_institutions(is_active, normalized_name);

insert into public.study_programs(name, normalized_name)
select min(trim(study_program)), lower(regexp_replace(trim(study_program), '[[:space:]]+', ' ', 'g'))
from public.member_education_periods
group by lower(regexp_replace(trim(study_program), '[[:space:]]+', ' ', 'g'))
on conflict (normalized_name) do nothing;

insert into public.member_institutions(name, normalized_name)
select min(trim(institution)), lower(regexp_replace(trim(institution), '[[:space:]]+', ' ', 'g'))
from public.member_education_periods
group by lower(regexp_replace(trim(institution), '[[:space:]]+', ' ', 'g'))
on conflict (normalized_name) do nothing;

alter table public.member_education_periods
  add column study_program_id uuid references public.study_programs(id) on delete restrict,
  add column institution_id uuid references public.member_institutions(id) on delete restrict;

-- Keep the migration backfill separate from membership_periods.note guards.
-- The shared protect_member_history() trigger function references NEW.note,
-- which is not a field on member_education_periods. Permit only this exact
-- one-time FK backfill while preserving the normal education history rules.
create or replace function public.protect_member_education_reference_backfill()
returns trigger language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'L’historique des formations est conservé.' using errcode = '55000';
  end if;

  if old.study_program_id is null
    and old.institution_id is null
    and new.study_program_id is not null
    and new.institution_id is not null
    and old.member_id is not distinct from new.member_id
    and old.study_program is not distinct from new.study_program
    and old.institution is not distinct from new.institution
    and old.starts_on is not distinct from new.starts_on
    and old.ends_on is not distinct from new.ends_on
    and old.is_current is not distinct from new.is_current
    and old.created_by is not distinct from new.created_by
    and old.created_at is not distinct from new.created_at then
    return new;
  end if;

  if old.member_id is distinct from new.member_id
    or old.study_program is distinct from new.study_program
    or old.institution is distinct from new.institution
    or old.starts_on is distinct from new.starts_on
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at
    or old.is_current is false or new.is_current is true
    or new.ends_on is null
    or (old.ends_on is not null and new.ends_on >= old.ends_on) then
    raise exception 'Une formation historique est immuable ; clôturez la formation courante puis ajoutez-en une nouvelle.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_member_education_reference_backfill() from public, anon, authenticated;
drop trigger if exists protect_member_education_history on public.member_education_periods;
create trigger protect_member_education_history
  before update or delete on public.member_education_periods
  for each row execute function public.protect_member_education_reference_backfill();

update public.member_education_periods education
set study_program_id = program.id,
    institution_id = institution.id
from public.study_programs program, public.member_institutions institution
where program.normalized_name = lower(regexp_replace(trim(education.study_program), '[[:space:]]+', ' ', 'g'))
  and institution.normalized_name = lower(regexp_replace(trim(education.institution), '[[:space:]]+', ' ', 'g'));

alter table public.member_education_periods
  alter column study_program_id set not null,
  alter column institution_id set not null;
create index member_education_program_idx on public.member_education_periods(study_program_id);
create index member_education_institution_idx on public.member_education_periods(institution_id);

create or replace function public.normalize_member_education_reference()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
declare program_row public.study_programs%rowtype; institution_row public.member_institutions%rowtype;
  unchanged boolean := false;
begin
  if tg_op = 'UPDATE' then
    unchanged := new.study_program is not distinct from old.study_program
      and new.institution is not distinct from old.institution;
    if unchanged then
      new.study_program_id := old.study_program_id;
      new.institution_id := old.institution_id;
      return new;
    end if;
  end if;

  select * into program_row from public.study_programs
  where normalized_name = lower(regexp_replace(trim(coalesce(new.study_program, '')), '[[:space:]]+', ' ', 'g'))
    and is_active;
  if not found then raise exception 'Sélectionnez une filière active dans le référentiel ADEIO.' using errcode = '23514'; end if;
  select * into institution_row from public.member_institutions
  where normalized_name = lower(regexp_replace(trim(coalesce(new.institution, '')), '[[:space:]]+', ' ', 'g'))
    and is_active;
  if not found then raise exception 'Sélectionnez un établissement actif dans le référentiel ADEIO.' using errcode = '23514'; end if;
  new.study_program_id := program_row.id;
  new.institution_id := institution_row.id;
  new.study_program := program_row.name;
  new.institution := institution_row.name;
  return new;
end;
$$;

create or replace function public.protect_member_education_reference_history()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.is_current is false and (
    old.study_program_id is distinct from new.study_program_id
    or old.institution_id is distinct from new.institution_id
  ) then
    raise exception 'Les références d’une formation historique sont immuables.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists member_education_reference_normalize on public.member_education_periods;
create trigger member_education_reference_normalize before insert or update on public.member_education_periods
for each row execute function public.normalize_member_education_reference();
drop trigger if exists member_education_reference_history_guard on public.member_education_periods;
create trigger member_education_reference_history_guard before update on public.member_education_periods
for each row execute function public.protect_member_education_reference_history();

create or replace function public.normalize_study_program_reference()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if not public.is_super_admin() then raise exception 'Gestion réservée au Super Admin.' using errcode = '42501'; end if;
  new.name := trim(regexp_replace(new.name, '[[:space:]]+', ' ', 'g'));
  new.normalized_name := lower(new.name);
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

create or replace function public.normalize_institution_reference()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if not public.is_super_admin() then raise exception 'Gestion réservée au Super Admin.' using errcode = '42501'; end if;
  new.name := trim(regexp_replace(new.name, '[[:space:]]+', ' ', 'g'));
  new.normalized_name := lower(new.name);
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists study_programs_normalize on public.study_programs;
create trigger study_programs_normalize before insert or update on public.study_programs
for each row execute function public.normalize_study_program_reference();
drop trigger if exists member_institutions_normalize on public.member_institutions;
create trigger member_institutions_normalize before insert or update on public.member_institutions
for each row execute function public.normalize_institution_reference();

create trigger audit_study_programs after insert or update on public.study_programs
for each row execute function public.write_audit_log();
create trigger audit_member_institutions after insert or update on public.member_institutions
for each row execute function public.write_audit_log();

alter table public.study_programs enable row level security;
alter table public.member_institutions enable row level security;

create policy study_programs_member_read_active on public.study_programs for select to authenticated
  using ((public.current_user_has_role('member'::public.app_role) and is_active) or public.is_admin_user());
create policy study_programs_super_admin_manage on public.study_programs for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy member_institutions_member_read_active on public.member_institutions for select to authenticated
  using ((public.current_user_has_role('member'::public.app_role) and is_active) or public.is_admin_user());
create policy member_institutions_super_admin_manage on public.member_institutions for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

revoke all on public.study_programs, public.member_institutions from anon, authenticated;
grant select, insert, update on public.study_programs, public.member_institutions to authenticated;
