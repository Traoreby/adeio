-- Images are normalized in the browser; buckets enforce a server-side ceiling too.
update storage.buckets
set public = false,
    file_size_limit = 500000,
    allowed_mime_types = array['image/webp', 'image/jpeg']
where id = 'member-photos';

update storage.buckets
set public = false,
    file_size_limit = 2000000,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/webp']
where id = 'financial-attachments';

update storage.buckets
set public = false,
    file_size_limit = 2000000,
    allowed_mime_types = array['application/pdf']
where id = 'financial-reports';

drop policy if exists settings_finance_receipt_threshold_read on public.settings;
create policy settings_finance_receipt_threshold_read on public.settings for select to authenticated
  using (key = 'financial_receipt_required_threshold_fcfa' and public.is_finance_staff());

-- Future financial reports are metadata; PDFs are rendered on demand.
alter table public.financial_reports alter column storage_path drop not null;
alter table public.financial_reports alter column file_name drop not null;
alter table public.financial_reports alter column mime_type drop not null;
alter table public.financial_reports add column if not exists total_income_fcfa bigint;
alter table public.financial_reports add column if not exists total_expense_fcfa bigint;
alter table public.financial_reports add column if not exists net_balance_fcfa bigint;
alter table public.financial_reports add column if not exists transaction_count bigint;

-- Preserve the published figures and metadata, then detach legacy PDFs so they
-- can be regenerated from the report row and safely removed through the admin UI.
drop trigger if exists protect_published_financial_reports on public.financial_reports;
update public.financial_reports r
set (total_income_fcfa, total_expense_fcfa, net_balance_fcfa, transaction_count, storage_path, file_name, mime_type) = (
  select summary.total_income_fcfa, summary.total_expense_fcfa, summary.net_balance_fcfa, summary.transaction_count,
    null::text, null::text, null::text
  from public.get_financial_summary(r.period_start, r.period_end) summary
)
where r.storage_path is not null;
create trigger protect_published_financial_reports
  before update or delete on public.financial_reports
  for each row execute function public.prevent_published_financial_report_rewrite();

create or replace function public.get_adeio_storage_usage()
returns table(bucket_id text, used_bytes bigint, object_count bigint, alert_threshold_bytes bigint)
language plpgsql stable security definer set search_path = public, storage
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Accès réservé au super-administrateur.' using errcode = '42501';
  end if;
  return query
  select b.id::text,
    coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end), 0)::bigint,
    count(o.id)::bigint,
    1073741824::bigint
  from storage.buckets b
  left join storage.objects o on o.bucket_id = b.id
  where b.id in ('member-photos', 'financial-attachments', 'financial-reports')
  group by b.id
  order by b.id;
end;
$$;
revoke all on function public.get_adeio_storage_usage() from public;
grant execute on function public.get_adeio_storage_usage() to authenticated;

create or replace function public.get_adeio_storage_orphans(p_limit integer default 50)
returns table(bucket_id text, object_name text, size_bytes bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, storage
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Accès réservé au super-administrateur.' using errcode = '42501';
  end if;
  return query
  select orphan.bucket_id, orphan.object_name, orphan.size_bytes, orphan.created_at
  from (
    select o.bucket_id::text as bucket_id, o.name::text as object_name,
      case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end as size_bytes,
      o.created_at
    from storage.objects o
    where o.bucket_id = 'member-photos'
      and not exists (select 1 from public.members m where m.photo_path = o.name)
    union all
    select o.bucket_id::text, o.name::text,
      case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end,
      o.created_at
    from storage.objects o
    where o.bucket_id = 'financial-attachments'
      and not exists (select 1 from public.financial_attachments a where a.storage_path = o.name)
    union all
    select o.bucket_id::text, o.name::text,
      case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end,
      o.created_at
    from storage.objects o
    where o.bucket_id = 'financial-reports'
      and not exists (select 1 from public.financial_reports r where r.storage_path = o.name)
  ) orphan
  order by orphan.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;
revoke all on function public.get_adeio_storage_orphans(integer) from public;
grant execute on function public.get_adeio_storage_orphans(integer) to authenticated;

create or replace function public.is_adeio_storage_orphan(p_bucket_id text, p_name text)
returns boolean
language plpgsql stable security definer set search_path = public, storage
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Accès réservé au super-administrateur.' using errcode = '42501';
  end if;
  if p_bucket_id = 'member-photos' then
    return exists (select 1 from storage.objects o where o.bucket_id = p_bucket_id and o.name = p_name)
      and not exists (select 1 from public.members m where m.photo_path = p_name);
  elsif p_bucket_id = 'financial-attachments' then
    return exists (select 1 from storage.objects o where o.bucket_id = p_bucket_id and o.name = p_name)
      and not exists (select 1 from public.financial_attachments a where a.storage_path = p_name);
  elsif p_bucket_id = 'financial-reports' then
    return exists (select 1 from storage.objects o where o.bucket_id = p_bucket_id and o.name = p_name)
      and not exists (select 1 from public.financial_reports r where r.storage_path = p_name);
  end if;
  return false;
end;
$$;
revoke all on function public.is_adeio_storage_orphan(text, text) from public;
grant execute on function public.is_adeio_storage_orphan(text, text) to authenticated;

create or replace function public.anonymize_member(p_member_id uuid, p_member_number text)
returns text
language plpgsql security definer set search_path = public, auth
as $$
declare
  old_photo_path text;
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
revoke all on function public.anonymize_member(uuid, text) from public;
grant execute on function public.anonymize_member(uuid, text) to authenticated;
