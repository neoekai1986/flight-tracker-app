-- Migration: trip folders + tab ordering, round-trip flights, passenger
-- multiplier. For projects created before this feature. Run once in the
-- SQL Editor. (Fresh installs don't need this — schema.sql/policies.sql
-- already include it.)

create table public.trip_folders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.trips
  add column folder_id uuid references public.trip_folders(id) on delete set null,
  add column position double precision not null default 0;

create index on public.trip_folders (owner_id, position);
create index on public.trips (folder_id, position);

alter table public.trip_folders enable row level security;
revoke all on public.trip_folders from anon;
grant select, insert, update, delete on public.trip_folders to authenticated;

create policy trip_folders_select on public.trip_folders
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.folder_id = trip_folders.id and public.can_access_trip(t.id)
    )
  );

create policy trip_folders_insert on public.trip_folders
  for insert with check ( owner_id = auth.uid() );

create policy trip_folders_update on public.trip_folders
  for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );

create policy trip_folders_delete on public.trip_folders
  for delete using ( owner_id = auth.uid() );

-- Round-trip flights (single booking, both directions) and a passenger
-- multiplier for the cost total.
alter table public.flights drop constraint if exists flights_leg_check;
alter table public.flights add constraint flights_leg_check
  check (leg in ('outbound','return','roundtrip'));

alter table public.flights
  add column return_date date,
  add column return_time time,
  add column passengers integer not null default 1 check (passengers >= 1);
