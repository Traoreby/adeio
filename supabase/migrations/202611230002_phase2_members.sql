-- Phase 2: émission et rotation atomique des QR codes membres.
-- Les jetons bruts restent dans le navigateur de l'administrateur au moment de l'émission.

create or replace function public.rotate_member_qr_tokens(p_items jsonb)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  item jsonb;
  member_uuid uuid;
  inserted_count integer := 0;
begin
  if not public.is_admin_user() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'La sélection doit contenir entre 1 et 100 membres.' using errcode = '22023';
  end if;

  -- Valider l'ensemble avant toute rotation ; toute erreur annule la transaction.
  for item in select value from jsonb_array_elements(p_items) loop
    if (item->>'member_id') !~* '^[0-9a-f-]{36}$'
       or (item->>'token_hash') !~ '^[0-9a-f]{64}$' then
      raise exception 'Données de QR Code invalides.' using errcode = '22023';
    end if;
    member_uuid := (item->>'member_id')::uuid;
    if not exists (select 1 from public.members where id = member_uuid) then
      raise exception 'Membre introuvable.' using errcode = 'P0002';
    end if;
  end loop;
  if (select count(distinct value->>'member_id') from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then
    raise exception 'Un membre apparaît plusieurs fois.' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    member_uuid := (item->>'member_id')::uuid;
    update public.member_qr_tokens set revoked_at = now()
      where member_id = member_uuid and revoked_at is null;
    insert into public.member_qr_tokens(member_id, token_hash, created_by)
      values (member_uuid, item->>'token_hash', auth.uid());
    inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end;
$$;

create or replace function public.verify_member_qr(p_token text)
returns table(member_number text, full_name text, status text, "position" text, photo_path text)
language sql stable security definer
set search_path = public, extensions
as $$
  select m.member_number,
         concat_ws(' ', m.first_name, m.last_name) as full_name,
         case m.status when 'active' then 'actif' when 'former' then 'ancien' else 'non_actif' end as status,
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

-- Les périodes sont lisibles par les membres connectés uniquement pour les personnes
-- déjà visibles dans l'annuaire ou les archives configurées. Les coordonnées privées
-- restent dans member_private_details et ne sont jamais concernées par cette règle.
create policy membership_periods_directory_filter_select on public.membership_periods for select to authenticated
  using (public.is_assoc_member() and exists (
    select 1 from public.members m where m.id = member_id
      and (m.status = 'active' or public.setting_enabled('former_members_visibility'))
  ));

revoke all on function public.rotate_member_qr_tokens(jsonb) from public;
grant execute on function public.rotate_member_qr_tokens(jsonb) to authenticated;
revoke all on function public.verify_member_qr(text) from public;
grant execute on function public.verify_member_qr(text) to anon, authenticated;
