-- Fondations non destructives du cycle de vie des membres.
-- Aucun compte, rôle, membre, historique ou jeton existant n'est supprimé.

alter table public.members
  add column if not exists exit_year integer,
  add column if not exists profile_completed_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists photo_updated_at timestamptz,
  add column if not exists photo_updated_by uuid references auth.users(id) on delete set null;

alter table public.members
  add constraint members_exit_year_range_check
    check (exit_year is null or exit_year between 1900 and 2200) not valid;
alter table public.members
  add constraint members_exit_year_after_join_check
    check (exit_year is null or exit_year >= joined_year) not valid;
alter table public.members
  add constraint members_completed_exit_year_check
    check (profile_completed_at is null or exit_year is not null) not valid;

alter table public.member_private_details
  add column if not exists sex text;
alter table public.member_private_details
  add constraint member_private_details_sex_check
    check (sex is null or sex in ('female', 'male', 'other', 'prefer_not_to_say')) not valid;

create table public.member_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id uuid unique references public.members(id) on delete restrict,
  kind text not null default 'new_member' check (kind in ('new_member', 'reactivation')),
  status text not null default 'pending' check (status in ('pending', 'profile_submitted')),
  initiated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  profile_submitted_at timestamptz,
  check ((status = 'pending' and profile_submitted_at is null) or (status = 'profile_submitted' and profile_submitted_at is not null))
);
create index member_onboarding_status_created_idx on public.member_onboarding(status, created_at desc);

create table public.member_education_periods (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  study_program text not null check (length(trim(study_program)) between 2 and 160),
  institution text not null check (length(trim(institution)) between 2 and 200),
  starts_on date not null,
  ends_on date,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (ends_on is null or ends_on >= starts_on),
  check (is_current = (ends_on is null))
);
create unique index member_education_one_current_idx on public.member_education_periods(member_id) where is_current;
create index member_education_member_dates_idx on public.member_education_periods(member_id, starts_on desc);

create table public.member_lifecycle_events (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members(id) on delete restrict,
  event_type text not null check (event_type in ('profile_completed', 'archived', 'status_changed', 'reactivation_started', 'reactivated', 'qr_issued', 'qr_revoked', 'photo_updated')),
  actor_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index member_lifecycle_events_member_created_idx on public.member_lifecycle_events(member_id, created_at desc);

alter table public.member_onboarding enable row level security;
alter table public.member_education_periods enable row level security;
alter table public.member_lifecycle_events enable row level security;

create policy member_onboarding_owner_or_admin_read on public.member_onboarding for select to authenticated
  using (user_id = auth.uid() or public.is_admin_user());
create policy member_onboarding_admin_manage on public.member_onboarding for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

create policy member_education_owner_or_admin_read on public.member_education_periods for select to authenticated
  using (public.is_admin_user() or exists (
    select 1 from public.members m where m.id = member_id and m.user_id = auth.uid()
  ));
create policy member_education_admin_manage on public.member_education_periods for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

create policy member_lifecycle_super_admin_read on public.member_lifecycle_events for select to authenticated
  using (public.is_super_admin());

-- Le réglage reste désactivé tant que l'administration n'a pas complété les années de sortie manquantes.
insert into public.settings(key, value)
values ('member_lifecycle_enforced', '{"enabled":false}'::jsonb)
on conflict (key) do nothing;

drop policy if exists settings_admin_manage on public.settings;
create policy settings_admin_manage on public.settings for all to authenticated
  using (public.is_admin_user() and key <> 'member_lifecycle_enforced')
  with check (public.is_admin_user() and key <> 'member_lifecycle_enforced');
create policy settings_lifecycle_super_admin_manage on public.settings for all to authenticated
  using (key = 'member_lifecycle_enforced' and public.is_super_admin())
  with check (key = 'member_lifecycle_enforced' and public.is_super_admin());

create or replace function public.is_current_member()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and (
        not public.setting_enabled('member_lifecycle_enforced')
        or (m.exit_year is not null and m.exit_year > extract(year from (now() at time zone 'Asia/Kolkata'))::integer)
      )
  );
$$;

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
  from public.members
  where status = 'active' and (exit_year is null or exit_year < joined_year);
  if incomplete_count > 0 then
    raise exception 'Complétez l’année de sortie des % fiche(s) active(s) avant d’activer l’archivage automatique.', incomplete_count using errcode = '23514';
  end if;
  insert into public.settings(key, value, updated_by)
  values ('member_lifecycle_enforced', '{"enabled":true}'::jsonb, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

create or replace function public.revoke_member_qr_on_inactive()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    new.archived_at := coalesce(new.archived_at, now());
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
create trigger members_lifecycle_and_photo_guard
  before update of status, photo_path on public.members
  for each row execute function public.revoke_member_qr_on_inactive();

create or replace function public.archive_expired_members()
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  archived_count integer;
  cutoff_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::integer;
  cutoff_date date := make_date(cutoff_year, 1, 1) - 1;
begin
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Action réservée au super-administrateur.' using errcode = '42501';
  end if;
  if not public.setting_enabled('member_lifecycle_enforced') then
    return 0;
  end if;

  -- Fermer les périodes au dernier jour précédant l'année de sortie.
  update public.membership_periods mp
    set ends_on = greatest(mp.starts_on, cutoff_date)
    from public.members m
    where mp.member_id = m.id and m.status = 'active'
      and m.exit_year <= cutoff_year and mp.ends_on is null;

  update public.member_education_periods ep
    set ends_on = greatest(ep.starts_on, cutoff_date), is_current = false
    from public.members m
    where ep.member_id = m.id and ep.is_current
      and m.status = 'active' and m.exit_year <= cutoff_year;

  update public.members
    set status = 'former', archived_at = now()
    where status = 'active' and exit_year <= cutoff_year;
  get diagnostics archived_count = row_count;
  return archived_count;
end;
$$;

revoke all on function public.is_current_member() from public, anon;
revoke all on function public.enable_member_lifecycle() from public, anon;
revoke all on function public.archive_expired_members() from public, anon;
grant execute on function public.is_current_member() to authenticated;
grant execute on function public.is_current_member() to anon;
grant execute on function public.enable_member_lifecycle() to authenticated;
grant execute on function public.archive_expired_members() to authenticated, service_role;

-- Les permissions de rôles ne changent pas ; seules les fonctions d'adhésion active évoluent.
drop policy if exists members_select_scoped on public.members;
create policy members_select_scoped on public.members for select to authenticated
  using (
    public.is_admin_user()
    or public.is_finance_staff()
    or user_id = auth.uid()
    or (public.is_current_member() and (status = 'active' or public.setting_enabled('former_members_visibility')))
  );

drop policy if exists membership_periods_select_scoped on public.membership_periods;
drop policy if exists membership_periods_directory_filter_select on public.membership_periods;
create policy membership_periods_select_scoped on public.membership_periods for select to authenticated
  using (
    public.is_admin_user()
    or exists (select 1 from public.members m where m.id = member_id and m.user_id = auth.uid())
    or (public.is_current_member() and exists (
      select 1 from public.members m where m.id = member_id
        and (m.status = 'active' or public.setting_enabled('former_members_visibility'))
    ))
  );

drop policy if exists announcements_read_published on public.announcements;
create policy announcements_read_published on public.announcements for select to anon, authenticated
  using (
    (is_published and visibility = 'public')
    or (is_published and visibility = 'members' and public.is_current_member())
    or public.is_admin_user()
  );

drop policy if exists documents_read_by_visibility on public.documents;
create policy documents_read_by_visibility on public.documents for select to anon, authenticated
  using (
    (published_at is not null and visibility = 'public')
    or (published_at is not null and visibility = 'members' and public.is_current_member())
    or (visibility = 'restricted' and public.is_admin_user())
    or public.is_admin_user()
  );

drop policy if exists executive_terms_public_current_or_member_archive on public.executive_terms;
create policy executive_terms_public_current_or_member_archive on public.executive_terms for select to anon, authenticated
  using (is_current or public.is_current_member() or public.is_admin_user());
drop policy if exists executive_members_current_or_member_archive on public.executive_members;
create policy executive_members_current_or_member_archive on public.executive_members for select to anon, authenticated
  using (
    exists (select 1 from public.executive_terms t where t.id = term_id and t.is_current)
    or public.is_current_member() or public.is_admin_user()
  );

drop policy if exists transaction_categories_read on public.transaction_categories;
create policy transaction_categories_read on public.transaction_categories for select to authenticated
  using (public.is_current_member() or public.is_finance_staff());
drop policy if exists transactions_published_or_finance_read on public.financial_transactions;
create policy transactions_published_or_finance_read on public.financial_transactions for select to authenticated
  using ((public.is_current_member() and is_published) or public.is_finance_staff());
drop policy if exists contribution_plans_member_read on public.contribution_plans;
create policy contribution_plans_member_read on public.contribution_plans for select to authenticated
  using ((public.is_current_member() and is_active) or public.is_finance_staff());
drop policy if exists financial_reports_read on public.financial_reports;
create policy financial_reports_read on public.financial_reports for select to authenticated
  using ((published_at is not null and public.is_current_member()) or public.is_finance_staff());

drop policy if exists official_documents_read on storage.objects;
create policy official_documents_read on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'official-documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = name and d.published_at is not null
        and (d.visibility = 'public' or (d.visibility = 'members' and public.is_current_member()) or public.is_admin_user())
    )
  );
drop policy if exists financial_reports_storage_read on storage.objects;
create policy financial_reports_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'financial-reports' and (public.is_current_member() or public.is_finance_staff()));

-- L'écriture des photos reste cantonnée au dossier du membre connecté.
create policy member_photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos' and exists (
    select 1 from public.members m where m.user_id = auth.uid() and name like m.id::text || '/%'
      and (public.is_current_member() or exists (
        select 1 from public.member_onboarding o where o.member_id = m.id and o.user_id = auth.uid()
          and o.kind = 'reactivation' and o.status = 'pending'
      ))
  ));
create policy member_photos_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'member-photos' and exists (
    select 1 from public.members m where m.user_id = auth.uid() and name like m.id::text || '/%'
      and (public.is_current_member() or exists (
        select 1 from public.member_onboarding o where o.member_id = m.id and o.user_id = auth.uid()
          and o.kind = 'reactivation' and o.status = 'pending'
      ))
  ))
  with check (bucket_id = 'member-photos' and exists (
    select 1 from public.members m where m.user_id = auth.uid() and name like m.id::text || '/%'
      and (public.is_current_member() or exists (
        select 1 from public.member_onboarding o where o.member_id = m.id and o.user_id = auth.uid()
          and o.kind = 'reactivation' and o.status = 'pending'
      ))
  ));
create policy member_photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and exists (
    select 1 from public.members m where m.user_id = auth.uid() and name like m.id::text || '/%'
      and m.photo_path is distinct from name
      and (public.is_current_member() or exists (
        select 1 from public.member_onboarding o where o.member_id = m.id and o.user_id = auth.uid()
          and o.kind = 'reactivation' and o.status = 'pending'
      ))
  ));

-- Secrets chiffrés ajoutés en colonnes ; les anciens hashes ne permettent pas de reconstituer le jeton.
alter table public.member_qr_tokens
  add column if not exists encrypted_token text,
  add column if not exists encryption_nonce text,
  add column if not exists encryption_tag text,
  add column if not exists encryption_key_version text;
alter table public.member_qr_tokens
  add constraint member_qr_ciphertext_complete_check
    check (
      (encrypted_token is null and encryption_nonce is null and encryption_tag is null and encryption_key_version is null)
      or (encrypted_token is not null and encryption_nonce is not null and encryption_tag is not null and encryption_key_version is not null)
    ) not valid;

create or replace function public.has_active_member_qr(p_member_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.is_admin_user() and exists (
    select 1 from public.member_qr_tokens q
    where q.member_id = p_member_id and q.revoked_at is null
  );
$$;
revoke all on function public.has_active_member_qr(uuid) from public, anon;
grant execute on function public.has_active_member_qr(uuid) to authenticated;

create or replace function public.get_visible_announcements(p_limit integer default 12, p_offset integer default 0)
returns table(id uuid, title text, slug text, summary text, body text, image_url text, is_pinned boolean, published_at timestamptz, visibility public.announcement_visibility)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.title, a.slug, a.summary, a.body, a.image_url, a.is_pinned, a.published_at, a.visibility
  from public.announcements a
  where a.is_published
    and (a.visibility = 'public' or public.is_current_member() or public.is_admin_user())
  order by a.is_pinned desc, a.published_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;
create or replace function public.get_visible_announcement_by_slug(p_slug text)
returns table(id uuid, title text, slug text, summary text, body text, image_url text, is_pinned boolean, published_at timestamptz, visibility public.announcement_visibility)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.title, a.slug, a.summary, a.body, a.image_url, a.is_pinned, a.published_at, a.visibility
  from public.announcements a
  where a.slug = p_slug and a.is_published
    and (a.visibility = 'public' or public.is_current_member() or public.is_admin_user())
  limit 1;
$$;
revoke all on function public.get_visible_announcements(integer, integer) from public;
grant execute on function public.get_visible_announcements(integer, integer) to anon, authenticated;
revoke all on function public.get_visible_announcement_by_slug(text) from public;
grant execute on function public.get_visible_announcement_by_slug(text) to anon, authenticated;

create or replace function public.verify_member_qr(p_token text)
returns table(member_number text, full_name text, status text, "position" text, photo_path text)
language sql stable security definer
set search_path = public, extensions
as $$
  select m.member_number,
         concat_ws(' ', m.first_name, m.last_name) as full_name,
         case when m.status = 'active' and (not public.setting_enabled('member_lifecycle_enforced') or m.exit_year > extract(year from (now() at time zone 'Asia/Kolkata'))::integer) then 'actif'
              when m.status = 'former' then 'ancien'
              else 'non_actif' end as status,
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
