-- Simplifie l'approbation des années côté application et verrouille les années
-- approuvées contre les modifications directes du membre. Les périodes et leurs
-- historiques restent inchangés.

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
        review_comment = null, reviewed_by = null, reviewed_at = null, updated_at = now()
    where member_id = target_member_id and review_status = 'approved';

  if tg_op = 'DELETE' then return old; end if;
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
  if exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.mfa_enabled
      and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
  ) then
    raise exception 'Validez votre authentification à deux facteurs.' using errcode = '42501';
  end if;
  if p_decision is distinct from 'approved' then
    raise exception 'Seule la validation des informations est disponible.' using errcode = '22023';
  end if;
  if p_joined_year is null or p_exit_year is null
    or p_joined_year < 1900 or p_joined_year > 2200
    or p_exit_year < p_joined_year or p_exit_year > 2200 then
    raise exception 'Les années doivent être renseignées et cohérentes.' using errcode = '23514';
  end if;

  perform 1 from public.members where id = p_member_id for update;
  if not found then raise exception 'Membre introuvable.' using errcode = 'P0002'; end if;

  update public.members
    set joined_year = p_joined_year, exit_year = p_exit_year
    where id = p_member_id;

  insert into public.member_card_reviews(
    member_id, review_status, review_comment, reviewed_by, reviewed_at, approved_at, updated_at
  ) values (
    p_member_id, 'approved', null, auth.uid(), now(), now(), now()
  )
  on conflict (member_id) do update set
    review_status = 'approved', review_comment = null,
    reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
    approved_at = excluded.approved_at, updated_at = excluded.updated_at;
end;
$$;

drop trigger if exists guard_approved_member_year_changes on public.members;
create trigger guard_approved_member_year_changes
  before update of joined_year, exit_year on public.members
  for each row execute function public.guard_approved_member_year_changes();

create or replace function public.own_member_card_years_locked()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.current_user_has_role('member'::public.app_role) and exists (
    select 1
    from public.members m
    join public.member_card_reviews r on r.member_id = m.id
    where m.user_id = auth.uid()
      and r.review_status = 'approved'
      and r.approved_at is not null
  );
$$;

revoke all on function public.guard_approved_member_year_changes() from public, anon, authenticated;
revoke all on function public.own_member_card_years_locked() from public, anon;
grant execute on function public.own_member_card_years_locked() to authenticated;
