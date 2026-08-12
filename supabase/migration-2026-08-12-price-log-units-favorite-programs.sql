-- Migration: points-vs-cash price checks + favorited loyalty programs.
-- For projects created before this feature. Run once in the SQL Editor.
-- (Fresh installs don't need this — schema.sql/policies.sql already
-- include it.)

-- A logged price check can now be in points instead of cash (e.g. "I saw
-- this for 25,000 points today") — price_logs.price stays a plain number,
-- this flag says how to format/compare it.
alter table public.price_logs
  add column is_points boolean not null default false;

-- Personal list of loyalty programs starred to the top of the
-- points-program picker (flights: airlines, hotel-kind rentals: chains).
create table public.favorite_points_programs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  program     text not null,
  created_at  timestamptz not null default now(),
  unique (owner_id, program)
);

create index on public.favorite_points_programs (owner_id);

alter table public.favorite_points_programs enable row level security;
revoke all on public.favorite_points_programs from anon;
grant select, insert, delete on public.favorite_points_programs to authenticated;

create policy favorite_points_programs_select on public.favorite_points_programs
  for select using ( owner_id = auth.uid() );

create policy favorite_points_programs_insert on public.favorite_points_programs
  for insert with check ( owner_id = auth.uid() );

create policy favorite_points_programs_delete on public.favorite_points_programs
  for delete using ( owner_id = auth.uid() );
