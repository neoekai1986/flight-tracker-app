-- Fare Board schema
-- Run this in your Supabase project's SQL Editor (Database > SQL Editor > New query).
-- Run schema.sql first, then policies.sql.

create extension if not exists citext;
create extension if not exists pgcrypto; -- for gen_random_uuid()

create table public.trip_folders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  position    double precision not null default 0,
  created_at  timestamptz not null default now()
);

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  folder_id     uuid references public.trip_folders(id) on delete set null,
  kind          text not null default 'flight',
  title         text not null,
  travel_start  date,
  travel_end    date,
  notes         text,
  attendees     text[] not null default '{}',
  position      double precision not null default 0,
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
  -- null = standalone one-way; outbound/return = paired one-way legs shown
  -- side by side; roundtrip = a single booking covering both directions.
  leg         text check (leg in ('outbound','return','roundtrip')),
  url         text,
  origin      text,   -- airport code, e.g. BWI — used to auto-generate the label
  destination text,   -- airport code, e.g. DEN
  depart_date date,
  depart_time time,
  return_date date,   -- roundtrip only
  return_time time,   -- roundtrip only
  currency    text not null default 'USD',
  paid_cash   numeric,
  paid_points numeric,
  passengers  integer not null default 1 check (passengers >= 1),
  flight_number     text,
  confirmation_code text,
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
  confirmation_code text,
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

-- Screenshots attached to a flight or rental (confirmation emails, boarding
-- passes, listing pages). The actual image bytes live in Storage under the
-- "attachments" bucket, at path "{trip_id}/{uuid}.{ext}"; this row is the
-- metadata + OCR text extracted from it client-side (Tesseract.js — no
-- server call, so ocr_text is best-effort raw text, not verified fields).
create table public.attachments (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  flight_id   uuid references public.flights(id) on delete cascade,
  rental_id   uuid references public.rentals(id) on delete cascade,
  storage_path text not null,
  filename    text,
  ocr_text    text,
  created_at  timestamptz not null default now(),
  check ( (flight_id is not null)::int + (rental_id is not null)::int = 1 )
);

create index on public.trip_folders (owner_id, position);
create index on public.trips (folder_id, position);
create index on public.trip_collaborators (trip_id);
create index on public.trip_collaborators (email);
create index on public.flights (trip_id, leg, position);
create index on public.price_logs (flight_id, date);
create index on public.rentals (trip_id, position);
create index rentals_reminder_due on public.rentals (cancel_by)
  where cancel_by is not null and reminded_at is null;
create index on public.attachments (flight_id);
create index on public.attachments (rental_id);

-- Screenshot storage: create a bucket named exactly "attachments" via the
-- Supabase dashboard (Storage > New bucket, "Public bucket" left UNCHECKED).
-- Creating it via SQL (`insert into storage.buckets`) is unreliable — it can
-- silently fail or abort the rest of the script depending on the project's
-- permissions, so this is a manual step. RLS (in policies.sql), not bucket
-- privacy, is what actually gates access to the files.
