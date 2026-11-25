-- Fix member permanent deletion against the protected membership/education history triggers.
-- The transaction-local marker is set only after the authenticated Super Admin and safety checks pass.

create or replace function public.prepare_member_permanent_deletion(
  p_member_id uuid,
  p_expected_member_number text
)
returns table(auth_user_id uuid, member_photo_path text, restore_member_link boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  member_row public.members%rowtype;
  onboarding_user_id uuid;
  historical_user_ids uuid[];
  target_user_id uuid;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into member_row
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_expected_member_number is null or p_expected_member_number <> member_row.member_number then
    raise exception 'MEMBER_CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;
  if member_row.photo_path is not null and left(member_row.photo_path, length(p_member_id::text) + 1) <> (p_member_id::text || '/') then
    raise exception 'MEMBER_PHOTO_PATH_CONFLICT' using errcode = '23514';
  end if;

  select o.user_id into onboarding_user_id
  from public.member_onboarding o
  where o.member_id = p_member_id;

  select coalesce(array_agg(distinct case when v.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v.user_id::uuid end), array[]::uuid[])
    into historical_user_ids
  from public.audit_log a
  cross join lateral (values (a.before_value ->> 'user_id'), (a.after_value ->> 'user_id')) as v(user_id)
  where a.target_table = 'members'
    and a.target_id = p_member_id::text
    and v.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if cardinality(historical_user_ids) > 1 then
    raise exception 'MEMBER_AUTH_HISTORY_CONFLICT' using errcode = '23514';
  end if;
  if member_row.user_id is not null and onboarding_user_id is not null and member_row.user_id <> onboarding_user_id then
    raise exception 'MEMBER_AUTH_LINK_CONFLICT' using errcode = '23514';
  end if;
  if member_row.user_id is not null and cardinality(historical_user_ids) = 1 and member_row.user_id <> historical_user_ids[1] then
    raise exception 'MEMBER_AUTH_HISTORY_CONFLICT' using errcode = '23514';
  end if;
  if onboarding_user_id is not null and cardinality(historical_user_ids) = 1 and onboarding_user_id <> historical_user_ids[1] then
    raise exception 'MEMBER_AUTH_HISTORY_CONFLICT' using errcode = '23514';
  end if;

  target_user_id := coalesce(member_row.user_id, onboarding_user_id, historical_user_ids[1]);
  if target_user_id is not null and exists (
    select 1 from public.members other_member
    where other_member.user_id = target_user_id and other_member.id <> p_member_id
  ) then
    raise exception 'MEMBER_AUTH_LINK_CONFLICT' using errcode = '23514';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'CANNOT_DELETE_CURRENT_SUPER_ADMIN' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.user_roles r
    where r.user_id = target_user_id and r.role <> 'member'::public.app_role
  ) then
    raise exception 'AUTH_ACCOUNT_HAS_NON_MEMBER_ROLE' using errcode = '23514';
  end if;

  if exists (select 1 from public.contribution_payments p where p.member_id = p_member_id)
    or exists (select 1 from public.contribution_allocations a where a.member_id = p_member_id) then
    raise exception 'FINANCIAL_DATA_BLOCK' using errcode = '23514';
  end if;

  if target_user_id is not null and (
    exists (select 1 from public.financial_transactions t where t.created_by = target_user_id)
    or exists (select 1 from public.financial_attachments a where a.created_by = target_user_id)
    or exists (select 1 from public.contribution_plans p where p.created_by = target_user_id)
    or exists (select 1 from public.contribution_dues d where d.created_by = target_user_id)
    or exists (select 1 from public.contribution_payments p where p.created_by = target_user_id)
    or exists (select 1 from public.financial_reports r where r.created_by = target_user_id)
  ) then
    raise exception 'FINANCIAL_CREATOR_DATA_BLOCK' using errcode = '23514';
  end if;

  -- Auth.users has a RESTRICT FK from members.user_id. Unlink only after all
  -- guards pass; the app restores this link if Auth deletion fails.
  perform set_config('adeio.anonymize_member_id', p_member_id::text, true);

  if member_row.user_id is not null then
    update public.members set user_id = null where id = p_member_id;
  end if;

  return query select target_user_id, member_row.photo_path, member_row.user_id is not null;
end;
$$;

create or replace function public.finalize_member_permanent_deletion(
  p_member_id uuid,
  p_expected_member_number text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  member_row public.members%rowtype;
  onboarding_user_id uuid;
  historical_user_ids uuid[];
  related_audit_ids text[];
  target_user_id uuid;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into member_row
  from public.members
  where id = p_member_id
  for update;
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_expected_member_number is null or p_expected_member_number <> member_row.member_number then
    raise exception 'MEMBER_CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;
  if member_row.user_id is not null then
    raise exception 'AUTH_ACCOUNT_STILL_LINKED' using errcode = '23514';
  end if;

  select o.user_id into onboarding_user_id
  from public.member_onboarding o
  where o.member_id = p_member_id;
  if onboarding_user_id is not null and exists (select 1 from auth.users u where u.id = onboarding_user_id) then
    raise exception 'AUTH_ACCOUNT_STILL_PRESENT' using errcode = '23514';
  end if;

  select coalesce(array_agg(distinct case when v.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v.user_id::uuid end), array[]::uuid[])
    into historical_user_ids
  from public.audit_log a
  cross join lateral (values (a.before_value ->> 'user_id'), (a.after_value ->> 'user_id')) as v(user_id)
  where a.target_table = 'members'
    and a.target_id = p_member_id::text
    and v.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if cardinality(historical_user_ids) > 1 then
    raise exception 'MEMBER_AUTH_HISTORY_CONFLICT' using errcode = '23514';
  end if;
  if exists (select 1 from auth.users u where u.id = any(historical_user_ids)) then
    raise exception 'AUTH_ACCOUNT_STILL_PRESENT' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.members other_member
    where other_member.user_id = any(historical_user_ids) and other_member.id <> p_member_id
  ) then
    raise exception 'MEMBER_AUTH_LINK_CONFLICT' using errcode = '23514';
  end if;

  if exists (select 1 from public.contribution_payments p where p.member_id = p_member_id)
    or exists (select 1 from public.contribution_allocations a where a.member_id = p_member_id) then
    raise exception 'FINANCIAL_DATA_BLOCK' using errcode = '23514';
  end if;
  if cardinality(historical_user_ids) > 0 and (
    exists (select 1 from public.financial_transactions t where t.created_by = any(historical_user_ids))
    or exists (select 1 from public.financial_attachments a where a.created_by = any(historical_user_ids))
    or exists (select 1 from public.contribution_plans p where p.created_by = any(historical_user_ids))
    or exists (select 1 from public.contribution_dues d where d.created_by = any(historical_user_ids))
    or exists (select 1 from public.contribution_payments p where p.created_by = any(historical_user_ids))
    or exists (select 1 from public.financial_reports r where r.created_by = any(historical_user_ids))
  ) then
    raise exception 'FINANCIAL_CREATOR_DATA_BLOCK' using errcode = '23514';
  end if;

  select coalesce(array_agg(id), array[]::text[]) into related_audit_ids
  from (
    select p_member_id::text as id
    union select unnest(historical_user_ids)::text
    union select user_id::text || ':member' from unnest(historical_user_ids) as historical(user_id)
    union select membership.id::text from public.membership_periods membership where membership.member_id = p_member_id
    union select qr.id::text from public.member_qr_tokens qr where qr.member_id = p_member_id
    union select executive.id::text from public.executive_members executive where executive.member_id = p_member_id
    union select due.id::text from public.contribution_dues due where due.member_id = p_member_id
    union select education.id::text from public.member_education_periods education where education.member_id = p_member_id
    union select lifecycle.id::text from public.member_lifecycle_events lifecycle where lifecycle.member_id = p_member_id
  ) related;

  -- Auth deletion nulls actor_id FKs. Also redact this account UUID wherever
  -- an unrelated audit snapshot recorded it as a creator or related user.
  foreach target_user_id in array historical_user_ids loop
    update public.audit_log a
    set before_value = public.scrub_member_user_id(a.before_value, target_user_id),
        after_value = public.scrub_member_user_id(a.after_value, target_user_id)
    where (a.before_value is not null and a.before_value::text like '%' || target_user_id::text || '%')
       or (a.after_value is not null and a.after_value::text like '%' || target_user_id::text || '%');
  end loop;

  perform set_config('adeio.anonymize_member_id', p_member_id::text, true);

  -- Unpaid generated dues and all member-specific history are removed only
  -- after proving there are no real payments, allocations, or finance records.
  delete from public.contribution_dues where member_id = p_member_id;
  delete from public.executive_members where member_id = p_member_id;
  delete from public.member_education_periods where member_id = p_member_id;
  delete from public.member_lifecycle_events where member_id = p_member_id;
  delete from public.member_onboarding where member_id = p_member_id;
  delete from public.member_qr_tokens where member_id = p_member_id;
  delete from public.member_private_details where member_id = p_member_id;
  delete from public.membership_periods where member_id = p_member_id;
  delete from public.members where id = p_member_id;

  -- Remove identifying audit snapshots for this record and its account. Keep
  -- one non-identifying audit entry that records that a permanent deletion ran.
  delete from public.audit_log
  where target_id = any(related_audit_ids)
    and target_table = any(array[
      'members','member_private_details','membership_periods','member_qr_tokens',
      'executive_members','contribution_dues','contribution_payments',
      'contribution_allocations','profiles','user_roles','member_onboarding',
      'member_education_periods','member_lifecycle_events'
    ]::text[]);

  insert into public.audit_log(actor_id, action, target_table, target_id, before_value, after_value)
  values (auth.uid(), 'DELETE', 'member_permanent_deletion', extensions.gen_random_uuid()::text,
    null, jsonb_build_object('member_data_permanently_deleted', true));
end;
$$;

revoke all on function public.prepare_member_permanent_deletion(uuid, text) from public, anon;
revoke all on function public.finalize_member_permanent_deletion(uuid, text) from public, anon;
grant execute on function public.prepare_member_permanent_deletion(uuid, text) to authenticated;
grant execute on function public.finalize_member_permanent_deletion(uuid, text) to authenticated;

-- An anonymized placeholder is retained for its linked history, but must not
-- continue to count or display as an active member.
create or replace function public.anonymize_member(p_member_id uuid, p_member_number text)
returns text
language plpgsql
security definer
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
        user_id = null, photo_path = null, photo_public_consent = false,
        status = 'former'::public.member_status, archived_at = coalesce(archived_at, now())
    where id = p_member_id;
  delete from public.member_private_details where member_id = p_member_id;
  update public.membership_periods set note = null where member_id = p_member_id and note is not null;
  update public.member_qr_tokens set revoked_at = now() where member_id = p_member_id and revoked_at is null;
  return old_photo_path;
end;
$$;
revoke all on function public.anonymize_member(uuid, text) from public, anon;
grant execute on function public.anonymize_member(uuid, text) to authenticated;
