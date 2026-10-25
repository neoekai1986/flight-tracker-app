-- Migration: rooms on a lodging booking, and who's on the couch.
-- Run once in the SQL Editor. Safe to run more than once.

-- A lodging cost is really a price for a set of bedrooms, not a price per
-- head: two people sharing a room shouldn't pay twice what the person in the
-- next room pays. Naming the room on each share row is what lets the split
-- work that way. It's a plain label rather than its own table because a room
-- has no existence apart from the stay it belongs to — rows sharing a label
-- are a room, and next year's cabin has different ones.
alter table public.booking_people
  add column if not exists room text;

-- On the booking, but not in a bedroom. Listed in the summary and charged
-- nothing, the same way a companion seat is on a flight. Separate from
-- is_companion rather than shared with it: both mean "here at no charge", but
-- they are not the same fact and the summary says different things about them.
alter table public.booking_people
  add column if not exists is_couch boolean not null default false;
