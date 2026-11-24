-- Allow the server-only service_role to finalize the first-password-change flag.
-- Keep this access column-scoped; browser roles do not receive these privileges.
grant select (user_id), update (must_change_password)
on table public.profiles
to service_role;
