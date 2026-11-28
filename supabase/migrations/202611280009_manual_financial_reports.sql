-- Manual, versioned financial reports. Existing published reports stay unchanged.

alter table public.financial_reports
  alter column published_at drop not null,
  alter column published_at drop default,
  add column if not exists report_data jsonb,
  add column if not exists version integer not null default 1,
  add column if not exists previous_version_id uuid references public.financial_reports(id) on delete restrict,
  add column if not exists author_name text,
  add column if not exists published_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.financial_reports
  add constraint financial_reports_version_positive check (version > 0),
  add constraint financial_reports_version_parent_check check (
    (version = 1 and previous_version_id is null) or (version > 1 and previous_version_id is not null)
  ),
  add constraint financial_reports_data_object check (report_data is null or jsonb_typeof(report_data) = 'object');

create unique index financial_reports_previous_version_unique
  on public.financial_reports(previous_version_id)
  where previous_version_id is not null;
create index financial_reports_draft_period_idx
  on public.financial_reports(published_at, period_end desc, created_at desc);

drop policy if exists financial_reports_finance_insert on public.financial_reports;
drop policy if exists financial_reports_finance_update on public.financial_reports;
drop policy if exists financial_reports_finance_delete on public.financial_reports;

-- Reports are written only by the Treasurer (and only with an MFA-compliant
-- session when the account requires MFA). Auditors and Super Admins retain the
-- existing read access and cannot publish or rewrite reports.
create policy financial_reports_treasurer_insert on public.financial_reports
  for insert to authenticated
  with check (
    public.current_user_has_role('treasurer'::public.app_role)
    and not public.current_user_has_role('super_admin'::public.app_role)
    and public.mfa_requirement_passed()
    and published_at is null
  );

create policy financial_reports_treasurer_update_draft on public.financial_reports
  for update to authenticated
  using (
    public.current_user_has_role('treasurer'::public.app_role)
    and not public.current_user_has_role('super_admin'::public.app_role)
    and public.mfa_requirement_passed()
    and published_at is null
  )
  with check (
    public.current_user_has_role('treasurer'::public.app_role)
    and not public.current_user_has_role('super_admin'::public.app_role)
    and public.mfa_requirement_passed()
  );

revoke delete on public.financial_reports from authenticated;
grant select, insert, update on public.financial_reports to authenticated;
