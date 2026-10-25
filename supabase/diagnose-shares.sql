-- Read-only. Checks nothing, changes nothing, writes nothing — safe to run
-- against live data. Paste into the SQL Editor and read the output.
--
-- Three things can make a trip's totals look wrong, and none of them are
-- visible from the app. Each query below finds one.

-- 1. Share rows pointing at neither a person nor a household.
--    These are what repointing the shares at the master people list leaves
--    behind when a roster entry had never been linked to a master person.
--    The app now reports these as unassigned instead of quietly dropping
--    them, but the rows themselves still need fixing: open the booking and
--    re-tick who's on it.
select 'unlinked share' as problem,
       t.title as trip, coalesce(f.label, r.label) as booking,
       bp.cost, bp.cost_percent
from public.booking_people bp
join public.trips t on t.id = bp.trip_id
left join public.flights f on f.id = bp.flight_id
left join public.rentals r on r.id = bp.rental_id
where bp.person_id is null and bp.group_id is null

union all

-- 2. Share rows pointing at a person who no longer exists, or who belongs to
--    a different account.
select 'share points at a missing person',
       t.title, coalesce(f.label, r.label), bp.cost, bp.cost_percent
from public.booking_people bp
join public.trips t on t.id = bp.trip_id
left join public.flights f on f.id = bp.flight_id
left join public.rentals r on r.id = bp.rental_id
where bp.person_id is not null
  and not exists (select 1 from public.people p where p.id = bp.person_id)

union all

-- 3. Roster entries never linked to a master person. These show up as nobody
--    in particular, and anything charged to them goes nowhere.
select 'roster entry not linked to a person',
       t.title, '(trip roster)', null, null
from public.trip_people tp
join public.trips t on t.id = tp.trip_id
where tp.person_id is null

order by problem, trip;

-- 4. Households with no members. A share charged to one of these can't be
--    divided, so the app reports it as unassigned.
select pg.name as household_with_no_members
from public.person_groups pg
where not exists (select 1 from public.people p where p.group_id = pg.id);
