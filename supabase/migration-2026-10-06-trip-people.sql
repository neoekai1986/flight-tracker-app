-- Migration: people on a trip, what each of them owes, and who paid.
-- Run once in the SQL Editor. Safe to run more than once.

-- The travellers on a trip. Replaces the free-text trips.attendees array:
-- a row with a stable id means a cost recorded against someone survives
-- renaming them, which an array of names cannot.
create table if not exists public.trip_people (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  name        text not null,
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);

-- Per-person detail on one booking. A row means "this person is on this
-- booking"; reference and cost are theirs where they differ from the rest.
-- cost is what this person owes for it, not what they handed over — who
-- actually paid is on the booking itself (paid_by below).
create table if not exists public.booking_people (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  person_id   uuid not null references public.trip_people(id) on delete cascade,
  flight_id   uuid references public.flights(id) on delete cascade,
  rental_id   uuid references public.rentals(id) on delete cascade,
  reference   text,
  cost        numeric,
  created_at  timestamptz not null default now(),
  check ( (flight_id is not null)::int + (rental_id is not null)::int = 1 ),
  unique (person_id, flight_id),
  unique (person_id, rental_id)
);

-- Who paid for a booking. Null means the trip's owner — you — which is the
-- default, so an unfilled trip behaves exactly as it does today.
alter table public.flights add column if not exists paid_by uuid references public.trip_people(id) on delete set null;
alter table public.rentals add column if not exists paid_by uuid references public.trip_people(id) on delete set null;

-- Where you're staying. The summary itinerary needs somewhere to send you.
alter table public.rentals add column if not exists address text;

create index if not exists trip_people_trip_idx on public.trip_people (trip_id, position);
create index if not exists booking_people_trip_idx on public.booking_people (trip_id);
create index if not exists booking_people_flight_idx on public.booking_people (flight_id);
create index if not exists booking_people_rental_idx on public.booking_people (rental_id);

alter table public.trip_people enable row level security;
alter table public.booking_people enable row level security;

revoke all on public.trip_people, public.booking_people from anon;
grant select, insert, update, delete on public.trip_people, public.booking_people to authenticated;

-- Same access as everything else hanging off a trip: owner or invited
-- collaborator, via the security definer helper that already exists.
drop policy if exists trip_people_select on public.trip_people;
create policy trip_people_select on public.trip_people
  for select using ( public.can_access_trip(trip_id) );
drop policy if exists trip_people_insert on public.trip_people;
create policy trip_people_insert on public.trip_people
  for insert with check ( public.can_access_trip(trip_id) );
drop policy if exists trip_people_update on public.trip_people;
create policy trip_people_update on public.trip_people
  for update using ( public.can_access_trip(trip_id) ) with check ( public.can_access_trip(trip_id) );
drop policy if exists trip_people_delete on public.trip_people;
create policy trip_people_delete on public.trip_people
  for delete using ( public.can_access_trip(trip_id) );

drop policy if exists booking_people_select on public.booking_people;
create policy booking_people_select on public.booking_people
  for select using ( public.can_access_trip(trip_id) );
drop policy if exists booking_people_insert on public.booking_people;
create policy booking_people_insert on public.booking_people
  for insert with check ( public.can_access_trip(trip_id) );
drop policy if exists booking_people_update on public.booking_people;
create policy booking_people_update on public.booking_people
  for update using ( public.can_access_trip(trip_id) ) with check ( public.can_access_trip(trip_id) );
drop policy if exists booking_people_delete on public.booking_people;
create policy booking_people_delete on public.booking_people
  for delete using ( public.can_access_trip(trip_id) );

-- Carry the existing free-text attendees across, in the order they were
-- listed. trips.attendees is left in place rather than dropped: nothing
-- reads it afterwards, and keeping it means this migration is reversible.
insert into public.trip_people (trip_id, name, position)
select t.id, trim(a.name), (a.ord - 1) * 1000
from public.trips t
cross join lateral unnest(t.attendees) with ordinality as a(name, ord)
where trim(a.name) <> ''
  and not exists (
    select 1 from public.trip_people p
    where p.trip_id = t.id and lower(p.name) = lower(trim(a.name))
  );
