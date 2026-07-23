-- Migration: rentals (car + housing) and structured flight fields.
-- For projects created before this feature. Run once in the SQL Editor.
-- (Fresh installs don't need this — schema.sql/policies.sql already include it.)

create table public.rentals (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  kind         text not null default 'housing' check (kind in ('car','housing')),
  label        text not null,
  url          text,
  currency     text not null default 'USD',
  paid_cash    numeric,
  paid_points  numeric,
  rental_start date,
  rental_end   date,
  cancel_by    date,
  reminded_at  timestamptz,  -- set by the reminder job once the 5-days-out email is sent
  notes        text,
  position     double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.rentals (trip_id, position);
create index rentals_reminder_due on public.rentals (cancel_by)
  where cancel_by is not null and reminded_at is null;

alter table public.rentals enable row level security;
revoke all on public.rentals from anon;
grant select, insert, update, delete on public.rentals to authenticated;

create policy rentals_select on public.rentals
  for select using ( public.can_access_trip(trip_id) );

create policy rentals_insert on public.rentals
  for insert with check ( public.can_access_trip(trip_id) );

create policy rentals_update on public.rentals
  for update using ( public.can_access_trip(trip_id) )
  with check ( public.can_access_trip(trip_id) );

create policy rentals_delete on public.rentals
  for delete using ( public.can_access_trip(trip_id) );

-- Structured flight fields so titles can be auto-generated from
-- date/time + airports + amount paid.
alter table public.flights
  add column origin text,
  add column destination text,
  add column depart_date date,
  add column depart_time time;
