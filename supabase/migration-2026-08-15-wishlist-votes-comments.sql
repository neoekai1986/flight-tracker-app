-- Migration: upvotes and comments on wishlist pitches.
-- For projects created before this feature. Run once in the SQL Editor.
-- (Fresh installs don't need this — schema.sql/policies.sql already
-- include it.)
--
-- Safe to run more than once.

-- One upvote per person per pitch. The unique constraint is what enforces
-- "one vote each" — a double-click or a retried request can't inflate a
-- count, so the client never has to be careful about it.
create table if not exists public.wishlist_votes (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.wishlist_entries(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (entry_id, user_id)
);

create table if not exists public.wishlist_comments (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.wishlist_entries(id) on delete cascade,
  created_by  uuid not null references auth.users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists wishlist_votes_entry_idx on public.wishlist_votes (entry_id);
create index if not exists wishlist_comments_entry_idx on public.wishlist_comments (entry_id, created_at);

alter table public.wishlist_votes enable row level security;
alter table public.wishlist_comments enable row level security;

revoke all on public.wishlist_votes, public.wishlist_comments from anon;
grant select, insert, delete on public.wishlist_votes to authenticated;
grant select, insert, update, delete on public.wishlist_comments to authenticated;

-- Which board an entry belongs to, without re-triggering wishlist_entries'
-- own RLS from inside these policies. Same reason the other security definer
-- helpers in policies.sql exist.
create or replace function public.wishlist_entry_board(p_entry_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select board_id from public.wishlist_entries where id = p_entry_id;
$$;

revoke all on function public.wishlist_entry_board(uuid) from public, anon;
grant execute on function public.wishlist_entry_board(uuid) to authenticated;

-- Votes: anyone on the board sees every vote (knowing where the family
-- stands is the point); you can only cast or withdraw your own.
drop policy if exists wishlist_votes_select on public.wishlist_votes;
create policy wishlist_votes_select on public.wishlist_votes
  for select using (
    public.can_access_wishlist_board( public.wishlist_entry_board(entry_id) )
  );

drop policy if exists wishlist_votes_insert on public.wishlist_votes;
create policy wishlist_votes_insert on public.wishlist_votes
  for insert with check (
    user_id = auth.uid()
    and public.can_access_wishlist_board( public.wishlist_entry_board(entry_id) )
  );

drop policy if exists wishlist_votes_delete on public.wishlist_votes;
create policy wishlist_votes_delete on public.wishlist_votes
  for delete using ( user_id = auth.uid() );

-- Comments: anyone on the board reads and posts. Editing is the author's
-- alone, same reasoning as entries. Deleting is the author or the board's
-- owner, so the owner can moderate a thread the way they curate the cards.
drop policy if exists wishlist_comments_select on public.wishlist_comments;
create policy wishlist_comments_select on public.wishlist_comments
  for select using (
    public.can_access_wishlist_board( public.wishlist_entry_board(entry_id) )
  );

drop policy if exists wishlist_comments_insert on public.wishlist_comments;
create policy wishlist_comments_insert on public.wishlist_comments
  for insert with check (
    created_by = auth.uid()
    and public.can_access_wishlist_board( public.wishlist_entry_board(entry_id) )
  );

drop policy if exists wishlist_comments_update on public.wishlist_comments;
create policy wishlist_comments_update on public.wishlist_comments
  for update using ( created_by = auth.uid() ) with check ( created_by = auth.uid() );

drop policy if exists wishlist_comments_delete on public.wishlist_comments;
create policy wishlist_comments_delete on public.wishlist_comments
  for delete using (
    created_by = auth.uid()
    or public.is_wishlist_board_owner( public.wishlist_entry_board(entry_id) )
  );

-- Check it landed. Both should return rows:
--
--   select count(*) from public.wishlist_votes;
--   select count(*) from public.wishlist_comments;
