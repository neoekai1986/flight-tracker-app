-- Read-only. Four checks in one statement: it changes nothing and writes
-- nothing, so it is safe to run against live data. Paste the whole thing
-- into the Supabase SQL Editor and run it.
--
-- Each row that comes back is something that can make a trip's totals look
-- wrong in a way the app can't show you. No rows at all is a clean bill.

-- Share rows pointing at neither a person nor a household. These are what
-- repointing the shares at the master people list leaves behind when a
-- roster entry was never linked to a master person. Fix: open the booking
-- and re-tick who's on it.
select 'share not linked to anyone' as problem,
       t.title as trip, coalesce(f.label, r.label) as booking,
       bp.cost, bp.cost_percent
from public.booking_people bp
join public.trips t on t.id = bp.trip_id
left join public.flights f on f.id = bp.flight_id
left join public.rentals r on r.id = bp.rental_id
where bp.person_id is null and bp.group_id is null

union all

-- Share rows pointing at a person who no longer exists.
select 'share points at a missing person',
       t.title, coalesce(f.label, r.label), bp.cost, bp.cost_percent
from public.booking_people bp
join public.trips t on t.id = bp.trip_id
left join public.flights f on f.id = bp.flight_id
left join public.rentals r on r.id = bp.rental_id
where bp.person_id is not null
  and not exists (select 1 from public.people p where p.id = bp.person_id)

union all

-- Roster entries never linked to a master person. These show up as nobody in
-- particular, and anything charged to them goes nowhere.
select 'roster entry not linked to a person',
       t.title, '(trip roster)', null, null
from public.trip_people tp
join public.trips t on t.id = tp.trip_id
where tp.person_id is null

union all

-- Households with no members. A share charged to one of these can't be
-- divided between anybody.
select 'household has no members', pg.name, null, null, null
from public.person_groups pg
where not exists (select 1 from public.people p where p.group_id = pg.id)

order by problem, trip;
