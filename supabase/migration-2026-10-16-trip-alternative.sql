-- Migration: mark a trip as an alternative that didn't happen.
-- Run once in the SQL Editor. Safe to run more than once.
--
-- No RLS changes: a column on trips, so it inherits that table's policies.
--
-- An alternative is a version of a trip you considered and didn't take. It
-- stays readable, but it is not a trip that happened, so nothing it contains
-- counts toward the totals.

alter table public.trips
  add column if not exists is_alternative boolean not null default false;
