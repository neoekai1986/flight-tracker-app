-- Fare Board Row Level Security
-- Run this AFTER schema.sql, in the same SQL Editor.

-- Returns true if the current session's email is an invited collaborator on
-- this trip. security definer so it can read trip_collaborators without
-- re-triggering RLS (which would recurse with trips' own policy).
create or replace function public.is_trip_collaborator(p_trip_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.trip_collaborators c
    where c.trip_id = p_trip_id
      and c.email = auth.email()::citext
  );
$$;

-- Returns true if the current session can read/write this trip
-- (owner, or an invited collaborator matched by email).
create or replace function public.can_access_trip(p_trip_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id
      and (
        t.owner_id = auth.uid()
        or exists (
          select 1 from public.trip_collaborators c
          where c.trip_id = t.id
            and c.email = auth.email()::citext
        )
      )
  );
$$;

-- One join further, for price_logs.
create or replace function public.can_access_flight(p_flight_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.flights f
    where f.id = p_flight_id
      and public.can_access_trip(f.trip_id)
  );
$$;

-- Returns true if the current session's email is an invited collaborator on
-- this board. security definer so it can read wishlist_collaborators without
-- re-triggering RLS — used by wishlist_boards_select, which would otherwise
-- recurse with wishlist_collaborators_select (which itself queries
-- wishlist_boards back).
create or replace function public.is_wishlist_collaborator(p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.wishlist_collaborators c
    where c.board_id = p_board_id
      and c.email = auth.email()::citext
  );
$$;

-- Same owner-or-invited-collaborator pattern as can_access_trip, for the
-- separate Wish List Planning space.
create or replace function public.can_access_wishlist_board(p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.wishlist_boards b
    where b.id = p_board_id
      and (
        b.owner_id = auth.uid()
        or exists (
          select 1 from public.wishlist_collaborators c
          where c.board_id = b.id
            and c.email = auth.email()::citext
        )
      )
  );
$$;

alter table public.trip_folders enable row level security;
alter table public.trip_categories enable row level security;
alter table public.trips enable row level security;
alter table public.trip_collaborators enable row level security;
alter table public.flights enable row level security;
alter table public.price_logs enable row level security;
alter table public.rentals enable row level security;
alter table public.attachments enable row level security;
alter table public.favorite_points_programs enable row level security;
alter table public.wishlist_boards enable row level security;
alter table public.wishlist_collaborators enable row level security;
alter table public.wishlist_profiles enable row level security;
alter table public.wishlist_entries enable row level security;

-- Only logged-in users get any access at all; RLS scopes it further per-row.
revoke all on public.trip_folders, public.trip_categories, public.trips, public.trip_collaborators, public.flights, public.price_logs, public.rentals, public.attachments, public.favorite_points_programs, public.wishlist_boards, public.wishlist_collaborators, public.wishlist_profiles, public.wishlist_entries from anon;
grant select, insert, update, delete on public.trip_folders, public.trip_categories, public.trips, public.flights, public.price_logs, public.rentals to authenticated;
grant select, insert, delete on public.trip_collaborators to authenticated;
grant select, insert, delete on public.favorite_points_programs to authenticated;
grant select, insert, update, delete on public.attachments to authenticated;
grant select, insert, update, delete on public.wishlist_boards, public.wishlist_profiles, public.wishlist_entries to authenticated;
grant select, insert, delete on public.wishlist_collaborators to authenticated;

-- Ownership can't be reassigned via UPDATE (simpler and airtight vs. expressing
-- this in RLS's WITH CHECK).
create or replace function public.lock_trip_owner()
returns trigger language plpgsql as $$
begin
  if NEW.owner_id <> OLD.owner_id then
    raise exception 'owner_id cannot be changed directly';
  end if;
  NEW.updated_at = now();
  return NEW;
end;
$$;

create trigger trips_lock_owner
  before update on public.trips
  for each row execute function public.lock_trip_owner();

-- trip_folders
-- Owner manages folders directly; a collaborator can see (but not rename or
-- delete) the folder name of any shared trip filed under it.
create policy trip_folders_select on public.trip_folders
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.folder_id = trip_folders.id and public.can_access_trip(t.id)
    )
  );

create policy trip_folders_insert on public.trip_folders
  for insert with check ( owner_id = auth.uid() );

create policy trip_folders_update on public.trip_folders
  for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );

create policy trip_folders_delete on public.trip_folders
  for delete using ( owner_id = auth.uid() );

-- trip_categories (same access pattern as trip_folders)
create policy trip_categories_select on public.trip_categories
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.category_id = trip_categories.id and public.can_access_trip(t.id)
    )
  );

create policy trip_categories_insert on public.trip_categories
  for insert with check ( owner_id = auth.uid() );

create policy trip_categories_update on public.trip_categories
  for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );

create policy trip_categories_delete on public.trip_categories
  for delete using ( owner_id = auth.uid() );

-- favorite_points_programs: purely personal, never shared with collaborators.
create policy favorite_points_programs_select on public.favorite_points_programs
  for select using ( owner_id = auth.uid() );

create policy favorite_points_programs_insert on public.favorite_points_programs
  for insert with check ( owner_id = auth.uid() );

create policy favorite_points_programs_delete on public.favorite_points_programs
  for delete using ( owner_id = auth.uid() );

-- trips
-- NOTE: the owner check must be a direct column comparison (not a subquery
-- through can_access_trip) so that INSERT ... RETURNING can see the row it
-- just inserted — a subquery-based policy can't see same-statement inserts,
-- which makes insert-and-return fail with a spurious RLS violation.
create policy trips_select on public.trips
  for select using ( owner_id = auth.uid() or public.is_trip_collaborator(id) );

create policy trips_insert on public.trips
  for insert with check ( owner_id = auth.uid() );

create policy trips_update on public.trips
  for update using ( public.can_access_trip(id) )
  with check ( public.can_access_trip(id) );

create policy trips_delete on public.trips
  for delete using ( owner_id = auth.uid() );

-- trip_collaborators
create policy collaborators_select on public.trip_collaborators
  for select using (
    trip_id in (select id from public.trips where owner_id = auth.uid())
    or email = auth.email()::citext
  );

create policy collaborators_insert on public.trip_collaborators
  for insert with check (
    trip_id in (select id from public.trips where owner_id = auth.uid())
  );

create policy collaborators_delete on public.trip_collaborators
  for delete using (
    trip_id in (select id from public.trips where owner_id = auth.uid())
    or email = auth.email()::citext
  );

-- flights
create policy flights_select on public.flights
  for select using ( public.can_access_trip(trip_id) );

create policy flights_insert on public.flights
  for insert with check ( public.can_access_trip(trip_id) );

create policy flights_update on public.flights
  for update using ( public.can_access_trip(trip_id) )
  with check ( public.can_access_trip(trip_id) );

create policy flights_delete on public.flights
  for delete using ( public.can_access_trip(trip_id) );

-- rentals
create policy rentals_select on public.rentals
  for select using ( public.can_access_trip(trip_id) );

create policy rentals_insert on public.rentals
  for insert with check ( public.can_access_trip(trip_id) );

create policy rentals_update on public.rentals
  for update using ( public.can_access_trip(trip_id) )
  with check ( public.can_access_trip(trip_id) );

create policy rentals_delete on public.rentals
  for delete using ( public.can_access_trip(trip_id) );

-- price_logs
create policy price_logs_select on public.price_logs
  for select using ( public.can_access_flight(flight_id) );

create policy price_logs_insert on public.price_logs
  for insert with check ( public.can_access_flight(flight_id) );

create policy price_logs_update on public.price_logs
  for update using ( public.can_access_flight(flight_id) )
  with check ( public.can_access_flight(flight_id) );

create policy price_logs_delete on public.price_logs
  for delete using ( public.can_access_flight(flight_id) );

-- attachments
create policy attachments_select on public.attachments
  for select using ( public.can_access_trip(trip_id) );

create policy attachments_insert on public.attachments
  for insert with check ( public.can_access_trip(trip_id) );

create policy attachments_update on public.attachments
  for update using ( public.can_access_trip(trip_id) )
  with check ( public.can_access_trip(trip_id) );

create policy attachments_delete on public.attachments
  for delete using ( public.can_access_trip(trip_id) );

-- Storage: screenshots live at "{trip_id}/{uuid}.{ext}" — the first path
-- segment is the trip id, so RLS can scope access the same way every
-- other table does.
create policy attachments_storage_select on storage.objects
  for select using (
    bucket_id = 'attachments'
    and public.can_access_trip( (split_part(name, '/', 1))::uuid )
  );

create policy attachments_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and public.can_access_trip( (split_part(name, '/', 1))::uuid )
  );

create policy attachments_storage_delete on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and public.can_access_trip( (split_part(name, '/', 1))::uuid )
  );

-- wishlist_boards
-- Same INSERT...RETURNING subtlety as trips: the owner check must be a
-- direct column comparison, not a subquery, for SELECT right after INSERT.
-- Collaborator check goes through is_wishlist_collaborator() (not a raw
-- subquery) to avoid recursing with wishlist_collaborators_select, which
-- itself queries wishlist_boards.
create policy wishlist_boards_select on public.wishlist_boards
  for select using (
    owner_id = auth.uid()
    or public.is_wishlist_collaborator(id)
  );

create policy wishlist_boards_insert on public.wishlist_boards
  for insert with check ( owner_id = auth.uid() );

create policy wishlist_boards_update on public.wishlist_boards
  for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );

create policy wishlist_boards_delete on public.wishlist_boards
  for delete using ( owner_id = auth.uid() );

-- wishlist_collaborators (same pattern as trip_collaborators)
create policy wishlist_collaborators_select on public.wishlist_collaborators
  for select using (
    board_id in (select id from public.wishlist_boards where owner_id = auth.uid())
    or email = auth.email()::citext
  );

create policy wishlist_collaborators_insert on public.wishlist_collaborators
  for insert with check (
    board_id in (select id from public.wishlist_boards where owner_id = auth.uid())
  );

create policy wishlist_collaborators_delete on public.wishlist_collaborators
  for delete using (
    board_id in (select id from public.wishlist_boards where owner_id = auth.uid())
    or email = auth.email()::citext
  );

-- wishlist_profiles — a name + photo is low-sensitivity and needs to be
-- visible on every entry regardless of which board it's on, so read access
-- is open to any signed-in user; only your own row is writable.
create policy wishlist_profiles_select on public.wishlist_profiles
  for select using ( true );

create policy wishlist_profiles_insert on public.wishlist_profiles
  for insert with check ( user_id = auth.uid() );

create policy wishlist_profiles_update on public.wishlist_profiles
  for update using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- wishlist_entries
-- Anyone with board access can read and pitch a new entry.
--
-- Editing stays with the entry's own creator: a pitch is someone's own
-- words, and the board owner being able to rewrite them without their
-- knowing is a different thing from moderating the board.
--
-- Deleting is the creator OR the board's owner, so the owner can curate
-- what's on their board. Note this is a real delete, not a hide — the
-- author doesn't get it back.
create policy wishlist_entries_select on public.wishlist_entries
  for select using ( public.can_access_wishlist_board(board_id) );

create policy wishlist_entries_insert on public.wishlist_entries
  for insert with check (
    public.can_access_wishlist_board(board_id) and created_by = auth.uid()
  );

create policy wishlist_entries_update on public.wishlist_entries
  for update using ( created_by = auth.uid() ) with check ( created_by = auth.uid() );

create policy wishlist_entries_delete on public.wishlist_entries
  for delete using (
    created_by = auth.uid()
    or board_id in ( select id from public.wishlist_boards where owner_id = auth.uid() )
  );

-- Postgres doesn't guarantee short-circuit evaluation of OR, so
-- "x = 'avatars' or can_access_wishlist_board(x::uuid)" can still try (and
-- throw on) the ::uuid cast even when the avatars branch already matched.
-- This wrapper swallows the cast failure instead of erroring the query.
create or replace function public.safe_uuid(p_text text)
returns uuid
language plpgsql immutable
as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- Storage bucket "wishlist": location photos live at "{board_id}/{uuid}.ext";
-- avatars live at "avatars/{user_id}.ext" (fixed name per user, overwritten
-- on re-upload). Avatars are readable by anyone signed in (same reasoning
-- as wishlist_profiles); only the owning user can write their own avatar.
create policy wishlist_storage_select on storage.objects
  for select using (
    bucket_id = 'wishlist'
    and (
      split_part(name, '/', 1) = 'avatars'
      or public.can_access_wishlist_board( public.safe_uuid(split_part(name, '/', 1)) )
    )
  );

create policy wishlist_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'wishlist'
    and (
      (split_part(name, '/', 1) = 'avatars' and split_part(name, '/', 2) like (auth.uid()::text || '.%'))
      or public.can_access_wishlist_board( public.safe_uuid(split_part(name, '/', 1)) )
    )
  );

create policy wishlist_storage_update on storage.objects
  for update using (
    bucket_id = 'wishlist'
    and (
      (split_part(name, '/', 1) = 'avatars' and split_part(name, '/', 2) like (auth.uid()::text || '.%'))
      or public.can_access_wishlist_board( public.safe_uuid(split_part(name, '/', 1)) )
    )
  );

create policy wishlist_storage_delete on storage.objects
  for delete using (
    bucket_id = 'wishlist'
    and (
      (split_part(name, '/', 1) = 'avatars' and split_part(name, '/', 2) like (auth.uid()::text || '.%'))
      or public.can_access_wishlist_board( public.safe_uuid(split_part(name, '/', 1)) )
    )
  );
