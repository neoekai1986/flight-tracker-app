-- Migration: personal trip categories (Ski trip, Family trip, Personal
-- trip, etc.) — a second, orthogonal tag dimension alongside folders, used
-- to break the cost stats out per category. For projects created before
-- this feature. Run once in the SQL Editor. (Fresh installs don't need
-- this — schema.sql/policies.sql already include it.)

create table public.trip_categories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  created_at  timestamptz not null default now()
);

alter table public.trips
  add column category_id uuid references public.trip_categories(id) on delete set null;

create index on public.trip_categories (owner_id);
create index on public.trips (category_id);

alter table public.trip_categories enable row level security;
revoke all on public.trip_categories from anon;
grant select, insert, update, delete on public.trip_categories to authenticated;

create policy trip_categories_select on public.trip_categories
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.category_id = trip_categories.id and public.can_access_trip(t.id)
    )
  );

create policy trip_categories_insert on public.trip_categories
  for insert with check ( owner_id = auth.uid() );

create policy trip_categories_update on public.trip_categories
  for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );

create policy trip_categories_delete on public.trip_categories
  for delete using ( owner_id = auth.uid() );
