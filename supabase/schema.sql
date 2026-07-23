-- Fare Board schema
-- Run this in your Supabase project's SQL Editor (Database > SQL Editor > New query).
-- Run schema.sql first, then policies.sql.

create extension if not exists citext;
create extension if not exists pgcrypto; -- for gen_random_uuid()

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  kind          text not null default 'flight',
  title         text not null,
  travel_start  date,
  travel_end    date,
  notes         text,
  attendees     text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.trip_collaborators (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  email       citext not null,
  invited_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (trip_id, email)
);

create table public.flights (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  label       text not null,
  leg         text check (leg in ('outbound','return')), -- null = unassigned/single list
  url         text,
  origin      text,   -- airport code, e.g. BWI — used to auto-generate the label
  destination text,   -- airport code, e.g. DEN
  depart_date date,
  depart_time time,
  currency    text not null default 'USD',
  paid_cash   numeric,
  paid_points numeric,
  alert_below numeric,
  notes       text,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

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

create table public.price_logs (
  id          uuid primary key default gen_random_uuid(),
  flight_id   uuid not null references public.flights(id) on delete cascade,
  date        date not null,
  price       numeric not null,
  created_at  timestamptz not null default now()
);

create index on public.trip_collaborators (trip_id);
create index on public.trip_collaborators (email);
create index on public.flights (trip_id, leg, position);
create index on public.price_logs (flight_id, date);
create index on public.rentals (trip_id, position);
create index rentals_reminder_due on public.rentals (cancel_by)
  where cancel_by is not null and reminded_at is null;
