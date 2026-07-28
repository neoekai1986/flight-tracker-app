-- Migration: booked vs. watching flights/rentals — each flight or rental can
-- be marked "watching" (still comparing options) instead of "booked". Watching
-- items show up in their own "Watching (not yet booked)" section and are
-- excluded from the trip total and every stats-bar rollup until you promote
-- them to booked. For projects created before this feature. Run once in the
-- SQL Editor. (Fresh installs don't need this — schema.sql already includes it.)

alter table public.flights
  add column status text not null default 'booked' check (status in ('booked','watching'));

alter table public.rentals
  add column status text not null default 'booked' check (status in ('booked','watching'));
