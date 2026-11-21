-- Migration: who settles up for a household.
-- Run once in the SQL Editor. Safe to run more than once.

-- A household already settles as one, but its share was divided between its
-- members for their running totals. That isn't how a family actually pays:
-- one person hands the money over and the rest of them are simply there.
-- Naming that person puts the household's share on them whole, and leaves
-- everyone else in the household listed on the booking at nothing — which is
-- the truth, and is what makes "who's in this bedroom" answerable from the
-- one name you picked.
--
-- Null means nobody has said, and those households keep dividing between
-- their members exactly as before.
alter table public.person_groups
  add column if not exists head_id uuid references public.people(id) on delete set null;
