-- Migration: set a card aside without losing it.
-- Run once in the SQL Editor. Safe to run more than once.

-- An option you looked at and ruled out is worth keeping — the price history,
-- the times, what you worked out about it — but it shouldn't be in the way.
-- Deleting is the only thing that was on offer, and it throws all of that
-- away.
--
-- Separate from status rather than a third value of it, because shelving and
-- booked/watching are different facts: a shelved flight was booked or was
-- being watched, and taking it off the shelf should put it back as it was
-- rather than make you remember which.
alter table public.flights add column if not exists shelved boolean not null default false;
alter table public.rentals add column if not exists shelved boolean not null default false;

create index if not exists flights_shelved_idx on public.flights (trip_id) where shelved;
create index if not exists rentals_shelved_idx on public.rentals (trip_id) where shelved;
