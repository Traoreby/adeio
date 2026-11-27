-- Mandats du Bureau ADEIO : durée fixe de 12 mois, état synchronisé par date.
-- Les tables, affectations et politiques RLS existantes sont conservées.

do $$
begin
  if exists (
    select 1
    from public.executive_terms first_term
    join public.executive_terms second_term on first_term.id < second_term.id
    where daterange(
      first_term.starts_on,
      coalesce(first_term.ends_on, (first_term.starts_on + interval '1 year' - interval '1 day')::date),
      '[]'
    ) && daterange(
      second_term.starts_on,
      coalesce(second_term.ends_on, (second_term.starts_on + interval '1 year' - interval '1 day')::date),
      '[]'
    )
  ) then
    raise exception 'Des mandats existants ont des périodes qui se chevauchent. Aucune donnée n’a été modifiée; vérifiez ces lignes avant de réessayer.';
  end if;
end;
$$;

create or replace function public.start_executive_term(
  p_term_title text,
  p_starts_on date,
  p_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  local_today date := (now() at time zone 'Asia/Kolkata')::date;
  calculated_end date;
  calculated_title text;
  new_term_id uuid;
  overlapping_term_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'La création d’un mandat est réservée au Super Admin.' using errcode = '42501';
  end if;
  if p_starts_on is null then
    raise exception 'La date de début est obligatoire.' using errcode = '22023';
  end if;

  -- Serialize concurrent attempts so two administrators cannot create overlapping mandates.
  perform pg_advisory_xact_lock(hashtext('adeio.executive_terms'));

  calculated_end := (p_starts_on + interval '1 year' - interval '1 day')::date;
  calculated_title := case
    when extract(year from p_starts_on) = extract(year from calculated_end)
      then 'Bureau exécutif ' || extract(year from p_starts_on)::integer::text
    else 'Bureau exécutif ' || extract(year from p_starts_on)::integer::text || '–' || extract(year from calculated_end)::integer::text
  end;

  select term.id into overlapping_term_id
  from public.executive_terms term
  cross join lateral (
    select coalesce(term.ends_on, (term.starts_on + interval '1 year' - interval '1 day')::date) as effective_end
  ) dates
  where daterange(term.starts_on, dates.effective_end, '[]')
    && daterange(p_starts_on, calculated_end, '[]')
  limit 1;
  if overlapping_term_id is not null then
    raise exception 'Les dates du nouveau mandat chevauchent un mandat déjà enregistré.' using errcode = '23P01';
  end if;

  -- Preserve the outgoing term and its roster. A legacy open term receives its natural 12-month end.
  update public.executive_terms term
  set is_current = false,
      ends_on = coalesce(term.ends_on, (term.starts_on + interval '1 year' - interval '1 day')::date)
  where term.is_current
    and p_starts_on <= local_today;

  insert into public.executive_terms(title, starts_on, ends_on, is_current, created_by)
  values (calculated_title, p_starts_on, calculated_end,
          p_starts_on <= local_today and calculated_end >= local_today, auth.uid())
  returning id into new_term_id;

  return new_term_id;
end;
$$;

revoke all on function public.start_executive_term(text, date, date) from public, anon;
grant execute on function public.start_executive_term(text, date, date) to authenticated;

create or replace function public.expire_executive_terms()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  local_today date := (now() at time zone 'Asia/Kolkata')::date;
  changed_count integer := 0;
  candidate_id uuid;
begin
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Action réservée au super-administrateur.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('adeio.executive_terms'));

  update public.executive_terms term
  set is_current = false,
      ends_on = coalesce(term.ends_on, (term.starts_on + interval '1 year' - interval '1 day')::date)
  where term.is_current
    and coalesce(term.ends_on, (term.starts_on + interval '1 year' - interval '1 day')::date) < local_today;
  get diagnostics changed_count = row_count;

  if not exists (select 1 from public.executive_terms where is_current) then
    select term.id into candidate_id
    from public.executive_terms term
    where term.starts_on <= local_today
      and coalesce(term.ends_on, (term.starts_on + interval '1 year' - interval '1 day')::date) >= local_today
    order by term.starts_on desc
    limit 1;
    if candidate_id is not null then
      update public.executive_terms set is_current = true where id = candidate_id and not is_current;
      if found then changed_count := changed_count + 1; end if;
    end if;
  end if;

  return changed_count;
end;
$$;

revoke all on function public.expire_executive_terms() from public, anon;
grant execute on function public.expire_executive_terms() to service_role;

-- Public roster is date-driven, so an expired term is never shown as current even
-- if the daily maintenance job has not yet updated its is_current flag.
create or replace function public.get_public_executive()
returns table(id uuid, full_name text, "position" text, biography text, photo_path text)
language sql
stable
security definer
set search_path = public
as $$
  select em.id,
         concat_ws(' ', m.first_name, m.last_name) as full_name,
         ep.title as "position",
         em.biography,
         case when m.photo_public_consent then m.photo_path else null end as photo_path
  from public.executive_members em
  join public.executive_terms t on t.id = em.term_id
  join public.members m on m.id = em.member_id and m.status = 'active'
  join public.executive_positions ep on ep.id = em.position_id
  where t.id = (
    select candidate.id
    from public.executive_terms candidate
    where candidate.starts_on <= (now() at time zone 'Asia/Kolkata')::date
      and coalesce(candidate.ends_on, (candidate.starts_on + interval '1 year' - interval '1 day')::date)
        >= (now() at time zone 'Asia/Kolkata')::date
    order by candidate.starts_on desc
    limit 1
  )
  order by em.sort_order, ep.sort_order;
$$;
revoke all on function public.get_public_executive() from public;
grant execute on function public.get_public_executive() to anon, authenticated;
