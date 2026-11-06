-- Tailbone Treatment, phase 1: tables and security rules for the clinic dashboard (Supabase project "tailbone-clinic").
-- Run once in Supabase → SQL Editor. Website content is public to read; writing needs a staff account that has passed
-- two-step sign-in (aal2). Launch settings are super admin only.

create table public.staff (
  email text primary key check (email = lower(email) and email like '%@%'),
  name text not null default '',
  role text not null check (role in ('superadmin', 'doctor')),
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text not null default ''
);

create table public.site_content (
  key text primary key check (key in ('announcement', 'hours', 'contact', 'faq', 'press', 'videos', 'launch')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create table public.site_content_history (
  id bigint generated always as identity primary key,
  key text not null,
  value jsonb,                      -- the version before the change; null = the website's built-in content
  changed_at timestamptz not null default now(),
  changed_by text not null default ''
);
create index site_content_history_key on public.site_content_history (key, id desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text not null default ''
);

-- The signed-in person's role, only when they have passed two-step sign-in and are not disabled.
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select s.role from public.staff s
  where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and not s.disabled
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
revoke all on function public.staff_role() from public;
grant execute on function public.staff_role() to authenticated, anon;

-- Who changed what: kept automatically, last 30 versions per area.
create or replace function public.site_content_keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := lower(coalesce(auth.jwt() ->> 'email', 'system'));
begin
  if tg_op = 'INSERT' then
    insert into public.site_content_history (key, value, changed_by) values (new.key, null, who);
  else
    insert into public.site_content_history (key, value, changed_by) values (old.key, old.value, who);
  end if;
  delete from public.site_content_history h
   where h.key = coalesce(new.key, old.key)
     and h.id not in (select id from public.site_content_history where key = coalesce(new.key, old.key) order by id desc limit 30);
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  new.updated_by := who;
  return new;
end $$;
create trigger site_content_history before insert or update or delete on public.site_content
  for each row execute function public.site_content_keep_history();

alter table public.staff enable row level security;
alter table public.site_content enable row level security;
alter table public.site_content_history enable row level security;
alter table public.audit_log enable row level security;

create policy "content readable by everyone" on public.site_content for select to anon, authenticated using (true);
create policy "staff write content" on public.site_content for insert to authenticated
  with check (public.staff_role() is not null and (key <> 'launch' or public.staff_role() = 'superadmin'));
create policy "staff update content" on public.site_content for update to authenticated
  using (public.staff_role() is not null and (key <> 'launch' or public.staff_role() = 'superadmin'))
  with check (public.staff_role() is not null and (key <> 'launch' or public.staff_role() = 'superadmin'));
create policy "staff reset content" on public.site_content for delete to authenticated
  using (public.staff_role() is not null and key <> 'launch');

create policy "staff read history" on public.site_content_history for select to authenticated using (public.staff_role() is not null);

create policy "staff see themselves, super admin sees all" on public.staff for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.staff_role() = 'superadmin');
create policy "super admin adds staff" on public.staff for insert to authenticated with check (public.staff_role() = 'superadmin');
create policy "super admin edits staff" on public.staff for update to authenticated
  using (public.staff_role() = 'superadmin') with check (public.staff_role() = 'superadmin');
create policy "super admin removes staff" on public.staff for delete to authenticated
  using (public.staff_role() = 'superadmin' and email <> lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "super admin reads log" on public.audit_log for select to authenticated using (public.staff_role() = 'superadmin');
create policy "staff write log" on public.audit_log for insert to authenticated
  with check (public.staff_role() is not null and actor = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Pictures for newspaper clippings: public to read, staff to add (4 MB, JPG/PNG/WebP).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 4194304, array['image/jpeg', 'image/png', 'image/webp']);
create policy "staff upload site media" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and public.staff_role() is not null);
create policy "staff remove site media" on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and public.staff_role() is not null);

-- The owner's super admin account (the login itself is created in Supabase → Authentication → Users).
insert into public.staff (email, name, role, created_by) values ('join2ajkumar@gmail.com', 'Owner', 'superadmin', 'setup');

-- Security check follow-up: the history function runs only as a trigger; staff_role() is for signed-in users.
revoke execute on function public.site_content_keep_history() from public, anon, authenticated;
revoke execute on function public.staff_role() from anon;
