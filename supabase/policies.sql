-- Fare Board Row Level Security
-- Run this AFTER schema.sql, in the same SQL Editor.

-- Returns true if the current session's email is an invited collaborator on
-- this trip. security definer so it can read trip_collaborators without
-- re-triggering RLS (which would recurse with trips' own policy).
create or replace function public.is_trip_collaborator(p_trip_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.trip_collaborators c
    where c.trip_id = p_trip_id
      and c.email = auth.email()::citext
  );
$$;

-- Returns true if the current session can read/write this trip
-- (owner, or an invited collaborator matched by email).
create or replace function public.can_access_trip(p_trip_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id
      and (
        t.owner_id = auth.uid()
        or exists (
          select 1 from public.trip_collaborators c
          where c.trip_id = t.id
            and c.email = auth.email()::citext
        )
      )
  );
$$;

-- One join further, for price_logs.
create or replace function public.can_access_flight(p_flight_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.flights f
    where f.id = p_flight_id
      and public.can_access_trip(f.trip_id)
  );
$$;

alter table public.trips enable row level security;
alter table public.trip_collaborators enable row level security;
alter table public.flights enable row level security;
alter table public.price_logs enable row level security;

-- Only logged-in users get any access at all; RLS scopes it further per-row.
revoke all on public.trips, public.trip_collaborators, public.flights, public.price_logs from anon;
grant select, insert, update, delete on public.trips, public.flights, public.price_logs to authenticated;
grant select, insert, delete on public.trip_collaborators to authenticated;

-- Ownership can't be reassigned via UPDATE (simpler and airtight vs. expressing
-- this in RLS's WITH CHECK).
create or replace function public.lock_trip_owner()
returns trigger language plpgsql as $$
begin
  if NEW.owner_id <> OLD.owner_id then
    raise exception 'owner_id cannot be changed directly';
  end if;
  NEW.updated_at = now();
  return NEW;
end;
$$;

create trigger trips_lock_owner
  before update on public.trips
  for each row execute function public.lock_trip_owner();

-- trips
-- NOTE: the owner check must be a direct column comparison (not a subquery
-- through can_access_trip) so that INSERT ... RETURNING can see the row it
-- just inserted — a subquery-based policy can't see same-statement inserts,
-- which makes insert-and-return fail with a spurious RLS violation.
create policy trips_select on public.trips
  for select using ( owner_id = auth.uid() or public.is_trip_collaborator(id) );

create policy trips_insert on public.trips
  for insert with check ( owner_id = auth.uid() );

create policy trips_update on public.trips
  for update using ( public.can_access_trip(id) )
  with check ( public.can_access_trip(id) );

create policy trips_delete on public.trips
  for delete using ( owner_id = auth.uid() );

-- trip_collaborators
create policy collaborators_select on public.trip_collaborators
  for select using (
    trip_id in (select id from public.trips where owner_id = auth.uid())
    or email = auth.email()::citext
  );

create policy collaborators_insert on public.trip_collaborators
  for insert with check (
    trip_id in (select id from public.trips where owner_id = auth.uid())
  );

create policy collaborators_delete on public.trip_collaborators
  for delete using (
    trip_id in (select id from public.trips where owner_id = auth.uid())
    or email = auth.email()::citext
  );

-- flights
create policy flights_select on public.flights
  for select using ( public.can_access_trip(trip_id) );

create policy flights_insert on public.flights
  for insert with check ( public.can_access_trip(trip_id) );

create policy flights_update on public.flights
  for update using ( public.can_access_trip(trip_id) )
  with check ( public.can_access_trip(trip_id) );

create policy flights_delete on public.flights
  for delete using ( public.can_access_trip(trip_id) );

-- price_logs
create policy price_logs_select on public.price_logs
  for select using ( public.can_access_flight(flight_id) );

create policy price_logs_insert on public.price_logs
  for insert with check ( public.can_access_flight(flight_id) );

create policy price_logs_update on public.price_logs
  for update using ( public.can_access_flight(flight_id) )
  with check ( public.can_access_flight(flight_id) );

create policy price_logs_delete on public.price_logs
  for delete using ( public.can_access_flight(flight_id) );
