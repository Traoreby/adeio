-- Complétion personnelle et réactivation explicitement approuvée par l'administration.

alter table public.member_onboarding
  drop constraint member_onboarding_status_check;
alter table public.member_onboarding
  add constraint member_onboarding_status_check
    check (status in ('pending', 'profile_submitted', 'completed'));
alter table public.member_onboarding
  drop constraint member_onboarding_check;
alter table public.member_onboarding
  add constraint member_onboarding_status_timestamp_check
    check (
      (status = 'pending' and profile_submitted_at is null)
      or (status in ('profile_submitted', 'completed') and profile_submitted_at is not null)
    );

alter table public.members
  add column if not exists reactivation_photo_required boolean not null default false;

-- Ne jamais détacher silencieusement une fiche si un compte Auth est supprimé.
alter table public.members drop constraint if exists members_user_id_fkey;
alter table public.members add constraint members_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;

create or replace function public.guard_active_member_exit_year()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active'
    and (new.exit_year is null or new.exit_year <= extract(year from (now() at time zone 'Asia/Kolkata'))::integer) then
    raise exception 'Un membre actif doit avoir une année de sortie future.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger members_active_exit_year_guard
  before insert or update of status, exit_year on public.members
  for each row execute function public.guard_active_member_exit_year();

create or replace function public.guard_member_reactivation_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'active' and new.status = 'active'
    and current_setting('adeio.reactivating_member_id', true) is distinct from old.id::text then
    raise exception 'La réactivation doit passer par la procédure administrative complète.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger members_reactivation_transition_guard
  before update of status on public.members
  for each row execute function public.guard_member_reactivation_transition();

create or replace function public.guard_member_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.member_number is distinct from new.member_number
    and current_setting('adeio.anonymize_member_id', true) is distinct from old.id::text then
    raise exception 'Le numéro ADEIO est permanent et ne peut pas être modifié.' using errcode = '23514';
  end if;
  if old.user_id is not null and new.user_id is distinct from old.user_id
    and current_setting('adeio.anonymize_member_id', true) is distinct from old.id::text then
    raise exception 'Le compte Auth lié est permanent. Passez par la procédure d’anonymisation pour le détacher.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger members_identity_guard
  before update of member_number, user_id on public.members
  for each row execute function public.guard_member_identity();

create or replace function public.protect_member_history()
returns trigger
language plpgsql
set search_path = public
as $$
declare member_key uuid;
begin
  member_key := old.member_id;
  if current_setting('adeio.anonymize_member_id', true) = member_key::text then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'member_education_periods' then
    if tg_op = 'DELETE' then
      raise exception 'L’historique des formations est conservé.' using errcode = '55000';
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
  end if;

  if tg_op = 'DELETE' then
    raise exception 'L’historique des adhésions est conservé.' using errcode = '55000';
  end if;
  if old.member_id is distinct from new.member_id
    or old.starts_on is distinct from new.starts_on
    or old.note is distinct from new.note
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at
    or new.ends_on is null
    or (old.ends_on is not null and new.ends_on >= old.ends_on) then
    raise exception 'Une période d’adhésion ne peut être supprimée ou réécrite ; seule sa clôture est autorisée.' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger protect_member_education_history
  before update or delete on public.member_education_periods
  for each row execute function public.protect_member_history();
create trigger protect_membership_history
  before update or delete on public.membership_periods
  for each row execute function public.protect_member_history();

create or replace function public.admin_create_member(
  p_member_number text, p_first_name text, p_last_name text, p_joined_year integer, p_exit_year integer,
  p_study_program text, p_institution text, p_phone text, p_sex text,
  p_status public.member_status, p_user_id uuid, p_photo_public_consent boolean
)
returns uuid
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  member_uuid uuid;
  current_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
  start_date date;
  end_date date;
begin
  if not public.is_admin_user() then raise exception 'Action réservée à l’administration.' using errcode = '42501'; end if;
  if p_member_number is null or p_joined_year is null or p_exit_year is null or p_status is null or p_sex is null
    or p_member_number !~ '^ADEIO-[0-9]{4}-[A-Z0-9]{4}$'
    or length(trim(coalesce(p_first_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_last_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_study_program, ''))) not between 2 and 160
    or length(trim(coalesce(p_institution, ''))) not between 2 and 200
    or length(trim(coalesce(p_phone, ''))) not between 6 and 40
    or p_joined_year not between 1900 and current_year
    or p_exit_year not between greatest(1900, p_joined_year) and 2200
    or (p_status = 'active' and p_exit_year <= current_year)
    or p_sex not in ('female', 'male', 'other', 'prefer_not_to_say') then
    raise exception 'Les informations du membre sont invalides ou incomplètes.' using errcode = '22023';
  end if;
  if p_user_id is not null and exists (
    select 1 from public.member_onboarding o where o.user_id = p_user_id
      and (o.kind = 'reactivation' or o.member_id is not null)
  ) then raise exception 'Ce compte est déjà lié à une fiche ou à une procédure de réactivation.' using errcode = '23505'; end if;

  start_date := make_date(p_joined_year, 1, 1);
  end_date := case when p_status = 'active' then null else greatest(start_date, make_date(p_exit_year, 1, 1) - 1) end;
  insert into public.members(user_id, member_number, first_name, last_name, joined_year, exit_year, status,
    photo_public_consent, created_by, profile_completed_at, archived_at, reactivation_photo_required)
  values (p_user_id, p_member_number, trim(p_first_name), trim(p_last_name), p_joined_year, p_exit_year, p_status,
    coalesce(p_photo_public_consent, false), auth.uid(), now(), case when p_status = 'former' then now() else null end, p_status = 'former')
  returning id into member_uuid;

  insert into public.membership_periods(member_id, starts_on, ends_on, created_by)
    values (member_uuid, start_date, end_date, auth.uid());
  insert into public.member_private_details(member_id, phone, sex)
    values (member_uuid, trim(p_phone), p_sex);
  insert into public.member_education_periods(member_id, study_program, institution, starts_on, ends_on, is_current, created_by)
    values (member_uuid, trim(p_study_program), trim(p_institution), start_date, end_date, p_status = 'active', auth.uid());
  if p_user_id is not null then
    insert into public.member_onboarding(user_id, member_id, kind, status, initiated_by, profile_submitted_at)
    values (p_user_id, member_uuid, 'new_member', 'completed', auth.uid(), now())
    on conflict (user_id) do update set member_id = excluded.member_id, kind = 'new_member', status = 'completed',
      initiated_by = excluded.initiated_by, profile_submitted_at = excluded.profile_submitted_at, updated_at = now();
  end if;
  insert into public.member_lifecycle_events(member_id, event_type, actor_id)
    values (member_uuid, 'profile_completed', auth.uid());
  return member_uuid;
end;
$$;

create or replace function public.admin_update_member_profile(
  p_member_id uuid, p_first_name text, p_last_name text, p_exit_year integer,
  p_study_program text, p_institution text, p_phone text, p_sex text,
  p_status public.member_status, p_user_id uuid, p_photo_public_consent boolean
)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  member_row public.members%rowtype;
  current_education public.member_education_periods%rowtype;
  current_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
  today_local date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin_user() then raise exception 'Action réservée à l’administration.' using errcode = '42501'; end if;
  select * into member_row from public.members where id = p_member_id for update;
  if not found then raise exception 'Membre introuvable.' using errcode = 'P0002'; end if;
  if member_row.status <> 'active' and p_status = 'active' then
    raise exception 'Une réactivation explicite est requise.' using errcode = '42501';
  end if;
  if member_row.user_id is not null and p_user_id is distinct from member_row.user_id then
    raise exception 'Le compte Auth lié est permanent.' using errcode = '23514';
  end if;
  if p_exit_year is null or p_status is null or p_sex is null
    or p_exit_year < member_row.joined_year or p_exit_year > 2200
    or (p_status = 'active' and p_exit_year <= current_year)
    or length(trim(coalesce(p_first_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_last_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_study_program, ''))) not between 2 and 160
    or length(trim(coalesce(p_institution, ''))) not between 2 and 200
    or length(trim(coalesce(p_phone, ''))) not between 6 and 40
    or p_sex not in ('female', 'male', 'other', 'prefer_not_to_say') then
    raise exception 'Les informations du membre sont invalides ou incomplètes.' using errcode = '22023';
  end if;
  if member_row.user_id is null and p_user_id is not null and exists (
    select 1 from public.member_onboarding o where o.user_id = p_user_id
      and (o.kind = 'reactivation' or (o.member_id is not null and o.member_id <> p_member_id))
  ) then raise exception 'Ce compte est déjà lié à une fiche ou à une procédure de réactivation.' using errcode = '23505'; end if;

  update public.members set first_name = trim(p_first_name), last_name = trim(p_last_name), exit_year = p_exit_year,
    status = p_status, user_id = p_user_id, photo_public_consent = coalesce(p_photo_public_consent, false),
    profile_completed_at = coalesce(profile_completed_at, now())
    where id = p_member_id;
  insert into public.member_private_details(member_id, phone, sex)
    values (p_member_id, trim(p_phone), p_sex)
    on conflict (member_id) do update set phone = excluded.phone, sex = excluded.sex, updated_at = now();
  if p_status = 'active' then
    select * into current_education from public.member_education_periods
      where member_id = p_member_id and is_current for update;
    if not found then
      insert into public.member_education_periods(member_id, study_program, institution, starts_on, created_by)
        values (p_member_id, trim(p_study_program), trim(p_institution), today_local, auth.uid());
    elsif current_education.study_program is distinct from trim(p_study_program)
      or current_education.institution is distinct from trim(p_institution) then
      update public.member_education_periods set ends_on = greatest(starts_on, today_local - 1), is_current = false
        where id = current_education.id;
      insert into public.member_education_periods(member_id, study_program, institution, starts_on, created_by)
        values (p_member_id, trim(p_study_program), trim(p_institution), today_local, auth.uid());
    end if;
  end if;
  if member_row.user_id is null and p_user_id is not null then
    insert into public.member_onboarding(user_id, member_id, kind, status, initiated_by, profile_submitted_at)
    values (p_user_id, p_member_id, 'new_member', 'completed', auth.uid(), now())
    on conflict (user_id) do update set member_id = excluded.member_id, kind = 'new_member', status = 'completed',
      initiated_by = excluded.initiated_by, profile_submitted_at = excluded.profile_submitted_at, updated_at = now();
  end if;
end;
$$;

create or replace function public.anonymize_member(p_member_id uuid, p_member_number text)
returns text
language plpgsql security definer
set search_path = public, auth
as $$
declare old_photo_path text;
begin
  if not public.is_super_admin() then
    raise exception 'Accès réservé au super-administrateur.' using errcode = '42501';
  end if;
  if p_member_number !~ '^ADEIO-[0-9]{4}-[A-Z0-9]{4}$' then
    raise exception 'Numéro membre anonymisé invalide.' using errcode = '22023';
  end if;
  select m.photo_path into old_photo_path from public.members m where m.id = p_member_id for update;
  if not found then raise exception 'Membre introuvable.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.members m where m.member_number = p_member_number and m.id <> p_member_id) then
    raise exception 'Numéro membre déjà utilisé.' using errcode = '23505';
  end if;

  perform set_config('adeio.anonymize_member_id', p_member_id::text, true);
  update public.members
    set member_number = p_member_number, first_name = 'Membre', last_name = 'anonymisé',
        user_id = null, photo_path = null, photo_public_consent = false
    where id = p_member_id;
  delete from public.member_private_details where member_id = p_member_id;
  update public.membership_periods set note = null where member_id = p_member_id and note is not null;
  update public.member_qr_tokens set revoked_at = now() where member_id = p_member_id and revoked_at is null;
  return old_photo_path;
end;
$$;

create unique index member_qr_tokens_one_active_per_member_idx
  on public.member_qr_tokens(member_id) where revoked_at is null;

create or replace function public.complete_own_member_profile(
  p_first_name text,
  p_last_name text,
  p_joined_year integer,
  p_exit_year integer,
  p_study_program text,
  p_institution text,
  p_phone text,
  p_sex text
)
returns uuid
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  caller_id uuid := auth.uid();
  member_row public.members%rowtype;
  member_uuid uuid;
  current_education public.member_education_periods%rowtype;
  generated_number text;
  attempt integer;
  current_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
begin
  if caller_id is null or not public.current_user_has_role('member'::public.app_role) then
    raise exception 'Accès réservé au membre connecté.' using errcode = '42501';
  end if;
  if p_joined_year is null or p_exit_year is null or p_sex is null
    or length(trim(coalesce(p_first_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_last_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_study_program, ''))) not between 2 and 160
    or length(trim(coalesce(p_institution, ''))) not between 2 and 200
    or length(trim(coalesce(p_phone, ''))) not between 6 and 40
    or p_joined_year not between 1900 and current_year
    or p_exit_year not between current_year + 1 and 2200
    or p_exit_year < p_joined_year
    or p_sex not in ('female', 'male', 'other', 'prefer_not_to_say') then
    raise exception 'Les informations du profil sont invalides ou incomplètes.' using errcode = '22023';
  end if;

  select * into member_row from public.members where user_id = caller_id for update;
  if found then
    member_uuid := member_row.id;
    if member_row.status = 'active'
      and public.setting_enabled('member_lifecycle_enforced')
      and (member_row.exit_year is null or member_row.exit_year <= current_year) then
      raise exception 'La période active est arrivée à échéance ; contactez l’administration.' using errcode = '42501';
    end if;
    if member_row.status <> 'active' then
      if member_row.status <> 'former' or not exists (
        select 1 from public.member_onboarding o
        where o.user_id = caller_id and o.member_id = member_row.id and o.kind = 'reactivation'
          and o.status = 'pending'
      ) then
        raise exception 'Une réactivation administrative est nécessaire.' using errcode = '42501';
      end if;
    end if;
    if member_row.joined_year <> p_joined_year then
      raise exception 'L’année et le numéro de première adhésion sont conservés définitivement.' using errcode = '22023';
    end if;
    update public.members
      set first_name = trim(p_first_name), last_name = trim(p_last_name), exit_year = p_exit_year,
          profile_completed_at = coalesce(profile_completed_at, now())
      where id = member_uuid;
  else
    if not exists (
      select 1 from public.member_onboarding o
      where o.user_id = caller_id and o.kind = 'new_member' and o.status = 'pending'
    ) then
      raise exception 'Aucun dossier d’adhésion en attente n’est associé à ce compte.' using errcode = '42501';
    end if;
    for attempt in 1..12 loop
      generated_number := 'ADEIO-' || p_joined_year::text || '-' || upper(substr(encode(extensions.gen_random_bytes(3), 'hex'), 1, 4));
      insert into public.members(user_id, member_number, first_name, last_name, joined_year, exit_year, status, profile_completed_at, created_by)
        values (caller_id, generated_number, trim(p_first_name), trim(p_last_name), p_joined_year, p_exit_year, 'active', now(), caller_id)
        on conflict (member_number) do nothing
        returning id into member_uuid;
      exit when member_uuid is not null;
    end loop;
    if member_uuid is null then
      raise exception 'Un numéro ADEIO unique n’a pas pu être généré.' using errcode = '23505';
    end if;
    insert into public.membership_periods(member_id, starts_on, created_by)
      values (member_uuid, make_date(p_joined_year, 1, 1), caller_id);
    update public.member_onboarding
      set member_id = member_uuid, status = 'completed', profile_submitted_at = now(), updated_at = now()
      where user_id = caller_id;
    insert into public.member_lifecycle_events(member_id, event_type, actor_id)
      values (member_uuid, 'profile_completed', caller_id);
  end if;

  insert into public.member_private_details(member_id, phone, sex)
    values (member_uuid, trim(p_phone), p_sex)
    on conflict (member_id) do update set phone = excluded.phone, sex = excluded.sex, updated_at = now();

  select * into current_education from public.member_education_periods
    where member_id = member_uuid and is_current for update;
  if found and (current_education.study_program <> trim(p_study_program) or current_education.institution <> trim(p_institution)) then
    update public.member_education_periods
      set ends_on = greatest(starts_on, (now() at time zone 'Asia/Kolkata')::date - 1), is_current = false
      where id = current_education.id;
    current_education.id := null;
  end if;
  if current_education.id is null then
    insert into public.member_education_periods(member_id, study_program, institution, starts_on, created_by)
      values (member_uuid, trim(p_study_program), trim(p_institution), (now() at time zone 'Asia/Kolkata')::date, caller_id);
  end if;
  return member_uuid;
end;
$$;

create or replace function public.set_own_member_photo(p_storage_path text)
returns text
language plpgsql security definer
set search_path = public, auth
as $$
declare
  member_row public.members%rowtype;
  previous_path text;
begin
  select * into member_row from public.members where user_id = auth.uid() for update;
  if not found then raise exception 'Aucune fiche membre liée à ce compte.' using errcode = 'P0002'; end if;
  if member_row.status = 'active' and not public.is_current_member() then
    raise exception 'La période active est arrivée à échéance.' using errcode = '42501';
  end if;
  if member_row.status <> 'active' and not exists (
    select 1 from public.member_onboarding o
    where o.user_id = auth.uid() and o.member_id = member_row.id and o.kind = 'reactivation' and o.status = 'pending'
  ) then
    raise exception 'La photo ne peut pas être modifiée pour ce statut.' using errcode = '42501';
  end if;
  if p_storage_path !~ ('^' || member_row.id::text || '/[A-Za-z0-9._-]+\.(webp|jpg)$') then
    raise exception 'Chemin de photo invalide.' using errcode = '22023';
  end if;
  previous_path := member_row.photo_path;
  update public.members set photo_path = p_storage_path where id = member_row.id;
  return previous_path;
end;
$$;

create or replace function public.set_own_member_photo_consent(p_consent boolean)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  update public.members set photo_public_consent = p_consent
    where user_id = auth.uid() and status = 'active' and public.is_current_member();
  if not found then
    update public.members set photo_public_consent = p_consent
      where user_id = auth.uid() and status = 'former'
        and exists (select 1 from public.member_onboarding o where o.user_id = auth.uid() and o.member_id = public.members.id and o.kind = 'reactivation' and o.status = 'pending');
  end if;
  if not found then raise exception 'Aucune fiche membre modifiable n’est liée à ce compte.' using errcode = '42501'; end if;
end;
$$;

create or replace function public.revoke_member_qr_on_inactive()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  close_date date;
begin
  if old.status = 'active' and new.status <> 'active' then
    new.archived_at := coalesce(new.archived_at, now());
    if new.status = 'former' then new.reactivation_photo_required := true; end if;
    close_date := case
      when new.exit_year is not null and new.exit_year <= extract(year from (now() at time zone 'Asia/Kolkata'))::integer
        then make_date(new.exit_year, 1, 1) - 1
      else (now() at time zone 'Asia/Kolkata')::date - 1
    end;
    update public.membership_periods mp set ends_on = greatest(mp.starts_on, close_date)
      where mp.id = (select candidate.id from public.membership_periods candidate
        where candidate.member_id = new.id order by candidate.starts_on desc, candidate.created_at desc limit 1)
        and (mp.ends_on is null or mp.ends_on > close_date);
    update public.member_education_periods ep
      set ends_on = greatest(ep.starts_on, close_date), is_current = false
      where ep.member_id = new.id and ep.is_current;
    update public.member_qr_tokens
      set revoked_at = coalesce(revoked_at, now())
      where member_id = new.id and revoked_at is null;
    insert into public.member_lifecycle_events(member_id, event_type, actor_id, details)
      values (new.id, case when new.status = 'former' then 'archived' else 'status_changed' end, auth.uid(), jsonb_build_object('previous_status', old.status, 'status', new.status, 'exit_year', new.exit_year));
  end if;
  if old.photo_path is distinct from new.photo_path then
    new.photo_updated_at := now();
    new.photo_updated_by := auth.uid();
    insert into public.member_lifecycle_events(member_id, event_type, actor_id, details)
      values (new.id, 'photo_updated', auth.uid(), '{}'::jsonb);
  end if;
  return new;
end;
$$;

create or replace function public.archive_expired_members()
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  member_row record;
  archived_count integer := 0;
  cutoff_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
  cutoff_date date;
begin
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Action réservée au super-administrateur.' using errcode = '42501';
  end if;
  if not public.setting_enabled('member_lifecycle_enforced') then return 0; end if;

  for member_row in
    select id, exit_year from public.members
    where status = 'active' and exit_year <= cutoff_year
    order by exit_year, id
    for update
  loop
    cutoff_date := make_date(member_row.exit_year, 1, 1) - 1;
    update public.membership_periods mp set ends_on = greatest(mp.starts_on, cutoff_date)
      where mp.id = (select candidate.id from public.membership_periods candidate
        where candidate.member_id = member_row.id order by candidate.starts_on desc, candidate.created_at desc limit 1)
        and (mp.ends_on is null or mp.ends_on > cutoff_date);
    update public.member_education_periods ep set ends_on = greatest(ep.starts_on, cutoff_date), is_current = false
      where ep.member_id = member_row.id and ep.is_current;
    update public.members set status = 'former', archived_at = now()
      where id = member_row.id and status = 'active';
    if found then archived_count := archived_count + 1; end if;
  end loop;
  return archived_count;
end;
$$;

create or replace function public.submit_own_reactivation_profile()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare member_row public.members%rowtype;
begin
  select * into member_row from public.members where user_id = auth.uid() for update;
  if not found or member_row.status <> 'former' then raise exception 'Aucun membre archivé lié à ce compte.' using errcode = 'P0002'; end if;
  if member_row.photo_updated_by is distinct from auth.uid() then
    raise exception 'La nouvelle photo doit être envoyée depuis le compte du membre.' using errcode = '42501';
  end if;
  if not member_row.photo_updated_at > coalesce(member_row.archived_at, '-infinity'::timestamptz) then
    raise exception 'Une nouvelle photo est obligatoire pour la réactivation.' using errcode = '23514';
  end if;
  if member_row.exit_year is null or member_row.exit_year <= extract(year from (now() at time zone 'Asia/Kolkata'))::integer then
    raise exception 'L’année de sortie doit être postérieure à l’année en cours.' using errcode = '23514';
  end if;
  update public.member_onboarding
    set status = 'profile_submitted', profile_submitted_at = now(), updated_at = now()
    where user_id = auth.uid() and member_id = member_row.id and kind = 'reactivation' and status = 'pending';
  if not found then raise exception 'Aucune demande de réactivation en attente.' using errcode = '42501'; end if;
end;
$$;

create or replace function public.start_member_reactivation(p_member_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare linked_user uuid;
begin
  if not public.is_admin_user() then raise exception 'Action réservée à l’administration.' using errcode = '42501'; end if;
  select user_id into linked_user from public.members where id = p_member_id and status = 'former' for update;
  if not found then raise exception 'Membre archivé introuvable.' using errcode = 'P0002'; end if;
  if linked_user is null then raise exception 'Associez d’abord un compte Auth existant à cette fiche.' using errcode = '23514'; end if;
  insert into public.member_onboarding(user_id, member_id, kind, status, initiated_by, profile_submitted_at)
    values (linked_user, p_member_id, 'reactivation', 'pending', auth.uid(), null)
    on conflict (user_id) do update set member_id = excluded.member_id, kind = 'reactivation', status = 'pending',
      initiated_by = excluded.initiated_by, profile_submitted_at = null, updated_at = now()
    where public.member_onboarding.status = 'completed';
  if not found then raise exception 'Une procédure est déjà en cours pour ce compte.' using errcode = '23505'; end if;
  insert into public.member_lifecycle_events(member_id, event_type, actor_id)
    values (p_member_id, 'reactivation_started', auth.uid());
  return linked_user;
end;
$$;

create or replace function public.issue_member_qr(
  p_member_id uuid, p_token_hash text, p_encrypted_token text, p_nonce text, p_tag text, p_key_version text
)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin_user() then raise exception 'Action réservée à l’administration.' using errcode = '42501'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or length(p_encrypted_token) > 512 or length(p_nonce) > 128 or length(p_tag) > 128 or length(p_key_version) > 32 then
    raise exception 'Données de jeton invalides.' using errcode = '22023';
  end if;
  perform 1 from public.members m where m.id = p_member_id and m.status = 'active'
    and m.exit_year > extract(year from (now() at time zone 'Asia/Kolkata'))::integer
    and not m.reactivation_photo_required for update;
  if not found then
    raise exception 'Seule une fiche active et à jour peut recevoir une carte.' using errcode = '23514';
  end if;
  update public.member_qr_tokens set revoked_at = coalesce(revoked_at, now())
    where member_id = p_member_id and revoked_at is null;
  insert into public.member_qr_tokens(member_id, token_hash, encrypted_token, encryption_nonce, encryption_tag, encryption_key_version, created_by)
    values (p_member_id, p_token_hash, p_encrypted_token, p_nonce, p_tag, p_key_version, auth.uid());
  insert into public.member_lifecycle_events(member_id, event_type, actor_id)
    values (p_member_id, 'qr_issued', auth.uid());
end;
$$;

create or replace function public.confirm_member_reactivation(
  p_member_id uuid, p_token_hash text, p_encrypted_token text, p_nonce text, p_tag text, p_key_version text
)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  member_row public.members%rowtype;
  linked_user uuid;
  cutoff_date date;
  current_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
begin
  if not public.is_admin_user() then raise exception 'Action réservée à l’administration.' using errcode = '42501'; end if;
  select * into member_row from public.members where id = p_member_id and status = 'former' for update;
  if not found then raise exception 'Le membre n’est plus archivé.' using errcode = 'P0002'; end if;
  if member_row.exit_year is null or member_row.exit_year <= current_year
    or member_row.photo_path is null
    or member_row.photo_updated_at is null
    or member_row.photo_updated_at <= coalesce(member_row.archived_at, '-infinity'::timestamptz)
    or not exists (select 1 from public.member_onboarding o where o.member_id = p_member_id and o.user_id = member_row.user_id and o.kind = 'reactivation' and o.status = 'profile_submitted')
    or not exists (select 1 from public.member_education_periods e where e.member_id = p_member_id and e.is_current) then
    raise exception 'Profil incomplet : une nouvelle photo, une formation et une année de sortie valide sont requises.' using errcode = '23514';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or length(p_encrypted_token) > 512 then
    raise exception 'Données de jeton invalides.' using errcode = '22023';
  end if;
  linked_user := member_row.user_id;
  cutoff_date := make_date(member_row.exit_year, 1, 1) - 1;
  insert into public.membership_periods(member_id, starts_on, ends_on, created_by)
    values (p_member_id, (now() at time zone 'Asia/Kolkata')::date, cutoff_date, auth.uid());
  perform set_config('adeio.reactivating_member_id', p_member_id::text, true);
  update public.members set status = 'active', archived_at = null, reactivation_photo_required = false, profile_completed_at = coalesce(profile_completed_at, now()) where id = p_member_id;
  update public.member_qr_tokens set revoked_at = coalesce(revoked_at, now()) where member_id = p_member_id and revoked_at is null;
  insert into public.member_qr_tokens(member_id, token_hash, encrypted_token, encryption_nonce, encryption_tag, encryption_key_version, created_by)
    values (p_member_id, p_token_hash, p_encrypted_token, p_nonce, p_tag, p_key_version, auth.uid());
  update public.member_onboarding set status = 'completed', updated_at = now()
    where user_id = linked_user and member_id = p_member_id and kind = 'reactivation';
  insert into public.member_lifecycle_events(member_id, event_type, actor_id, details)
    values (p_member_id, 'reactivated', auth.uid(), jsonb_build_object('member_number', member_row.member_number));
  insert into public.member_lifecycle_events(member_id, event_type, actor_id)
    values (p_member_id, 'qr_issued', auth.uid());
end;
$$;

create or replace function public.revoke_member_qr(p_member_id uuid)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin_user() then raise exception 'Action réservée à l’administration.' using errcode = '42501'; end if;
  perform 1 from public.members where id = p_member_id for update;
  if not found then raise exception 'Membre introuvable.' using errcode = 'P0002'; end if;
  update public.member_qr_tokens set revoked_at = coalesce(revoked_at, now()) where member_id = p_member_id and revoked_at is null;
  insert into public.member_lifecycle_events(member_id, event_type, actor_id)
    values (p_member_id, 'qr_revoked', auth.uid());
end;
$$;

revoke all on function public.admin_create_member(text,text,text,integer,integer,text,text,text,text,public.member_status,uuid,boolean) from public, anon;
revoke all on function public.admin_update_member_profile(uuid,text,text,integer,text,text,text,text,public.member_status,uuid,boolean) from public, anon;
revoke all on function public.protect_member_history() from public, anon;
grant execute on function public.admin_create_member(text,text,text,integer,integer,text,text,text,text,public.member_status,uuid,boolean) to authenticated;
grant execute on function public.admin_update_member_profile(uuid,text,text,integer,text,text,text,text,public.member_status,uuid,boolean) to authenticated;
revoke all on function public.complete_own_member_profile(text,text,integer,integer,text,text,text,text) from public, anon;
revoke all on function public.set_own_member_photo(text) from public, anon;
revoke all on function public.set_own_member_photo_consent(boolean) from public, anon;
revoke all on function public.submit_own_reactivation_profile() from public, anon;
revoke all on function public.start_member_reactivation(uuid) from public, anon;
revoke all on function public.issue_member_qr(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.confirm_member_reactivation(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.revoke_member_qr(uuid) from public, anon;
-- L’ancienne RPC ne stockait qu’une empreinte et ne peut pas fournir un QR imprimable
-- sans laisser son jeton en clair au navigateur. Elle est remplacée par l’émission chiffrée.
revoke all on function public.rotate_member_qr_tokens(jsonb) from public, anon, authenticated;
grant execute on function public.complete_own_member_profile(text,text,integer,integer,text,text,text,text) to authenticated;
grant execute on function public.set_own_member_photo(text) to authenticated;
grant execute on function public.set_own_member_photo_consent(boolean) to authenticated;
grant execute on function public.submit_own_reactivation_profile() to authenticated;
grant execute on function public.start_member_reactivation(uuid) to authenticated;
grant execute on function public.issue_member_qr(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.confirm_member_reactivation(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.revoke_member_qr(uuid) to authenticated;

-- Les changements de profil et d’historique passent par les RPC validées ; empêcher les écritures directes
-- qui permettraient de contourner les contrôles de réactivation ou de réécrire l’historique.
drop policy if exists member_onboarding_admin_manage on public.member_onboarding;
drop policy if exists member_education_admin_manage on public.member_education_periods;
drop policy if exists private_details_admin_manage on public.member_private_details;
revoke insert, update, delete on public.member_onboarding from anon, authenticated;
revoke insert, update, delete on public.member_education_periods from anon, authenticated;
revoke insert, update, delete on public.member_private_details from anon, authenticated;
revoke update, delete on public.membership_periods from anon, authenticated;
revoke insert, update, delete on public.member_lifecycle_events from anon, authenticated;

-- Les enveloppes chiffrées ne sont jamais lisibles par une session utilisateur.
drop policy if exists qr_tokens_admin_only on public.member_qr_tokens;
revoke all on public.member_qr_tokens from anon, authenticated;
grant select, insert, update, delete on public.member_qr_tokens to service_role;
