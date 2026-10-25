-- Migration: a master list of people, households, and ski-day economics.
-- Run once in the SQL Editor. Safe to run more than once.

-- Households. A person belongs to at most one, so this is a plain parent
-- rather than a join table — "the Nguyens" settle together.
create table if not exists public.person_groups (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);

-- The master list. Account-level, not per-trip: the same person turns up on
-- many trips and their running total is the point of having them here.
create table if not exists public.people (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  email       text,
  group_id    uuid references public.person_groups(id) on delete set null,
  -- Exactly one row per account is you. Enforced by the partial index below.
  is_self     boolean not null default false,
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);

create unique index if not exists people_one_self
  on public.people (owner_id) where is_self;

-- trip_people stays the "who's on this trip" row; it now points at the master
-- record instead of carrying a loose name, so booking_people keeps working
-- untouched and a rename lands everywhere at once.
alter table public.trip_people
  add column if not exists person_id uuid references public.people(id) on delete cascade;

-- Ski-day economics. The field only shows on trips filed under a category
-- marked as skiing.
alter table public.trip_categories add column if not exists is_ski boolean not null default false;
alter table public.trips add column if not exists ski_days integer;

create index if not exists people_owner_idx on public.people (owner_id, position);
create index if not exists person_groups_owner_idx on public.person_groups (owner_id, position);
create index if not exists trip_people_person_idx on public.trip_people (person_id);

alter table public.people enable row level security;
alter table public.person_groups enable row level security;
revoke all on public.people, public.person_groups from anon;
grant select, insert, update, delete on public.people, public.person_groups to authenticated;

-- Your own list. Collaborators on a trip don't get to read it: it spans every
-- trip you have, most of which they aren't on.
drop policy if exists people_select on public.people;
create policy people_select on public.people for select using ( owner_id = auth.uid() );
drop policy if exists people_insert on public.people;
create policy people_insert on public.people for insert with check ( owner_id = auth.uid() );
drop policy if exists people_update on public.people;
create policy people_update on public.people for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );
drop policy if exists people_delete on public.people;
create policy people_delete on public.people for delete using ( owner_id = auth.uid() );

drop policy if exists person_groups_select on public.person_groups;
create policy person_groups_select on public.person_groups for select using ( owner_id = auth.uid() );
drop policy if exists person_groups_insert on public.person_groups;
create policy person_groups_insert on public.person_groups for insert with check ( owner_id = auth.uid() );
drop policy if exists person_groups_update on public.person_groups;
create policy person_groups_update on public.person_groups for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );
drop policy if exists person_groups_delete on public.person_groups;
create policy person_groups_delete on public.person_groups for delete using ( owner_id = auth.uid() );

-- Carry existing per-trip names up into the master list, one master row per
-- distinct name per account, then point the trip rows at them.
insert into public.people (owner_id, name, position)
select distinct on (t.owner_id, lower(tp.name)) t.owner_id, tp.name, 0
from public.trip_people tp
join public.trips t on t.id = tp.trip_id
where tp.person_id is null
  and not exists (
    select 1 from public.people p
    where p.owner_id = t.owner_id and lower(p.name) = lower(tp.name)
  );

update public.trip_people tp
set person_id = p.id
from public.trips t, public.people p
where tp.trip_id = t.id
  and tp.person_id is null
  and p.owner_id = t.owner_id
  and lower(p.name) = lower(tp.name);

-- You, as a person. Named from the account email until renamed, so there's
-- something to attach your own share to rather than an implicit "You".
insert into public.people (owner_id, name, email, is_self, position)
select u.id, split_part(u.email, '@', 1), u.email, true, -1000
from auth.users u
where not exists ( select 1 from public.people p where p.owner_id = u.id and p.is_self );
