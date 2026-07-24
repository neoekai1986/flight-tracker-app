-- Migration: rental payment splits ("who paid what"). For projects created
-- before this feature. Run once in the SQL Editor. (Fresh installs don't
-- need this — schema.sql already includes it.)

alter table public.rentals
  add column splits jsonb not null default '[]'::jsonb;
