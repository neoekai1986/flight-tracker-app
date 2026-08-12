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

-- Personal tags like "Ski trip" / "Family trip" / "Personal trip" — a
-- separate, orthogonal dimension from folders, used to break the cost
-- stats out per category.
create table public.trip_categories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  created_at  timestamptz not null default now()
);

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  folder_id     uuid references public.trip_folders(id) on delete set null,
  category_id   uuid references public.trip_categories(id) on delete set null,
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
  -- "booked": counts toward this trip's total and every summary stat.
  -- "watching": still comparing options — shown in its own "Watching" section
  -- and excluded from all cost rollups until promoted to booked.
  status      text not null default 'booked' check (status in ('booked','watching')),
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
  points_program text,  -- loyalty program the points came from, e.g. "Southwest", "Hilton Honors" — free text, no fixed list
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
  -- Same booked/watching split as flights.status — see the comment there.
  status       text not null default 'booked' check (status in ('booked','watching')),
  url          text,
  currency     text not null default 'USD',
  paid_cash    numeric,
  paid_points  numeric,
  points_program text,  -- same as flights.points_program
  rental_start date,
  rental_end   date,
  cancel_by    date,
  reminded_at  timestamptz,  -- set by the reminder job once the 5-days-out email is sent
  confirmation_code text,
  -- Up to 5 "who paid what" entries: [{name, percent, amount}, ...]. Each
  -- entry gives either a percent of paid_cash or a flat amount (whichever
  -- the user filled in) — informational only, not enforced to sum to 100%.
  splits       jsonb not null default '[]'::jsonb,
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
  -- true when `price` is a points count instead of a cash amount (e.g. "I
  -- saw this for 25,000 points today").
  is_points   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Personal list of loyalty programs starred to the top of the
-- points-program picker (flights: airlines, hotel-kind rentals: chains).
create table public.favorite_points_programs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  program     text not null,
  created_at  timestamptz not null default now(),
  unique (owner_id, program)
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

-- Wish List Planning: a shared space (separate from trips) where family
-- members pitch destination ideas — each entry is a "1-minute elevator
-- pitch" with a photo, why-visit blurb, and a things-to-do list.
create table public.wishlist_boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Family Vacation Wishlist',
  created_at  timestamptz not null default now()
);

create table public.wishlist_collaborators (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.wishlist_boards(id) on delete cascade,
  email       citext not null,
  invited_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (board_id, email)
);

-- One row per user, reused across every entry they submit on any board.
create table public.wishlist_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_path   text,
  updated_at    timestamptz not null default now()
);

create table public.wishlist_entries (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.wishlist_boards(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  title         text not null,
  location      text,
  photo_path    text,
  blurb         text,
  things_to_do  text,
  position      double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.trip_folders (owner_id, position);
create index on public.trip_categories (owner_id);
create index on public.trips (folder_id, position);
create index on public.trips (category_id);
create index on public.trip_collaborators (trip_id);
create index on public.trip_collaborators (email);
create index on public.flights (trip_id, leg, position);
create index on public.price_logs (flight_id, date);
create index on public.favorite_points_programs (owner_id);
create index on public.rentals (trip_id, position);
create index rentals_reminder_due on public.rentals (cancel_by)
  where cancel_by is not null and reminded_at is null;
create index on public.attachments (flight_id);
create index on public.attachments (rental_id);
create index on public.wishlist_collaborators (board_id);
create index on public.wishlist_collaborators (email);
create index on public.wishlist_entries (board_id, position);

-- Screenshot storage: create a bucket named exactly "attachments" via the
-- Supabase dashboard (Storage > New bucket, "Public bucket" left UNCHECKED).
-- Creating it via SQL (`insert into storage.buckets`) is unreliable — it can
-- silently fail or abort the rest of the script depending on the project's
-- permissions, so this is a manual step. RLS (in policies.sql), not bucket
-- privacy, is what actually gates access to the files.
--
-- Wish List Planning needs a second bucket, named exactly "wishlist", created
-- the same manual way (dashboard, not SQL) — private, RLS-gated.
