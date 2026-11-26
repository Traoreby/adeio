-- Revue Super Admin, confirmation explicite de la période et historique des cartes.
-- Les fins préexistantes sont volontairement marquées non confirmées : leur origine
-- (date réelle ou clôture calculée) ne peut pas être déduite de façon sûre.

alter table public.membership_periods
  add column ends_on_source text not null default 'unconfirmed'
    check (ends_on_source in ('unconfirmed', 'derived_exit_year', 'admin_confirmed')),
  add column ends_on_confirmed_at timestamptz,
  add column ends_on_confirmed_by uuid references auth.users(id) on delete set null;

create table public.member_card_reviews (
  member_id uuid primary key references public.members(id) on delete cascade,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'changes_requested', 'approved')),
  review_comment text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((review_status = 'approved') = (approved_at is not null))
);

create table public.member_card_official_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  asset_kind text not null check (asset_kind in ('signature', 'seal')),
  storage_path text not null unique,
  is_current boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index member_card_one_current_asset_per_kind_idx
  on public.member_card_official_assets(asset_kind) where is_current;

create table public.member_card_issuances (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  membership_period_id uuid not null references public.membership_periods(id) on delete cascade,
  qr_token_id uuid not null references public.member_qr_tokens(id) on delete cascade,
  review_approved_at timestamptz not null,
  signature_asset_id uuid not null references public.member_card_official_assets(id) on delete restrict,
  seal_asset_id uuid not null references public.member_card_official_assets(id) on delete restrict,
  signature_storage_path text not null,
  seal_storage_path text not null,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  issued_on date not null,
  valid_until date not null,
  member_snapshot jsonb not null,
  constraint member_card_issuance_date_check check (valid_until >= issued_on),
  constraint member_card_issuance_snapshot_object_check check (jsonb_typeof(member_snapshot) = 'object'),
  constraint member_card_issuance_idempotency_key unique
    (member_id, membership_period_id, qr_token_id, review_approved_at, signature_asset_id, seal_asset_id)
);
create index member_card_issuances_member_date_idx
  on public.member_card_issuances(member_id, issued_at desc);

alter table public.member_card_reviews enable row level security;
alter table public.member_card_official_assets enable row level security;
alter table public.member_card_issuances enable row level security;

grant select on public.member_card_reviews, public.member_card_official_assets, public.member_card_issuances to authenticated;

create policy member_card_reviews_super_admin_read on public.member_card_reviews
  for select to authenticated using (public.is_super_admin());
create policy member_card_assets_super_admin_read on public.member_card_official_assets
  for select to authenticated using (public.is_super_admin());
create policy member_card_issuances_super_admin_read on public.member_card_issuances
  for select to authenticated using (public.is_super_admin());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('member-card-official-assets', 'member-card-official-assets', false, 1048576, array['image/png']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = 1048576,
  allowed_mime_types = array['image/png']::text[];

create policy member_card_official_assets_super_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'member-card-official-assets' and public.is_super_admin());

-- Toute fermeture automatique depuis exit_year reste explicitement non-confirmée.
-- Un administrateur peut modifier une fin sans la confirmer ; seul le RPC Super Admin
-- ci-dessous peut inscrire la confirmation officielle.
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

  if new.ends_on_confirmed_at is not null and new.ends_on_confirmed_by is not null then
    if not public.is_super_admin() then
      raise exception 'Seul le Super Admin peut confirmer la fin d’une période d’adhésion.' using errcode = '42501';
    end if;
    new.ends_on_source := 'admin_confirmed';
  elsif new.ends_on is null then
    new.ends_on_source := 'unconfirmed';
  else
    select m.exit_year into member_exit_year from public.members m where m.id = new.member_id;
    if member_exit_year is not null
       and member_exit_year <= extract(year from (now() at time zone 'Asia/Kolkata'))::integer
       and new.ends_on = make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::integer, 1, 1) - 1 then
      new.ends_on_source := 'derived_exit_year';
    else
      new.ends_on_source := 'unconfirmed';
    end if;
  end if;
  return new;
end;
$$;
create trigger membership_period_end_provenance
  before insert or update of ends_on, ends_on_confirmed_at, ends_on_confirmed_by
  on public.membership_periods for each row
  execute function public.track_membership_period_end_provenance();

create or replace function public.invalidate_member_card_review()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare target_member_id uuid;
begin
  if tg_table_name = 'members' then
    target_member_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_member_id := case when tg_op = 'DELETE' then old.member_id else new.member_id end;
  end if;
  update public.member_card_reviews
    set review_status = 'pending', approved_at = null,
        review_comment = 'Les informations du dossier ont changé ; une nouvelle validation est requise.',
        reviewed_by = null, reviewed_at = null, updated_at = now()
    where member_id = target_member_id and review_status = 'approved';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger invalidate_member_card_review_from_member
  after update of first_name, last_name, member_number, joined_year, exit_year, status, photo_path on public.members
  for each row execute function public.invalidate_member_card_review();
create trigger invalidate_member_card_review_from_education
  after insert or update or delete on public.member_education_periods
  for each row execute function public.invalidate_member_card_review();
create trigger invalidate_member_card_review_from_membership
  after insert or update of starts_on, ends_on, ends_on_source, ends_on_confirmed_at, ends_on_confirmed_by or delete
  on public.membership_periods for each row
  execute function public.invalidate_member_card_review();

create or replace function public.review_member_card(
  p_member_id uuid,
  p_decision text,
  p_joined_year integer,
  p_exit_year integer,
  p_comment text default null
)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Action réservée au Super Admin.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.mfa_enabled
      and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2') then
    raise exception 'Validez votre authentification à deux facteurs.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'Décision de validation invalide.' using errcode = '22023';
  end if;
  if p_joined_year < 1900 or p_joined_year > 2200 or p_exit_year < p_joined_year or p_exit_year > 2200 then
    raise exception 'Les années doivent être renseignées et cohérentes.' using errcode = '23514';
  end if;

  perform 1 from public.members where id = p_member_id for update;
  if not found then raise exception 'Membre introuvable.' using errcode = 'P0002'; end if;

  update public.members set joined_year = p_joined_year, exit_year = p_exit_year where id = p_member_id;
  insert into public.member_card_reviews(member_id, review_status, review_comment, reviewed_by, reviewed_at, approved_at, updated_at)
  values (
    p_member_id, p_decision, nullif(trim(coalesce(p_comment, '')), ''), auth.uid(), now(),
    case when p_decision = 'approved' then now() else null end, now()
  )
  on conflict (member_id) do update set
    review_status = excluded.review_status,
    review_comment = excluded.review_comment,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    approved_at = excluded.approved_at,
    updated_at = excluded.updated_at;

end;
$$;

create or replace function public.confirm_membership_period_end(p_period_id uuid, p_ends_on date)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare period_row public.membership_periods%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Action réservée au Super Admin.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.mfa_enabled
      and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2') then
    raise exception 'Validez votre authentification à deux facteurs.' using errcode = '42501';
  end if;
  select * into period_row from public.membership_periods where id = p_period_id for update;
  if not found then raise exception 'Période d’adhésion introuvable.' using errcode = 'P0002'; end if;
  if p_ends_on < period_row.starts_on then
    raise exception 'La date de fin doit être égale ou postérieure au début de la période.' using errcode = '23514';
  end if;
  update public.membership_periods
    set ends_on = p_ends_on, ends_on_source = 'admin_confirmed',
        ends_on_confirmed_at = now(), ends_on_confirmed_by = auth.uid()
    where id = p_period_id;
end;
$$;

create or replace function public.set_member_card_official_asset(p_asset_kind text, p_storage_path text)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare new_asset_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Action réservée au Super Admin.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.mfa_enabled
      and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2') then
    raise exception 'Validez votre authentification à deux facteurs.' using errcode = '42501';
  end if;
  if p_asset_kind not in ('signature', 'seal') or p_storage_path !~ ('^' || p_asset_kind || '/[0-9a-f-]{36}\.png$') then
    raise exception 'Fichier officiel ou chemin invalide.' using errcode = '22023';
  end if;
  update public.member_card_official_assets set is_current = false
    where asset_kind = p_asset_kind and is_current;
  insert into public.member_card_official_assets(asset_kind, storage_path, created_by)
    values (p_asset_kind, p_storage_path, auth.uid()) returning id into new_asset_id;
  return new_asset_id;
end;
$$;

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
  issued_id uuid;
  snapshot jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'La délivrance des cartes est réservée au Super Admin.' using errcode = '42501';
  end if;
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
       or member_row.exit_year <= extract(year from local_date)::integer
       or member_row.photo_path is null or member_row.profile_completed_at is null then
      raise exception 'Le profil doit être complet, actif, avec une nouvelle photo et une année de sortie future.' using errcode = '23514';
    end if;

    select * into review_row from public.member_card_reviews
      where member_id = target_id and review_status = 'approved' and approved_at is not null;
    if not found then raise exception 'Les informations de ce membre doivent être validées par le Super Admin.' using errcode = '23514'; end if;

    select * into period_row from public.membership_periods
      where member_id = target_id and starts_on <= local_date
      order by starts_on desc, created_at desc limit 1 for update;
    if not found then raise exception 'Aucune période d’adhésion actuelle n’est enregistrée.' using errcode = '23514'; end if;
    if period_row.ends_on is null or period_row.ends_on_source <> 'admin_confirmed'
       or period_row.ends_on_confirmed_at is null or period_row.ends_on_confirmed_by is null then
      raise exception 'La date réelle de fin de la période d’adhésion doit être saisie et confirmée par le Super Admin.' using errcode = '23514';
    end if;
    if period_row.ends_on < local_date then
      raise exception 'La période d’adhésion est déjà terminée ; aucune nouvelle carte ne peut être délivrée.' using errcode = '23514';
    end if;

    select * into education_row from public.member_education_periods
      where member_id = target_id and is_current limit 1;
    if not found then raise exception 'La formation actuelle du membre doit être renseignée.' using errcode = '23514'; end if;
    select * into qr_row from public.member_qr_tokens
      where member_id = target_id and revoked_at is null order by created_at desc limit 1;
    if not found or qr_row.encrypted_token is null or qr_row.encryption_nonce is null
       or qr_row.encryption_tag is null or qr_row.encryption_key_version is null then
      raise exception 'Un QR actif compatible doit être émis explicitement avant la carte.' using errcode = '23514';
    end if;
    select ci.id into issued_id from public.member_card_issuances ci
      where ci.qr_token_id = qr_row.id and ci.member_id = target_id
        and ci.membership_period_id = period_row.id
        and ci.review_approved_at = review_row.approved_at
        and ci.signature_asset_id = signature_row.id and ci.seal_asset_id = seal_row.id;
    if found then
      issuance_id := issued_id;
      return next;
      continue;
    end if;
    if exists (select 1 from public.member_card_issuances ci where ci.qr_token_id = qr_row.id) then
      raise exception 'Ce QR est déjà lié à une ancienne délivrance. Réémettez explicitement le QR avant de délivrer une nouvelle carte.' using errcode = '23514';
    end if;
    snapshot := jsonb_build_object(
      'first_name', member_row.first_name,
      'last_name', member_row.last_name,
      'member_number', member_row.member_number,
      'joined_year', member_row.joined_year,
      'study_program', education_row.study_program,
      'institution', education_row.institution,
      'status', 'MEMBRE ACTIF',
      'photo_path', member_row.photo_path,
      'issued_on', local_date,
      'valid_until', period_row.ends_on,
      'association', 'Association des Étudiants Ivoiriens de l’Odisha',
      'site_url', 'https://adeio.vercel.app'
    );

    issued_id := null;
    insert into public.member_card_issuances(
      member_id, membership_period_id, qr_token_id, review_approved_at, signature_asset_id, seal_asset_id,
      signature_storage_path, seal_storage_path, issued_by, issued_on, valid_until, member_snapshot
    ) values (
      target_id, period_row.id, qr_row.id, review_row.approved_at, signature_row.id, seal_row.id,
      signature_row.storage_path, seal_row.storage_path, auth.uid(), local_date, period_row.ends_on, snapshot
    ) on conflict on constraint member_card_issuance_idempotency_key do nothing
    returning id into issued_id;

    if issued_id is null then
      select ci.id into issued_id from public.member_card_issuances ci
        where ci.member_id = target_id and ci.membership_period_id = period_row.id
          and ci.qr_token_id = qr_row.id and ci.review_approved_at = review_row.approved_at
          and ci.signature_asset_id = signature_row.id
          and ci.seal_asset_id = seal_row.id;
    end if;
    issuance_id := issued_id;
    return next;
  end loop;
end;
$$;

-- Vérification publique : même résultat limité qu’avant, mais l’état actif dépend
-- désormais de la période réelle confirmée et de sa date de fin, en date locale Inde.
create or replace function public.verify_member_qr(p_token text)
returns table(member_number text, full_name text, status text, "position" text, photo_path text)
language sql stable security definer
set search_path = public, extensions
as $$
  select m.member_number,
         concat_ws(' ', m.first_name, m.last_name) as full_name,
         case
           when m.status = 'active'
             and mp.ends_on_source = 'admin_confirmed'
             and mp.ends_on_confirmed_at is not null
             and mp.ends_on_confirmed_by is not null
             and mp.ends_on >= (now() at time zone 'Asia/Kolkata')::date
             and exists (
               select 1 from public.member_card_issuances ci
               join public.member_card_reviews r on r.member_id = ci.member_id
                 and r.review_status = 'approved' and r.approved_at = ci.review_approved_at
               where ci.member_id = m.id and ci.qr_token_id = q.id
                 and ci.membership_period_id = (select p.id from public.membership_periods p
                   where p.member_id = m.id and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date
                   order by p.starts_on desc, p.created_at desc limit 1)
                 and ci.valid_until = mp.ends_on
                 and ci.valid_until >= (now() at time zone 'Asia/Kolkata')::date
             )
             and (not public.setting_enabled('member_lifecycle_enforced')
               or m.exit_year > extract(year from (now() at time zone 'Asia/Kolkata'))::integer)
             then 'actif'
           when m.status = 'former' then 'ancien'
           else 'non_actif'
         end as status,
         ep.title as "position",
         case when m.photo_public_consent then m.photo_path else null end as photo_path
  from public.member_qr_tokens q
  join public.members m on m.id = q.member_id
  left join lateral (
    select p.ends_on, p.ends_on_source, p.ends_on_confirmed_at, p.ends_on_confirmed_by
    from public.membership_periods p
    where p.member_id = m.id and p.starts_on <= (now() at time zone 'Asia/Kolkata')::date
    order by p.starts_on desc, p.created_at desc limit 1
  ) mp on true
  left join public.executive_members em on em.member_id = m.id
  left join public.executive_terms et on et.id = em.term_id and et.is_current
  left join public.executive_positions ep on ep.id = em.position_id
  where p_token ~ '^[0-9a-fA-F]{64}$'
    and q.token_hash = encode(extensions.digest(convert_to(lower(p_token), 'UTF8'), 'sha256'), 'hex')
    and q.revoked_at is null
  limit 1;
$$;

create trigger audit_member_card_reviews after insert or update on public.member_card_reviews
  for each row execute function public.write_audit_log();
create trigger audit_member_card_assets after insert or update on public.member_card_official_assets
  for each row execute function public.write_audit_log();
create trigger audit_member_card_issuances after insert on public.member_card_issuances
  for each row execute function public.write_audit_log();

revoke all on function public.track_membership_period_end_provenance() from public, anon, authenticated;
revoke all on function public.invalidate_member_card_review() from public, anon, authenticated;
revoke all on function public.review_member_card(uuid,text,integer,integer,text) from public, anon;
revoke all on function public.confirm_membership_period_end(uuid,date) from public, anon;
revoke all on function public.set_member_card_official_asset(text,text) from public, anon;
revoke all on function public.issue_member_cards(uuid[]) from public, anon;
revoke all on function public.verify_member_qr(text) from public;
grant execute on function public.review_member_card(uuid,text,integer,integer,text) to authenticated;
grant execute on function public.confirm_membership_period_end(uuid,date) to authenticated;
grant execute on function public.set_member_card_official_asset(text,text) to authenticated;
grant execute on function public.issue_member_cards(uuid[]) to authenticated;
grant execute on function public.verify_member_qr(text) to anon, authenticated;
