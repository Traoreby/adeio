-- Session/navigation performance support. The primary key on user_roles already
-- starts with user_id; the additional indexes cover the list filters and sort.
create index if not exists announcements_visible_page_idx
  on public.announcements (is_published, visibility, is_pinned desc, published_at desc);
create index if not exists members_status_name_page_idx
  on public.members (status, last_name, first_name, id);
create index if not exists membership_periods_end_start_idx
  on public.membership_periods (ends_on, starts_on, member_id);

drop function if exists public.get_visible_announcements(integer);
create function public.get_visible_announcements(p_limit integer default 12, p_offset integer default 0)
returns table(id uuid, title text, slug text, summary text, body text, image_url text, is_pinned boolean, published_at timestamptz, visibility public.announcement_visibility)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.title, a.slug, a.summary, a.body, a.image_url, a.is_pinned, a.published_at, a.visibility
  from public.announcements a
  where a.is_published
    and (a.visibility = 'public' or public.is_assoc_member() or public.is_admin_user())
  order by a.is_pinned desc, a.published_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_visible_announcements(integer, integer) from public;
grant execute on function public.get_visible_announcements(integer, integer) to anon, authenticated;
