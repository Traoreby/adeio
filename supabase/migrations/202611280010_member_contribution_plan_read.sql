-- Allow a signed-in member to read only the contribution plans referenced by
-- that member's own dues. Finance roles keep their existing access unchanged.
-- This exposes plan metadata needed by the member contribution view without
-- granting access to plans that are unrelated to their account.

drop policy if exists contribution_plans_member_owned_dues_read on public.contribution_plans;
create policy contribution_plans_member_owned_dues_read
  on public.contribution_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.contribution_dues dues
      join public.members member on member.id = dues.member_id
      where dues.plan_id = contribution_plans.id
        and member.user_id = auth.uid()
    )
  );
