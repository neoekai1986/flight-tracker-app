-- Migration: research notes on a wishlist pitch — rough flights, where you'd
-- stay, anything else. Shown when you open an entry, not on the card face.
-- Run once in the SQL Editor. Safe to run more than once.
--
-- No RLS changes: these are columns on wishlist_entries, so they inherit the
-- policies that table already has.

alter table public.wishlist_entries
  add column if not exists flight_notes text,
  add column if not exists stay_notes   text,
  add column if not exists other_notes  text;
