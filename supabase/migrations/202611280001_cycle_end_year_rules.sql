-- Règle métier ADEIO : exit_year est la dernière année active (incluse).
-- L'adhésion et la carte expirent le 31 décembre; les accès sont coupés dès
-- le 1er janvier suivant. Aucune donnée existante n'est convertie ici.

comment on column public.members.exit_year is
  'Dernière année d’activité inclusive; accès jusqu’au 31 décembre, archivage à partir du 1er janvier suivant. Les données historiques ne sont pas converties automatiquement.';

create or replace function public.is_current_member()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and not exists (
        select 1 from public.member_onboarding o
        where o.user_id = m.user_id and o.member_id = m.id
          and o.kind = 'new_member' and o.status = 'pending'
      )
      and m.exit_year is not null
      and m.exit_year >= extract(year from (now() at time zone 'Asia/Kolkata'))::integer
  );
$$;
revoke all on function public.is_current_member() from public, anon;
grant execute on function public.is_current_member() to authenticated, anon;

create or replace function public.guard_active_member_exit_year()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active'
    and (new.exit_year is null or new.exit_year < extract(year from (now() at time zone 'Asia/Kolkata'))::integer) then
    if new.exit_year is null and new.profile_completed_at is null and new.user_id is not null
      and exists (
        select 1 from public.member_onboarding o
        where o.user_id = new.user_id and o.kind = 'new_member' and o.status = 'pending'
      ) then
      return new;
    end if;
    raise exception 'Un membre actif doit avoir une année de fin de cycle égale ou postérieure à l’année en cours.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_approved_member_year_changes()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if (new.joined_year is distinct from old.joined_year or new.exit_year is distinct from old.exit_year)
    and public.is_admin_user() then
    if not public.is_super_admin() then
      raise exception 'Seul le Super Admin peut corriger les années du membre.' using errcode = '42501';
    end if;
    if current_setting('adeio.review_member_card_id', true) is distinct from old.id::text then
      raise exception 'Corrigez les années depuis l’action « Valider les informations ».' using errcode = '42501';
    end if;
  end if;
  if (new.joined_year is distinct from old.joined_year or new.exit_year is distinct from old.exit_year)
    and old.user_id = auth.uid()
    and not public.is_admin_user()
    and exists (
      select 1 from public.member_card_reviews r
      where r.member_id = old.id and r.review_status = 'approved' and r.approved_at is not null
    ) then
    raise exception 'Les années validées ne peuvent plus être modifiées par le membre. Contactez l’administration.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

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
    or (p_status = 'active' and p_exit_year < current_year)
    or p_sex not in ('female', 'male', 'other', 'prefer_not_to_say') then
    raise exception 'Les informations du membre sont invalides ou incomplètes.' using errcode = '22023';
  end if;
  if p_user_id is not null and exists (
    select 1 from public.member_onboarding o where o.user_id = p_user_id
      and (o.kind = 'reactivation' or o.member_id is not null)
  ) then raise exception 'Ce compte est déjà lié à une fiche ou à une procédure de réactivation.' using errcode = '23505'; end if;

  start_date := make_date(p_joined_year, 1, 1);
  end_date := case when p_status = 'active' then null else greatest(start_date, make_date(p_exit_year, 12, 31)) end;
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
  if p_exit_year is distinct from member_row.exit_year and not public.is_super_admin() then
    raise exception 'Seul le Super Admin peut corriger l’année de fin de cycle.' using errcode = '42501';
  end if;
  if p_exit_year is null or p_status is null or p_sex is null
    or p_exit_year < member_row.joined_year or p_exit_year > 2200
    or (p_status = 'active' and p_exit_year < current_year)
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

create or replace function public.complete_own_member_profile(
  p_first_name text, p_last_name text, p_joined_year integer, p_exit_year integer,
  p_study_program text, p_institution text, p_phone text, p_sex text
)
returns uuid
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  caller_id uuid := auth.uid();
  member_row public.members%rowtype;
  member_uuid uuid;
  onboarding_row public.member_onboarding%rowtype;
  current_education public.member_education_periods%rowtype;
  generated_number text;
  attempt integer;
  current_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
  is_initial_completion boolean := false;
  is_reactivation boolean := false;
begin
  if caller_id is null or not public.current_user_has_role('member'::public.app_role) then
    raise exception 'Accès réservé au membre connecté.' using errcode = '42501';
  end if;
  if p_joined_year is null or p_exit_year is null
    or length(trim(coalesce(p_first_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_last_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_study_program, ''))) not between 2 and 160
    or length(trim(coalesce(p_institution, ''))) not between 2 and 200
    or length(trim(coalesce(p_phone, ''))) not between 6 and 40
    or p_joined_year not between 1900 and current_year
    or p_exit_year not between current_year and 2200
    or p_exit_year < p_joined_year
    or (p_sex is not null and p_sex not in ('female', 'male')) then
    raise exception 'Les informations du profil sont invalides ou incomplètes.' using errcode = '22023';
  end if;

  select * into onboarding_row from public.member_onboarding where user_id = caller_id for update;
  select * into member_row from public.members where user_id = caller_id for update;
  if found then
    member_uuid := member_row.id;
    is_initial_completion := member_row.profile_completed_at is null
      and onboarding_row.kind = 'new_member' and onboarding_row.status = 'pending'
      and onboarding_row.member_id = member_row.id;
    is_reactivation := member_row.status = 'former'
      and onboarding_row.kind = 'reactivation' and onboarding_row.status = 'pending'
      and onboarding_row.member_id = member_row.id;
    if not is_initial_completion and not is_reactivation and member_row.status <> 'active' then
      raise exception 'Une réactivation administrative est nécessaire.' using errcode = '42501';
    end if;
    if (is_initial_completion or is_reactivation) and p_sex is null then
      raise exception 'Choisissez Homme ou Femme pour compléter ce dossier.' using errcode = '22023';
    end if;
    if not is_initial_completion and not is_reactivation and member_row.status = 'active'
      and (member_row.exit_year is null or member_row.exit_year < current_year) then
      raise exception 'La période active est arrivée à échéance ; contactez l’administration.' using errcode = '42501';
    end if;
    if member_row.joined_year <> p_joined_year then
      raise exception 'L’année et le numéro de première adhésion sont conservés définitivement.' using errcode = '22023';
    end if;
    update public.members
      set first_name = trim(p_first_name), last_name = trim(p_last_name), exit_year = p_exit_year,
          profile_completed_at = case when is_initial_completion then now() else coalesce(profile_completed_at, now()) end
      where id = member_uuid;
    if is_initial_completion then
      update public.member_onboarding set status = 'completed', profile_submitted_at = now(), updated_at = now()
        where user_id = caller_id;
      insert into public.member_lifecycle_events(member_id, event_type, actor_id)
        values (member_uuid, 'profile_completed', caller_id);
    end if;
  else
    if onboarding_row.kind is distinct from 'new_member' or onboarding_row.status is distinct from 'pending'
      or onboarding_row.member_id is not null then
      raise exception 'Aucun dossier d’adhésion en attente n’est associé à ce compte.' using errcode = '42501';
    end if;
    if p_sex is null then raise exception 'Choisissez Homme ou Femme pour compléter ce dossier.' using errcode = '22023'; end if;
    for attempt in 1..12 loop
      generated_number := 'ADEIO-' || p_joined_year::text || '-' || upper(substr(encode(extensions.gen_random_bytes(3), 'hex'), 1, 4));
      insert into public.members(user_id, member_number, first_name, last_name, joined_year, exit_year, status, profile_completed_at, created_by)
        values (caller_id, generated_number, trim(p_first_name), trim(p_last_name), p_joined_year, p_exit_year, 'active', now(), caller_id)
        on conflict (member_number) do nothing returning id into member_uuid;
      exit when member_uuid is not null;
    end loop;
    if member_uuid is null then raise exception 'Un numéro ADEIO unique n’a pas pu être généré.' using errcode = '23505'; end if;
    insert into public.membership_periods(member_id, starts_on, created_by)
      values (member_uuid, make_date(p_joined_year, 1, 1), caller_id);
    update public.member_onboarding set member_id = member_uuid, status = 'completed', profile_submitted_at = now(), updated_at = now()
      where user_id = caller_id;
    insert into public.member_lifecycle_events(member_id, event_type, actor_id)
      values (member_uuid, 'profile_completed', caller_id);
  end if;

  insert into public.member_private_details(member_id, phone, sex)
    values (member_uuid, trim(p_phone), p_sex)
    on conflict (member_id) do update set phone = excluded.phone, sex = coalesce(excluded.sex, public.member_private_details.sex), updated_at = now();

  select * into current_education from public.member_education_periods
    where member_id = member_uuid and is_current for update;
  if found and (current_education.study_program <> trim(p_study_program) or current_education.institution <> trim(p_institution)) then
    update public.member_education_periods set ends_on = greatest(starts_on, (now() at time zone 'Asia/Kolkata')::date - 1), is_current = false
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
revoke all on function public.complete_own_member_profile(text,text,integer,integer,text,text,text,text) from public, anon;
grant execute on function public.complete_own_member_profile(text,text,integer,integer,text,text,text,text) to authenticated;

create or replace function public.track_membership_period_end_provenance()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare member_exit_year integer;
begin
  if tg_op = 'UPDATE' and new.ends_on is distinct from old.ends_on
     and new.ends_on_confirmed_at is not distinct from old.ends_on_confirmed_at then
    new.ends_on_confirmed_at := null;
    new.ends_on_confirmed_by := null;
  end if;
  if current_setting('adeio.sync_cycle_period', true) = new.member_id::text then
    select m.exit_year into member_exit_year from public.members m where m.id = new.member_id;
    if member_exit_year is null or new.ends_on is distinct from make_date(member_exit_year, 12, 31)
      or new.ends_on_confirmed_at is not null or new.ends_on_confirmed_by is not null then
      raise exception 'La période doit se terminer le 31 décembre de la dernière année active.' using errcode = '23514';
    end if;
    new.ends_on_source := 'derived_exit_year';
  elsif new.ends_on_confirmed_at is not null and new.ends_on_confirmed_by is not null then
    if not public.is_super_admin() then
      raise exception 'Seul le Super Admin peut confirmer la fin d’une période d’adhésion.' using errcode = '42501';
    end if;
    new.ends_on_source := 'admin_confirmed';
  elsif new.ends_on is null then
    new.ends_on_source := 'unconfirmed';
  else
    new.ends_on_source := 'unconfirmed';
  end if;
  return new;
end;
$$;

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
  if tg_table_name = 'membership_periods'
    and current_setting('adeio.sync_cycle_period', true) = member_key::text
    and (public.is_admin_user() or coalesce(auth.jwt() ->> 'role', '') = 'service_role')
    and new.member_id = old.member_id
    and new.starts_on = old.starts_on
    and new.note is not distinct from old.note
    and new.created_by is not distinct from old.created_by
    and new.created_at = old.created_at
    and new.ends_on is not null
    and old.id = (select p.id from public.membership_periods p where p.member_id = member_key order by p.starts_on desc, p.created_at desc limit 1) then
    return new;
  end if;
  if tg_table_name = 'member_education_periods' then
    if tg_op = 'DELETE' then raise exception 'L’historique des formations est conservé.' using errcode = '55000'; end if;
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
  if tg_op = 'DELETE' then raise exception 'L’historique des adhésions est conservé.' using errcode = '55000'; end if;
  if old.member_id is distinct from new.member_id
    or old.starts_on is distinct from new.starts_on
    or old.note is distinct from new.note
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at
    or new.ends_on is null
    or (old.ends_on is not null and new.ends_on >= old.ends_on) then
    raise exception 'Une période d’adhésion ne peut être supprimée ou réécrite ; seule sa clôture ou sa synchronisation de cycle validée est autorisée.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.review_member_card(
  p_member_id uuid, p_decision text, p_joined_year integer, p_exit_year integer, p_comment text default null
)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  member_row public.members%rowtype;
  period_row public.membership_periods%rowtype;
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_super_admin() then raise exception 'Action réservée au Super Admin.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.mfa_enabled
      and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2') then
    raise exception 'Validez votre authentification à deux facteurs.' using errcode = '42501';
  end if;
  if p_decision is distinct from 'approved' then
    raise exception 'Seule la validation des informations est disponible.' using errcode = '22023';
  end if;
  if p_joined_year is null or p_exit_year is null or p_joined_year < 1900
    or p_joined_year > extract(year from local_date)::integer
    or p_exit_year < greatest(p_joined_year, extract(year from local_date)::integer) or p_exit_year > 2200 then
    raise exception 'Les années doivent être renseignées et cohérentes avec un cycle encore actif.' using errcode = '23514';
  end if;
  select * into member_row from public.members where id = p_member_id for update;
  if not found then raise exception 'Membre introuvable.' using errcode = 'P0002'; end if;
  if member_row.status <> 'active' then raise exception 'Un membre archivé ne peut pas être validé pour une carte active.' using errcode = '23514'; end if;

  select * into period_row from public.membership_periods
    where member_id = p_member_id and starts_on <= local_date
    order by starts_on desc, created_at desc limit 1 for update;
  if not found then raise exception 'Aucune période d’adhésion existante ne peut être synchronisée. Aucune période artificielle n’a été créée.' using errcode = '23514'; end if;
  if period_row.starts_on > make_date(p_exit_year, 12, 31) then
    raise exception 'Le début de la période est postérieur à la fin calculée du cycle.' using errcode = '23514';
  end if;

  perform set_config('adeio.review_member_card_id', p_member_id::text, true);
  update public.members set joined_year = p_joined_year, exit_year = p_exit_year where id = p_member_id;
  perform set_config('adeio.sync_cycle_period', p_member_id::text, true);
  update public.membership_periods set ends_on = make_date(p_exit_year, 12, 31),
    ends_on_confirmed_at = null, ends_on_confirmed_by = null
    where id = period_row.id;

  insert into public.member_card_reviews(
    member_id, review_status, review_comment, reviewed_by, reviewed_at, approved_at, updated_at
  ) values (p_member_id, 'approved', null, auth.uid(), now(), now(), now())
  on conflict (member_id) do update set review_status = 'approved', review_comment = null,
    reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
    approved_at = excluded.approved_at, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.confirm_membership_period_end(p_period_id uuid, p_ends_on date)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then raise exception 'Action réservée au Super Admin.' using errcode = '42501'; end if;
  raise exception 'La date de fin est calculée automatiquement au 31 décembre de l’année de fin de cycle.' using errcode = '0A000';
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
    and m.exit_year >= extract(year from (now() at time zone 'Asia/Kolkata'))::integer
    and not m.reactivation_photo_required for update;
  if not found then raise exception 'Seule une fiche active dont le cycle est en cours peut recevoir un QR.' using errcode = '23514'; end if;
  update public.member_qr_tokens set revoked_at = coalesce(revoked_at, now()) where member_id = p_member_id and revoked_at is null;
  insert into public.member_qr_tokens(member_id, token_hash, encrypted_token, encryption_nonce, encryption_tag, encryption_key_version, created_by)
    values (p_member_id, p_token_hash, p_encrypted_token, p_nonce, p_tag, p_key_version, auth.uid());
  insert into public.member_lifecycle_events(member_id, event_type, actor_id) values (p_member_id, 'qr_issued', auth.uid());
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
  if member_row.photo_updated_by is distinct from auth.uid()
    or member_row.photo_updated_at is null
    or member_row.photo_updated_at <= coalesce(member_row.archived_at, '-infinity'::timestamptz) then
    raise exception 'Une nouvelle photo est obligatoire pour la réactivation.' using errcode = '23514';
  end if;
  if member_row.exit_year is null or member_row.exit_year < extract(year from (now() at time zone 'Asia/Kolkata'))::integer then
    raise exception 'L’année de fin de cycle doit être égale ou postérieure à l’année en cours.' using errcode = '23514';
  end if;
  update public.member_onboarding set status = 'profile_submitted', profile_submitted_at = now(), updated_at = now()
    where user_id = auth.uid() and member_id = member_row.id and kind = 'reactivation' and status = 'pending';
  if not found then raise exception 'Aucune demande de réactivation en attente.' using errcode = '42501'; end if;
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
  cycle_end date;
  current_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
begin
  if not public.is_admin_user() then raise exception 'Action réservée à l’administration.' using errcode = '42501'; end if;
  select * into member_row from public.members where id = p_member_id and status = 'former' for update;
  if not found then raise exception 'Le membre n’est plus archivé.' using errcode = 'P0002'; end if;
  if member_row.exit_year is null or member_row.exit_year < current_year
    or member_row.photo_path is null
    or member_row.photo_updated_at is null
    or member_row.photo_updated_at <= coalesce(member_row.archived_at, '-infinity'::timestamptz)
    or not exists (select 1 from public.member_onboarding o where o.member_id = p_member_id and o.user_id = member_row.user_id and o.kind = 'reactivation' and o.status = 'profile_submitted')
    or not exists (select 1 from public.member_education_periods e where e.member_id = p_member_id and e.is_current) then
    raise exception 'Profil incomplet : une nouvelle photo, une formation et une année de fin de cycle valide sont requises.' using errcode = '23514';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or length(p_encrypted_token) > 512 or length(p_nonce) > 128 or length(p_tag) > 128 or length(p_key_version) > 32 then
    raise exception 'Données de jeton invalides.' using errcode = '22023';
  end if;
  linked_user := member_row.user_id;
  cycle_end := make_date(member_row.exit_year, 12, 31);
  if cycle_end < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Le cycle est déjà terminé. Choisissez une année de fin de cycle actuelle ou future.' using errcode = '23514';
  end if;
  perform set_config('adeio.sync_cycle_period', p_member_id::text, true);
  insert into public.membership_periods(member_id, starts_on, ends_on, created_by)
    values (p_member_id, (now() at time zone 'Asia/Kolkata')::date, cycle_end, auth.uid());
  perform set_config('adeio.reactivating_member_id', p_member_id::text, true);
  update public.members set status = 'active', archived_at = null, reactivation_photo_required = false,
    profile_completed_at = coalesce(profile_completed_at, now()) where id = p_member_id;
  update public.member_qr_tokens set revoked_at = coalesce(revoked_at, now()) where member_id = p_member_id and revoked_at is null;
  insert into public.member_qr_tokens(member_id, token_hash, encrypted_token, encryption_nonce, encryption_tag, encryption_key_version, created_by)
    values (p_member_id, p_token_hash, p_encrypted_token, p_nonce, p_tag, p_key_version, auth.uid());
  update public.member_onboarding set status = 'completed', updated_at = now()
    where user_id = linked_user and member_id = p_member_id and kind = 'reactivation';
  insert into public.member_lifecycle_events(member_id, event_type, actor_id, details)
    values (p_member_id, 'reactivated', auth.uid(), jsonb_build_object('member_number', member_row.member_number));
  insert into public.member_lifecycle_events(member_id, event_type, actor_id) values (p_member_id, 'qr_issued', auth.uid());
end;
$$;

create or replace function public.revoke_member_qr_on_inactive()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare close_date date;
begin
  if old.status = 'active' and new.status <> 'active' then
    new.archived_at := coalesce(new.archived_at, now());
    if new.status = 'former' then new.reactivation_photo_required := true; end if;
    close_date := case
      when new.exit_year is not null and new.exit_year < extract(year from (now() at time zone 'Asia/Kolkata'))::integer
        then make_date(new.exit_year, 12, 31)
      else (now() at time zone 'Asia/Kolkata')::date - 1
    end;
    if new.exit_year is not null and new.exit_year < extract(year from (now() at time zone 'Asia/Kolkata'))::integer then
      perform set_config('adeio.sync_cycle_period', new.id::text, true);
    else
      perform set_config('adeio.sync_cycle_period', '', true);
    end if;
    update public.membership_periods mp set ends_on = greatest(mp.starts_on, close_date),
      ends_on_confirmed_at = null, ends_on_confirmed_by = null
      where mp.id = (select candidate.id from public.membership_periods candidate
        where candidate.member_id = new.id order by candidate.starts_on desc, candidate.created_at desc limit 1)
        and (mp.ends_on is null or mp.ends_on is distinct from greatest(mp.starts_on, close_date));
    update public.member_education_periods ep set ends_on = greatest(ep.starts_on, close_date), is_current = false
      where ep.member_id = new.id and ep.is_current;
    update public.member_qr_tokens set revoked_at = coalesce(revoked_at, now())
      where member_id = new.id and revoked_at is null;
    insert into public.member_lifecycle_events(member_id, event_type, actor_id, details)
      values (new.id, case when new.status = 'former' then 'archived' else 'status_changed' end, auth.uid(), jsonb_build_object('previous_status', old.status, 'status', new.status, 'exit_year', new.exit_year));
  end if;
  if old.photo_path is distinct from new.photo_path then
    new.photo_updated_at := now();
    new.photo_updated_by := auth.uid();
    insert into public.member_lifecycle_events(member_id, event_type, actor_id) values (new.id, 'photo_updated', auth.uid());
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
  for member_row in
    select id, exit_year from public.members
    where status = 'active' and exit_year < cutoff_year
    order by exit_year, id for update
  loop
    cutoff_date := make_date(member_row.exit_year, 12, 31);
    perform set_config('adeio.sync_cycle_period', member_row.id::text, true);
    update public.membership_periods mp set ends_on = greatest(mp.starts_on, cutoff_date),
      ends_on_confirmed_at = null, ends_on_confirmed_by = null
      where mp.id = (select candidate.id from public.membership_periods candidate
        where candidate.member_id = member_row.id order by candidate.starts_on desc, candidate.created_at desc limit 1)
        and (mp.ends_on is null or mp.ends_on is distinct from greatest(mp.starts_on, cutoff_date));
    update public.member_education_periods ep set ends_on = greatest(ep.starts_on, cutoff_date), is_current = false
      where ep.member_id = member_row.id and ep.is_current;
    update public.members set status = 'former', archived_at = now()
      where id = member_row.id and status = 'active';
    if found then archived_count := archived_count + 1; end if;
  end loop;
  return archived_count;
end;
$$;
revoke all on function public.archive_expired_members() from public, anon;
grant execute on function public.archive_expired_members() to authenticated, service_role;

create or replace function public.issue_member_cards(p_member_ids uuid[])
returns table(issuance_id uuid)
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  target_id uuid;
  member_row public.members%rowtype;
  period_row public.membership_periods%rowtype;
  review_row public.member_card_reviews%rowtype;
  qr_row public.member_qr_tokens%rowtype;
  education_row public.member_education_periods%rowtype;
  signature_row public.member_card_official_assets%rowtype;
  seal_row public.member_card_official_assets%rowtype;
  local_date date := (now() at time zone 'Asia/Kolkata')::date;
  current_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
  issued_id uuid;
  snapshot jsonb;
begin
  if not public.is_super_admin() then raise exception 'La délivrance des cartes est réservée au Super Admin.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.mfa_enabled
      and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2') then
    raise exception 'Validez votre authentification à deux facteurs.' using errcode = '42501';
  end if;
  if p_member_ids is null or cardinality(p_member_ids) < 1 or cardinality(p_member_ids) > 100
    or cardinality(p_member_ids) <> (select count(distinct x) from unnest(p_member_ids) x) then
    raise exception 'Sélection de membres invalide (100 maximum, sans doublons).' using errcode = '22023';
  end if;
  select * into signature_row from public.member_card_official_assets where asset_kind = 'signature' and is_current;
  if not found then raise exception 'La signature officielle doit être configurée.' using errcode = '23514'; end if;
  select * into seal_row from public.member_card_official_assets where asset_kind = 'seal' and is_current;
  if not found then raise exception 'Le cachet officiel doit être configuré.' using errcode = '23514'; end if;

  for target_id in select unnest(p_member_ids) loop
    select * into member_row from public.members where id = target_id for update;
    if not found then raise exception 'Membre introuvable.' using errcode = 'P0002'; end if;
    if member_row.status <> 'active' or member_row.reactivation_photo_required
      or member_row.joined_year is null or member_row.exit_year is null
      or member_row.exit_year < current_year or member_row.photo_path is null or member_row.profile_completed_at is null then
      raise exception 'Le profil doit être complet et actif, avec une photo et une année de fin de cycle non dépassée.' using errcode = '23514';
    end if;
    select * into review_row from public.member_card_reviews
      where member_id = target_id and review_status = 'approved' and approved_at is not null;
    if not found then raise exception 'Les informations de ce membre doivent être validées par le Super Admin.' using errcode = '23514'; end if;
    select * into period_row from public.membership_periods
      where member_id = target_id and starts_on <= local_date
      order by starts_on desc, created_at desc limit 1 for update;
    if not found then raise exception 'Aucune période d’adhésion existante n’est enregistrée.' using errcode = '23514'; end if;
    if period_row.ends_on is distinct from make_date(member_row.exit_year, 12, 31) then
      raise exception 'La période doit être synchronisée par la validation Super Admin avant la délivrance.' using errcode = '23514';
    end if;
    if period_row.ends_on < local_date or member_row.exit_year < current_year then
      raise exception 'Le cycle est terminé ; aucune nouvelle carte ne peut être délivrée.' using errcode = '23514';
    end if;
    select * into education_row from public.member_education_periods where member_id = target_id and is_current limit 1;
    if not found then raise exception 'La formation actuelle du membre doit être renseignée.' using errcode = '23514'; end if;
    select * into qr_row from public.member_qr_tokens where member_id = target_id and revoked_at is null order by created_at desc limit 1;
    if not found or qr_row.encrypted_token is null or qr_row.encryption_nonce is null
      or qr_row.encryption_tag is null or qr_row.encryption_key_version is null then
      raise exception 'Un QR actif compatible doit être émis explicitement avant la carte.' using errcode = '23514';
    end if;
    select ci.id into issued_id from public.member_card_issuances ci
      where ci.qr_token_id = qr_row.id and ci.member_id = target_id and ci.membership_period_id = period_row.id
        and ci.review_approved_at = review_row.approved_at
        and ci.signature_asset_id = signature_row.id and ci.seal_asset_id = seal_row.id;
    if found then issuance_id := issued_id; return next; continue; end if;
    snapshot := jsonb_build_object(
      'first_name', member_row.first_name, 'last_name', member_row.last_name, 'member_number', member_row.member_number,
      'joined_year', member_row.joined_year, 'study_program', education_row.study_program, 'institution', education_row.institution,
      'status', 'MEMBRE ACTIF', 'photo_path', member_row.photo_path, 'issued_on', local_date,
      'valid_until', period_row.ends_on, 'association', 'Association des Étudiants Ivoiriens de l’Odisha', 'site_url', 'https://adeio.vercel.app'
    );
    issued_id := null;
    insert into public.member_card_issuances(
      member_id, membership_period_id, qr_token_id, review_approved_at, signature_asset_id, seal_asset_id,
      signature_storage_path, seal_storage_path, issued_by, issued_on, valid_until, member_snapshot
    ) values (target_id, period_row.id, qr_row.id, review_row.approved_at, signature_row.id, seal_row.id,
      signature_row.storage_path, seal_row.storage_path, auth.uid(), local_date, period_row.ends_on, snapshot)
    on conflict on constraint member_card_issuance_idempotency_key do nothing returning id into issued_id;
    if issued_id is null then
      select ci.id into issued_id from public.member_card_issuances ci
        where ci.member_id = target_id and ci.membership_period_id = period_row.id and ci.qr_token_id = qr_row.id
          and ci.review_approved_at = review_row.approved_at and ci.signature_asset_id = signature_row.id and ci.seal_asset_id = seal_row.id;
    end if;
    issuance_id := issued_id;
    return next;
  end loop;
end;
$$;

create or replace function public.verify_member_qr(p_token text)
returns table(member_number text, full_name text, status text, "position" text, photo_path text)
language sql stable security definer
set search_path = public, extensions
as $$
  select m.member_number, concat_ws(' ', m.first_name, m.last_name) as full_name,
    case
      when m.status = 'active'
        and m.exit_year >= extract(year from (now() at time zone 'Asia/Kolkata'))::integer
        and (now() at time zone 'Asia/Kolkata')::date <= make_date(m.exit_year, 12, 31) then 'actif'
      when m.status = 'former' then 'ancien'
      else 'non_actif'
    end as status,
    ep.title as "position",
    case when m.photo_public_consent then m.photo_path else null end as photo_path
  from public.member_qr_tokens q
  join public.members m on m.id = q.member_id
  left join public.executive_members em on em.member_id = m.id
  left join public.executive_terms et on et.id = em.term_id and et.is_current
  left join public.executive_positions ep on ep.id = em.position_id
  where p_token ~ '^[0-9a-fA-F]{64}$'
    and q.token_hash = encode(extensions.digest(convert_to(lower(p_token), 'UTF8'), 'sha256'), 'hex')
    and q.revoked_at is null
  limit 1;
$$;

revoke all on function public.verify_member_qr(text) from public;
grant execute on function public.verify_member_qr(text) to anon, authenticated;
