-- Migration: Wish List Planning — a shared space (separate from trips)
-- where family members pitch destination ideas for a multi-generational
-- vacation. For projects created before this feature. Run once in the SQL
-- Editor. (Fresh installs don't need this — schema.sql/policies.sql
-- already include it.)
--
-- IMPORTANT — do this FIRST, before running the SQL below: create a second
-- Storage bucket named exactly "wishlist" via the Supabase dashboard
-- (Storage > New bucket, "Public bucket" left UNCHECKED). Creating it via
-- SQL is unreliable — see the note already in schema.sql for the
-- "attachments" bucket, same reasoning applies here.

create table public.wishlist_boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Family Vacation Wishlist',
  created_at  timestamptz not null default now()
);

create table public.wishlist_collaborators (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.wishlist_boards(id) on delete cascade,
  email       citext not null,
  invited_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (board_id, email)
);

create table public.wishlist_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_path   text,
  updated_at    timestamptz not null default now()
);

create table public.wishlist_entries (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.wishlist_boards(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  title         text not null,
  location      text,
  photo_path    text,
  blurb         text,
  things_to_do  text,
  position      double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.wishlist_collaborators (board_id);
create index on public.wishlist_collaborators (email);
create index on public.wishlist_entries (board_id, position);

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

alter table public.wishlist_boards enable row level security;
alter table public.wishlist_collaborators enable row level security;
alter table public.wishlist_profiles enable row level security;
alter table public.wishlist_entries enable row level security;

revoke all on public.wishlist_boards, public.wishlist_collaborators, public.wishlist_profiles, public.wishlist_entries from anon;
grant select, insert, update, delete on public.wishlist_boards, public.wishlist_profiles, public.wishlist_entries to authenticated;
grant select, insert, delete on public.wishlist_collaborators to authenticated;

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

create policy wishlist_profiles_select on public.wishlist_profiles
  for select using ( true );

create policy wishlist_profiles_insert on public.wishlist_profiles
  for insert with check ( user_id = auth.uid() );

create policy wishlist_profiles_update on public.wishlist_profiles
  for update using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

create policy wishlist_entries_select on public.wishlist_entries
  for select using ( public.can_access_wishlist_board(board_id) );

create policy wishlist_entries_insert on public.wishlist_entries
  for insert with check (
    public.can_access_wishlist_board(board_id) and created_by = auth.uid()
  );

create policy wishlist_entries_update on public.wishlist_entries
  for update using ( created_by = auth.uid() ) with check ( created_by = auth.uid() );

create policy wishlist_entries_delete on public.wishlist_entries
  for delete using ( created_by = auth.uid() );

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
