-- ADEIO — socle initial. À appliquer dans un projet Supabase dédié.
-- Les accès aux données sont contrôlés par RLS ; les rôles ne sont jamais lus depuis les métadonnées modifiables par l’utilisateur.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('member', 'treasurer', 'auditor', 'admin', 'super_admin');
create type public.member_status as enum ('active', 'former', 'suspended', 'deceased');
create type public.announcement_visibility as enum ('public', 'members');
create type public.document_visibility as enum ('public', 'members', 'restricted');
create type public.financial_direction as enum ('income', 'expense');
create type public.payment_method as enum ('cash', 'mobile_money', 'bank_transfer', 'other');
create type public.contribution_periodicity as enum ('monthly', 'yearly', 'custom');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  must_change_password boolean not null default true,
  mfa_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (user_id, role)
);
create index user_roles_role_idx on public.user_roles(role, user_id);

create or replace function public.current_user_has_role(required_role public.app_role)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = required_role
  );
$$;

create or replace function public.is_assoc_member()
returns boolean language sql stable security definer
set search_path = public, auth
as $$ select public.current_user_has_role('member'::public.app_role); $$;

create or replace function public.mfa_requirement_passed()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select not coalesce((select p.mfa_enabled from public.profiles p where p.user_id = auth.uid()), false)
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.is_finance_staff()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select (
    public.current_user_has_role('treasurer'::public.app_role)
      or public.current_user_has_role('auditor'::public.app_role)
      or public.current_user_has_role('super_admin'::public.app_role)
  ) and public.mfa_requirement_passed();
$$;

create or replace function public.is_admin_user()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select (
    public.current_user_has_role('admin'::public.app_role)
    or public.current_user_has_role('super_admin'::public.app_role)
  ) and public.mfa_requirement_passed();
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer
set search_path = public, auth
as $$ select public.current_user_has_role('super_admin'::public.app_role) and public.mfa_requirement_passed(); $$;

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create or replace function public.setting_enabled(setting_key text)
returns boolean language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select case
      when jsonb_typeof(value) = 'boolean' then (value #>> '{}')::boolean
      else coalesce((value ->> 'enabled')::boolean, false)
    end from public.settings where key = setting_key),
    false
  );
$$;

create table public.members (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  member_number text not null unique check (member_number ~ '^ADEIO-[0-9]{4}-[A-Z0-9]{4}$'),
  first_name text not null,
  last_name text not null,
  joined_year integer not null check (joined_year between 1900 and 2200),
  status public.member_status not null default 'active',
  photo_path text,
  photo_public_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index members_name_idx on public.members (lower(last_name), lower(first_name));
create index members_status_year_idx on public.members(status, joined_year);
create index members_user_id_idx on public.members(user_id) where user_id is not null;

create table public.member_private_details (
  member_id uuid primary key references public.members(id) on delete cascade,
  email text,
  phone text,
  updated_at timestamptz not null default now()
);

create table public.membership_periods (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  starts_on date not null,
  ends_on date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (ends_on is null or ends_on >= starts_on)
);
create index membership_periods_member_dates_idx on public.membership_periods(member_id, starts_on, ends_on);

create table public.member_qr_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);
create index member_qr_tokens_member_active_idx on public.member_qr_tokens(member_id) where revoked_at is null;

create table public.executive_terms (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  starts_on date not null,
  ends_on date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (ends_on is null or ends_on >= starts_on)
);
create unique index executive_one_current_term_idx on public.executive_terms(is_current) where is_current;
create index executive_terms_dates_idx on public.executive_terms(starts_on desc, ends_on);

create table public.executive_positions (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.executive_members (
  id uuid primary key default extensions.gen_random_uuid(),
  term_id uuid not null references public.executive_terms(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  position_id uuid not null references public.executive_positions(id) on delete restrict,
  biography text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (term_id, position_id),
  unique (term_id, member_id)
);
create index executive_members_term_order_idx on public.executive_members(term_id, sort_order);

create table public.announcements (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null check (length(title) between 3 and 140),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  summary text check (summary is null or length(summary) <= 280),
  body text not null,
  image_path text,
  image_url text,
  visibility public.announcement_visibility not null default 'public',
  is_published boolean not null default false,
  is_pinned boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (not is_published or published_at is not null)
);
create index announcements_publication_idx on public.announcements(is_published, visibility, is_pinned desc, published_at desc);

create table public.documents (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  category text not null,
  description text,
  storage_path text not null unique,
  visibility public.document_visibility not null default 'members',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index documents_visibility_category_idx on public.documents(visibility, category);

-- Tables du module financier, livrées fonctionnellement en Phase 3.
create table public.transaction_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique,
  direction public.financial_direction not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.financial_transactions (
  id uuid primary key default extensions.gen_random_uuid(),
  occurred_on date not null,
  direction public.financial_direction not null,
  category_id uuid references public.transaction_categories(id) on delete restrict,
  label text not null,
  amount_fcfa bigint not null check (amount_fcfa > 0),
  payment_method public.payment_method not null,
  is_published boolean not null default false,
  published_at timestamptz,
  correction_of uuid references public.financial_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (not is_published or published_at is not null)
);
create index financial_transactions_period_idx on public.financial_transactions(occurred_on desc, direction, category_id);

create table public.financial_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.contribution_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  amount_fcfa bigint not null check (amount_fcfa > 0),
  periodicity public.contribution_periodicity not null,
  custom_period_days integer check (custom_period_days is null or custom_period_days > 0),
  starts_on date not null,
  ends_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (ends_on is null or ends_on >= starts_on),
  check ((periodicity = 'custom' and custom_period_days is not null) or (periodicity <> 'custom' and custom_period_days is null))
);

create table public.contribution_dues (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  plan_id uuid not null references public.contribution_plans(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  due_on date not null,
  amount_due_fcfa bigint not null check (amount_due_fcfa > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (period_end >= period_start),
  unique (member_id, plan_id, period_start),
  unique (id, member_id)
);
create index contribution_dues_member_due_idx on public.contribution_dues(member_id, due_on);

create table public.contribution_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  paid_on date not null,
  amount_fcfa bigint not null check (amount_fcfa > 0),
  payment_method public.payment_method not null,
  financial_transaction_id uuid not null unique references public.financial_transactions(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (id, member_id)
);
create index contribution_payments_member_paid_idx on public.contribution_payments(member_id, paid_on desc);

create table public.contribution_allocations (
  payment_id uuid not null references public.contribution_payments(id) on delete restrict,
  due_id uuid not null references public.contribution_dues(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  amount_fcfa bigint not null check (amount_fcfa > 0),
  created_at timestamptz not null default now(),
  primary key (payment_id, due_id),
  foreign key (payment_id, member_id) references public.contribution_payments(id, member_id) on delete restrict,
  foreign key (due_id, member_id) references public.contribution_dues(id, member_id) on delete restrict
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  target_table text not null,
  target_id text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log(created_at desc);
create index audit_log_target_idx on public.audit_log(target_table, target_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles(user_id, display_name, must_change_password)
  values (new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''), true)
  on conflict (user_id) do nothing;
  insert into public.user_roles(user_id, role)
  values (new.id, 'member'::public.app_role)
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

create or replace function public.protect_last_super_admin()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare remaining_count integer;
begin
  if old.role <> 'super_admin' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE' and new.role = 'super_admin' and new.user_id = old.user_id then return new; end if;
  select count(*) into remaining_count
    from public.user_roles
    where role = 'super_admin' and user_id <> old.user_id;
  if remaining_count = 0 then
    raise exception 'Au moins un super-administrateur doit rester actif.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();
create trigger user_roles_keep_super_admin before update or delete on public.user_roles
  for each row execute function public.protect_last_super_admin();

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer
set search_path = public, auth
as $$
declare
  before_row jsonb;
  after_row jsonb;
  row_data jsonb;
  row_id text;
begin
  if tg_op = 'INSERT' then
    after_row := to_jsonb(new);
    row_data := after_row;
  elsif tg_op = 'UPDATE' then
    before_row := to_jsonb(old);
    after_row := to_jsonb(new);
    row_data := after_row;
  else
    before_row := to_jsonb(old);
    row_data := before_row;
  end if;
  row_id := coalesce(row_data ->> 'id', row_data ->> 'key', row_data ->> 'member_id', row_data ->> 'transaction_id', row_data ->> 'user_id', 'unknown');
  if row_data ? 'payment_id' and row_data ? 'due_id' then
    row_id := (row_data ->> 'payment_id') || ':' || (row_data ->> 'due_id');
  end if;
  if row_data ? 'role' then row_id := row_id || ':' || (row_data ->> 'role'); end if;
  insert into public.audit_log(actor_id, action, target_table, target_id, before_value, after_value)
  values (auth.uid(), tg_op, tg_table_name, row_id, before_row, after_row);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_published_transaction_rewrite()
returns trigger language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.is_published then
    raise exception 'Une opération publiée ne peut pas être supprimée.' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.is_published then
    raise exception 'Une opération publiée est immuable ; créez une écriture rectificative.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.validate_contribution_payment()
returns trigger language plpgsql set search_path = public
as $$
declare linked_transaction public.financial_transactions%rowtype;
begin
  select * into linked_transaction
    from public.financial_transactions
    where id = new.financial_transaction_id;
  if not found or linked_transaction.direction <> 'income'
     or linked_transaction.amount_fcfa <> new.amount_fcfa
     or linked_transaction.payment_method <> new.payment_method then
    raise exception 'Le paiement doit correspondre à une recette du même montant et du même moyen de paiement.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_contribution_payment_rewrite()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'Un paiement de cotisation ne peut pas être modifié ou supprimé ; enregistrez une opération rectificative.' using errcode = '55000';
end;
$$;

create or replace function public.validate_contribution_allocation()
returns trigger language plpgsql set search_path = public
as $$
declare
  payment_amount bigint;
  due_amount bigint;
  allocated_payment bigint;
  allocated_due bigint;
begin
  select amount_fcfa into payment_amount from public.contribution_payments where id = new.payment_id for update;
  select amount_due_fcfa into due_amount from public.contribution_dues where id = new.due_id for update;
  if tg_op = 'UPDATE' then
    select coalesce(sum(amount_fcfa), 0) into allocated_payment from public.contribution_allocations
      where payment_id = new.payment_id and not (payment_id = old.payment_id and due_id = old.due_id);
    select coalesce(sum(amount_fcfa), 0) into allocated_due from public.contribution_allocations
      where due_id = new.due_id and not (payment_id = old.payment_id and due_id = old.due_id);
  else
    select coalesce(sum(amount_fcfa), 0) into allocated_payment from public.contribution_allocations where payment_id = new.payment_id;
    select coalesce(sum(amount_fcfa), 0) into allocated_due from public.contribution_allocations where due_id = new.due_id;
  end if;
  if allocated_payment + new.amount_fcfa > payment_amount then
    raise exception 'Le total affecté dépasse le montant du paiement.' using errcode = '23514';
  end if;
  if allocated_due + new.amount_fcfa > due_amount then
    raise exception 'Le total affecté dépasse le montant dû pour cette période.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.verify_member_qr(p_token text)
returns table(member_number text, full_name text, status text, position text, photo_path text)
language sql stable security definer
set search_path = public, extensions
as $$
  select m.member_number,
         concat_ws(' ', m.first_name, m.last_name) as full_name,
         case when m.status = 'active' then 'actif' else 'non_actif' end as status,
         ep.title as position,
         case when m.photo_public_consent then m.photo_path else null end as photo_path
  from public.member_qr_tokens q
  join public.members m on m.id = q.member_id
  left join public.executive_members em on em.member_id = m.id
  left join public.executive_terms et on et.id = em.term_id and et.is_current
  left join public.executive_positions ep on ep.id = em.position_id
  where q.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and q.revoked_at is null
  limit 1;
$$;

create or replace function public.get_public_executive()
returns table(id uuid, full_name text, position text, biography text, photo_path text)
language sql stable security definer
set search_path = public
as $$
  select em.id,
         concat_ws(' ', m.first_name, m.last_name) as full_name,
         ep.title as position,
         em.biography,
         case when m.photo_public_consent then m.photo_path else null end as photo_path
  from public.executive_members em
  join public.executive_terms t on t.id = em.term_id and t.is_current
  join public.members m on m.id = em.member_id and m.status = 'active'
  join public.executive_positions ep on ep.id = em.position_id
  order by em.sort_order, ep.sort_order;
$$;

create or replace function public.get_visible_announcements(p_limit integer default 12)
returns table(id uuid, title text, slug text, summary text, body text, image_url text, is_pinned boolean, published_at timestamptz, visibility public.announcement_visibility)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.title, a.slug, a.summary, a.body, a.image_url, a.is_pinned, a.published_at, a.visibility
  from public.announcements a
  where a.is_published
    and (a.visibility = 'public' or public.is_assoc_member() or public.is_admin_user())
  order by a.is_pinned desc, a.published_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

create or replace function public.get_visible_announcement_by_slug(p_slug text)
returns table(id uuid, title text, slug text, summary text, body text, image_url text, is_pinned boolean, published_at timestamptz, visibility public.announcement_visibility)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.title, a.slug, a.summary, a.body, a.image_url, a.is_pinned, a.published_at, a.visibility
  from public.announcements a
  where a.slug = p_slug
    and a.is_published
    and (a.visibility = 'public' or public.is_assoc_member() or public.is_admin_user())
  limit 1;
$$;

create or replace function public.start_executive_term(p_term_title text, p_starts_on date, p_ends_on date default null)
returns uuid language plpgsql security definer
set search_path = public, auth
as $$
declare new_term_id uuid;
begin
  if not public.is_admin_user() then raise exception 'Accès refusé.' using errcode = '42501'; end if;
  if length(trim(p_term_title)) < 3 then raise exception 'Le nom du mandat est trop court.' using errcode = '22023'; end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then raise exception 'La date de fin précède la date de début.' using errcode = '22007'; end if;
  update public.executive_terms as existing_term
    set is_current = false, ends_on = coalesce(existing_term.ends_on, p_starts_on - 1)
    where existing_term.is_current;
  insert into public.executive_terms(title, starts_on, ends_on, is_current, created_by)
    values (trim(p_term_title), p_starts_on, p_ends_on, true, auth.uid())
    returning id into new_term_id;
  return new_term_id;
end;
$$;

-- Updated-at triggers.
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger members_touch_updated_at before update on public.members for each row execute function public.touch_updated_at();
create trigger announcements_touch_updated_at before update on public.announcements for each row execute function public.touch_updated_at();
create trigger financial_transactions_touch_updated_at before update on public.financial_transactions for each row execute function public.touch_updated_at();
create trigger protect_financial_transactions before update or delete on public.financial_transactions for each row execute function public.prevent_published_transaction_rewrite();
create trigger validate_contribution_payments before insert or update on public.contribution_payments for each row execute function public.validate_contribution_payment();
create trigger protect_contribution_payments before update or delete on public.contribution_payments for each row execute function public.prevent_contribution_payment_rewrite();
create trigger validate_contribution_allocations before insert or update on public.contribution_allocations for each row execute function public.validate_contribution_allocation();

-- Immutable audit trail for important changes.
create trigger audit_user_roles after insert or update or delete on public.user_roles for each row execute function public.write_audit_log();
create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function public.write_audit_log();
create trigger audit_members after insert or update or delete on public.members for each row execute function public.write_audit_log();
create trigger audit_member_private_details after insert or update or delete on public.member_private_details for each row execute function public.write_audit_log();
create trigger audit_membership_periods after insert or update or delete on public.membership_periods for each row execute function public.write_audit_log();
create trigger audit_member_qr_tokens after insert or update or delete on public.member_qr_tokens for each row execute function public.write_audit_log();
create trigger audit_settings after insert or update or delete on public.settings for each row execute function public.write_audit_log();
create trigger audit_executive_terms after insert or update or delete on public.executive_terms for each row execute function public.write_audit_log();
create trigger audit_executive_members after insert or update or delete on public.executive_members for each row execute function public.write_audit_log();
create trigger audit_executive_positions after insert or update or delete on public.executive_positions for each row execute function public.write_audit_log();
create trigger audit_announcements after insert or update or delete on public.announcements for each row execute function public.write_audit_log();
create trigger audit_documents after insert or update or delete on public.documents for each row execute function public.write_audit_log();
create trigger audit_transaction_categories after insert or update or delete on public.transaction_categories for each row execute function public.write_audit_log();
create trigger audit_financial_transactions after insert or update or delete on public.financial_transactions for each row execute function public.write_audit_log();
create trigger audit_financial_attachments after insert or update or delete on public.financial_attachments for each row execute function public.write_audit_log();
create trigger audit_contribution_plans after insert or update or delete on public.contribution_plans for each row execute function public.write_audit_log();
create trigger audit_contribution_dues after insert or update or delete on public.contribution_dues for each row execute function public.write_audit_log();
create trigger audit_contribution_payments after insert or update or delete on public.contribution_payments for each row execute function public.write_audit_log();
create trigger audit_contribution_allocations after insert or update or delete on public.contribution_allocations for each row execute function public.write_audit_log();

-- Row Level Security is enabled on every public table in this migration.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.settings enable row level security;
alter table public.members enable row level security;
alter table public.member_private_details enable row level security;
alter table public.membership_periods enable row level security;
alter table public.member_qr_tokens enable row level security;
alter table public.executive_terms enable row level security;
alter table public.executive_positions enable row level security;
alter table public.executive_members enable row level security;
alter table public.announcements enable row level security;
alter table public.documents enable row level security;
alter table public.transaction_categories enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.financial_attachments enable row level security;
alter table public.contribution_plans enable row level security;
alter table public.contribution_dues enable row level security;
alter table public.contribution_payments enable row level security;
alter table public.contribution_allocations enable row level security;
alter table public.audit_log enable row level security;

-- Profiles and roles.
create policy profiles_select_self_or_admin on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin_user());
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_admin_manage on public.profiles for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

create policy roles_select_self_or_super on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());
create policy roles_manage_super_only on public.user_roles for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy settings_super_read on public.settings for select to authenticated
  using (public.is_super_admin());
create policy settings_admin_manage on public.settings for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

-- Member directory fields exclude phone/email; private contact details are in a separate table.
create policy members_select_scoped on public.members for select to authenticated
  using (
    public.is_admin_user()
    or user_id = auth.uid()
    or (public.is_assoc_member() and (status = 'active' or public.setting_enabled('former_members_visibility')))
  );
create policy members_admin_insert on public.members for insert to authenticated
  with check (public.is_admin_user());
create policy members_admin_update on public.members for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
create policy members_admin_delete on public.members for delete to authenticated
  using (public.is_admin_user());

create policy private_details_select_owner_admin on public.member_private_details for select to authenticated
  using (public.is_admin_user() or exists (
    select 1 from public.members m where m.id = member_id and m.user_id = auth.uid()
  ));
create policy private_details_admin_manage on public.member_private_details for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

create policy membership_periods_select_scoped on public.membership_periods for select to authenticated
  using (public.is_admin_user() or exists (
    select 1 from public.members m where m.id = member_id and m.user_id = auth.uid()
  ));
create policy membership_periods_admin_manage on public.membership_periods for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

create policy qr_tokens_admin_only on public.member_qr_tokens for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

-- Executive roster and terms.
create policy executive_terms_public_current_or_member_archive on public.executive_terms for select to anon, authenticated
  using (is_current or public.is_assoc_member() or public.is_admin_user());
create policy executive_terms_admin_manage on public.executive_terms for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
create policy executive_positions_public_read on public.executive_positions for select to anon, authenticated
  using (is_active or public.is_admin_user());
create policy executive_positions_admin_manage on public.executive_positions for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
create policy executive_members_current_or_member_archive on public.executive_members for select to anon, authenticated
  using (
    exists (select 1 from public.executive_terms t where t.id = term_id and t.is_current)
    or public.is_assoc_member() or public.is_admin_user()
  );
create policy executive_members_admin_manage on public.executive_members for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

-- Public announcements only expose published public content. Member announcements require an authenticated member role.
create policy announcements_read_published on public.announcements for select to anon, authenticated
  using (
    (is_published and visibility = 'public')
    or (is_published and visibility = 'members' and public.is_assoc_member())
    or public.is_admin_user()
  );
create policy announcements_admin_manage on public.announcements for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

create policy documents_read_by_visibility on public.documents for select to anon, authenticated
  using (
    (published_at is not null and visibility = 'public')
    or (published_at is not null and visibility = 'members' and public.is_assoc_member())
    or (visibility = 'restricted' and public.is_admin_user())
    or public.is_admin_user()
  );
create policy documents_admin_manage on public.documents for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());

-- General finance is visible to members only after publication. Personal dues/payments are never exposed to admins by default.
create policy transaction_categories_read on public.transaction_categories for select to authenticated
  using (public.is_assoc_member() or public.is_finance_staff());
create policy transaction_categories_finance_manage on public.transaction_categories for all to authenticated
  using (public.is_finance_staff()) with check (public.is_finance_staff());

create policy transactions_published_or_finance_read on public.financial_transactions for select to authenticated
  using ((public.is_assoc_member() and is_published) or public.is_finance_staff());
create policy transactions_finance_insert on public.financial_transactions for insert to authenticated
  with check (public.is_finance_staff());
create policy transactions_finance_update on public.financial_transactions for update to authenticated
  using (public.is_finance_staff()) with check (public.is_finance_staff());
create policy transactions_finance_delete_drafts on public.financial_transactions for delete to authenticated
  using (public.is_finance_staff() and not is_published);

create policy financial_attachments_finance_only on public.financial_attachments for all to authenticated
  using (public.is_finance_staff()) with check (public.is_finance_staff());

create policy contribution_plans_member_read on public.contribution_plans for select to authenticated
  using ((public.is_assoc_member() and is_active) or public.is_finance_staff());
create policy contribution_plans_finance_manage on public.contribution_plans for all to authenticated
  using (public.is_finance_staff()) with check (public.is_finance_staff());

create policy contribution_dues_owner_finance_read on public.contribution_dues for select to authenticated
  using (public.is_finance_staff() or exists (
    select 1 from public.members m where m.id = member_id and m.user_id = auth.uid()
  ));
create policy contribution_dues_finance_manage on public.contribution_dues for all to authenticated
  using (public.is_finance_staff()) with check (public.is_finance_staff());

create policy contribution_payments_owner_finance_read on public.contribution_payments for select to authenticated
  using (public.is_finance_staff() or exists (
    select 1 from public.members m where m.id = member_id and m.user_id = auth.uid()
  ));
create policy contribution_payments_finance_manage on public.contribution_payments for all to authenticated
  using (public.is_finance_staff()) with check (public.is_finance_staff());

create policy contribution_allocations_owner_finance_read on public.contribution_allocations for select to authenticated
  using (public.is_finance_staff() or exists (
    select 1 from public.contribution_dues d join public.members m on m.id = d.member_id
    where d.id = due_id and m.user_id = auth.uid()
  ));
create policy contribution_allocations_finance_manage on public.contribution_allocations for all to authenticated
  using (public.is_finance_staff()) with check (public.is_finance_staff());

create policy audit_log_super_read on public.audit_log for select to authenticated
  using (public.is_super_admin());

-- No direct public read of member records or QR token hashes; only this limited verification function is exposed.
revoke all on function public.current_user_has_role(public.app_role) from public;
revoke all on function public.is_assoc_member() from public;
revoke all on function public.mfa_requirement_passed() from public;
revoke all on function public.is_finance_staff() from public;
revoke all on function public.is_admin_user() from public;
revoke all on function public.is_super_admin() from public;
revoke all on function public.setting_enabled(text) from public;
revoke all on function public.write_audit_log() from public;
revoke all on function public.create_profile_for_auth_user() from public;
revoke all on function public.protect_last_super_admin() from public;
revoke all on function public.touch_updated_at() from public;
revoke all on function public.prevent_published_transaction_rewrite() from public;
revoke all on function public.validate_contribution_payment() from public;
revoke all on function public.prevent_contribution_payment_rewrite() from public;
revoke all on function public.validate_contribution_allocation() from public;
revoke all on function public.verify_member_qr(text) from public;
revoke all on function public.get_public_executive() from public;
revoke all on function public.get_visible_announcements(integer) from public;
revoke all on function public.get_visible_announcement_by_slug(text) from public;
revoke all on function public.start_executive_term(text, date, date) from public;
grant execute on function public.current_user_has_role(public.app_role) to authenticated;
grant execute on function public.is_assoc_member() to anon, authenticated;
grant execute on function public.mfa_requirement_passed() to authenticated;
grant execute on function public.is_finance_staff() to authenticated;
grant execute on function public.is_admin_user() to anon, authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.setting_enabled(text) to authenticated;
grant execute on function public.verify_member_qr(text) to anon, authenticated;
grant execute on function public.get_public_executive() to anon, authenticated;
grant execute on function public.get_visible_announcements(integer) to anon, authenticated;
grant execute on function public.get_visible_announcement_by_slug(text) to anon, authenticated;
grant execute on function public.start_executive_term(text, date, date) to authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.announcements, public.executive_terms, public.executive_positions, public.executive_members, public.documents to anon;
revoke select on public.announcements, public.executive_members from anon;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
revoke all on public.member_qr_tokens from anon;
revoke all on public.audit_log from anon;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- Private Supabase Storage buckets. Public QR verification returns only a consented photo path;
-- image signing is done server-side in the QR module (Phase 2).
insert into storage.buckets(id, name, public)
values ('member-photos', 'member-photos', false),
       ('official-documents', 'official-documents', false),
       ('financial-attachments', 'financial-attachments', false)
on conflict (id) do nothing;

create policy member_photos_admin_manage on storage.objects for all to authenticated
  using (bucket_id = 'member-photos' and public.is_admin_user())
  with check (bucket_id = 'member-photos' and public.is_admin_user());
create policy member_photos_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and exists (
    select 1 from public.members m where m.user_id = auth.uid() and name like m.id::text || '/%'
  ));

create policy official_documents_read on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'official-documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = name
        and d.published_at is not null
        and (d.visibility = 'public' or (d.visibility = 'members' and public.is_assoc_member()) or public.is_admin_user())
    )
  );
create policy official_documents_admin_manage on storage.objects for all to authenticated
  using (bucket_id = 'official-documents' and public.is_admin_user())
  with check (bucket_id = 'official-documents' and public.is_admin_user());

create policy financial_attachments_finance_manage on storage.objects for all to authenticated
  using (bucket_id = 'financial-attachments' and public.is_finance_staff())
  with check (bucket_id = 'financial-attachments' and public.is_finance_staff());
