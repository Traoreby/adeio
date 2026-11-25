-- Création intégrée Auth + fiche membre + rôle + dossier d'activation.
-- Requiert les migrations 003 et 004. Aucune donnée existante n'est supprimée.

alter table public.member_lifecycle_events
  drop constraint if exists member_lifecycle_events_event_type_check;
alter table public.member_lifecycle_events
  add constraint member_lifecycle_events_event_type_check
  check (event_type in ('member_created', 'profile_completed', 'archived', 'status_changed', 'reactivation_started', 'reactivated', 'qr_issued', 'qr_revoked', 'photo_updated'));

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
      and (
        not public.setting_enabled('member_lifecycle_enforced')
        or (m.exit_year is not null and m.exit_year > extract(year from (now() at time zone 'Asia/Kolkata'))::integer)
      )
  );
$$;
revoke all on function public.is_current_member() from public, anon;
grant execute on function public.is_current_member() to authenticated, anon;

create or replace function public.enable_member_lifecycle()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare incomplete_count bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Action réservée au super-administrateur.' using errcode = '42501';
  end if;
  select count(*) into incomplete_count
  from public.members m
  where m.status = 'active' and (m.exit_year is null or m.exit_year < m.joined_year)
    and not exists (
      select 1 from public.member_onboarding o
      where o.user_id = m.user_id and o.member_id = m.id
        and o.kind = 'new_member' and o.status = 'pending'
    );
  if incomplete_count > 0 then
    raise exception 'Complétez l’année de sortie des % fiche(s) active(s) avant d’activer l’archivage automatique.', incomplete_count using errcode = '23514';
  end if;
  insert into public.settings(key, value, updated_by)
  values ('member_lifecycle_enforced', '{"enabled":true}'::jsonb, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.enable_member_lifecycle() from public, anon;
grant execute on function public.enable_member_lifecycle() to authenticated;

create or replace function public.member_profile_visible_to_directory(p_member_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.is_current_member() and exists (
    select 1 from public.members m
    where m.id = p_member_id
      and (m.status = 'active' or public.setting_enabled('former_members_visibility'))
      and not exists (
        select 1 from public.member_onboarding o
        where o.user_id = m.user_id and o.member_id = m.id
          and o.kind = 'new_member' and o.status = 'pending'
      )
  );
$$;
revoke all on function public.member_profile_visible_to_directory(uuid) from public, anon;
grant execute on function public.member_profile_visible_to_directory(uuid) to authenticated;

-- Les fiches en attente restent visibles à leur propriétaire et à l'administration,
-- mais ne paraissent pas dans l'annuaire des membres déjà actifs.
drop policy if exists members_select_scoped on public.members;
create policy members_select_scoped on public.members for select to authenticated
  using (
    public.is_admin_user()
    or public.is_finance_staff()
    or user_id = auth.uid()
    or public.member_profile_visible_to_directory(id)
  );
drop policy if exists membership_periods_select_scoped on public.membership_periods;
drop policy if exists membership_periods_directory_filter_select on public.membership_periods;
create policy membership_periods_select_scoped on public.membership_periods for select to authenticated
  using (
    public.is_admin_user()
    or exists (select 1 from public.members m where m.id = member_id and m.user_id = auth.uid())
    or public.member_profile_visible_to_directory(member_id)
  );

create or replace function public.guard_active_member_exit_year()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active'
    and (new.exit_year is null or new.exit_year <= extract(year from (now() at time zone 'Asia/Kolkata'))::integer) then
    if new.exit_year is null and new.profile_completed_at is null and new.user_id is not null
      and exists (
        select 1 from public.member_onboarding o
        where o.user_id = new.user_id and o.kind = 'new_member' and o.status = 'pending'
      ) then
      return new;
    end if;
    raise exception 'Un membre actif doit avoir une année de sortie future.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.admin_register_member_invitation(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_joined_year integer,
  p_actor_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  member_uuid uuid;
  current_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
  existing_roles public.app_role[];
  generated_number text;
  generated_bytes bytea;
  attempt integer;
  char_index integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Cette opération doit être appelée par le serveur ADEIO.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if p_user_id is null or p_actor_id is null
    or length(trim(coalesce(p_first_name, ''))) not between 1 and 100
    or length(trim(coalesce(p_last_name, ''))) not between 1 and 100
    or p_joined_year not between 1900 and current_year
    or not exists (select 1 from auth.users u where u.id = p_user_id)
    or not exists (select 1 from public.user_roles r where r.user_id = p_actor_id and r.role in ('admin', 'super_admin')) then
    raise exception 'Les informations de création du membre sont invalides.' using errcode = '22023';
  end if;
  if exists (select 1 from public.members m where m.user_id = p_user_id) then
    raise exception 'Ce compte est déjà lié à une fiche membre.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.member_onboarding o where o.user_id = p_user_id
      and not (o.kind = 'new_member' and o.status = 'pending' and o.member_id is null)
  ) then
    raise exception 'Ce compte possède déjà un dossier lié ou une procédure de réactivation.' using errcode = '23505';
  end if;

  select array_agg(r.role) into existing_roles from public.user_roles r where r.user_id = p_user_id;
  if exists (select 1 from unnest(coalesce(existing_roles, array[]::public.app_role[])) as r(role) where role <> 'member') then
    raise exception 'Un compte doté d’un rôle sensible ne peut pas être rattaché comme nouveau membre.' using errcode = '42501';
  end if;

  -- Le dossier temporaire permet au garde-fou d'accepter une fiche en attente
  -- dont l'année de sortie sera renseignée par le membre après activation.
  insert into public.member_onboarding(user_id, kind, status, initiated_by)
    values (p_user_id, 'new_member', 'pending', p_actor_id)
    on conflict (user_id) do update set initiated_by = excluded.initiated_by, updated_at = now();

  insert into public.user_roles(user_id, role) values (p_user_id, 'member') on conflict (user_id, role) do nothing;
  for attempt in 1..32 loop
    generated_bytes := extensions.gen_random_bytes(4);
    generated_number := 'ADEIO-' || p_joined_year::text || '-';
    for char_index in 0..3 loop
      generated_number := generated_number || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', (get_byte(generated_bytes, char_index) % 36) + 1, 1);
    end loop;
    insert into public.members(user_id, member_number, first_name, last_name, joined_year, status, created_by)
      values (p_user_id, generated_number, trim(p_first_name), trim(p_last_name), p_joined_year, 'active', p_actor_id)
      on conflict (member_number) do nothing
      returning id into member_uuid;
    exit when member_uuid is not null;
  end loop;
  if member_uuid is null then raise exception 'Un numéro ADEIO unique n’a pas pu être attribué.' using errcode = '54000'; end if;
  insert into public.membership_periods(member_id, starts_on, created_by)
    values (member_uuid, make_date(p_joined_year, 1, 1), p_actor_id);
  update public.member_onboarding set member_id = member_uuid, updated_at = now() where user_id = p_user_id;
  insert into public.member_lifecycle_events(member_id, event_type, actor_id, details)
    values (member_uuid, 'member_created', p_actor_id, jsonb_build_object('member_number', generated_number));
  return member_uuid;
end;
$$;
revoke all on function public.admin_register_member_invitation(uuid,text,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.admin_register_member_invitation(uuid,text,text,integer,uuid) to service_role;

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
    or p_exit_year not between current_year + 1 and 2200
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
      and public.setting_enabled('member_lifecycle_enforced')
      and (member_row.exit_year is null or member_row.exit_year <= current_year) then
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
        on conflict (member_number) do nothing
        returning id into member_uuid;
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
