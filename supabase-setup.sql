-- Canvass Team ERP: shared lead storage and team access.
-- Run this in Supabase SQL Editor before inviting team members.

create table if not exists public.team_members (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Team member',
  created_at timestamptz not null default now()
);

create or replace function public.add_team_member_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.team_members (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), new.email, 'Team member')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_team_profile on auth.users;
create trigger on_auth_user_created_team_profile
  after insert on auth.users
  for each row execute procedure public.add_team_member_profile();

create table if not exists public.business_leads (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members where id = (select auth.uid())
  );
$$;

alter table public.team_members enable row level security;
alter table public.business_leads enable row level security;

drop policy if exists "Team can view members" on public.team_members;
create policy "Team can view members" on public.team_members
  for select to authenticated using (public.is_team_member());

drop policy if exists "Team can update own profile" on public.team_members;
create policy "Team can update own profile" on public.team_members
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Team can read leads" on public.business_leads;
create policy "Team can read leads" on public.business_leads
  for select to authenticated using (public.is_team_member());

drop policy if exists "Team can add leads" on public.business_leads;
create policy "Team can add leads" on public.business_leads
  for insert to authenticated with check (public.is_team_member() and created_by = (select auth.uid()));

drop policy if exists "Team can update leads" on public.business_leads;
create policy "Team can update leads" on public.business_leads
  for update to authenticated using (public.is_team_member())
  with check (public.is_team_member());

drop policy if exists "Team can delete leads" on public.business_leads;
create policy "Team can delete leads" on public.business_leads
  for delete to authenticated using (public.is_team_member());

grant select, update on public.team_members to authenticated;
grant select, insert, update, delete on public.business_leads to authenticated;
grant execute on function public.is_team_member() to authenticated;

-- In Supabase Auth settings, turn off public sign-ups and invite only your four team emails.
