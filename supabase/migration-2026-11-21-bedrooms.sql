-- Migration: how many bedrooms a place has.
-- Run once in the SQL Editor. Safe to run more than once.

-- A lodging cost already divided by room rather than by head, but the
-- divisor was however many room names somebody had typed. That number moves:
-- give one person a room of their own and every other room gets cheaper,
-- which is not how a house works. Stating the count fixes each bedroom at
-- the same fraction of the booking, whoever ends up in it.
--
-- A room nobody takes still costs that fraction, and it lands on whoever
-- booked the place rather than being shared out among the people who did
-- take one — they agreed to a room, not to covering an empty one.
--
-- Null means "not stated", and those stays keep dividing by the rooms in
-- use, exactly as before.
alter table public.rentals
  add column if not exists bedrooms integer;
