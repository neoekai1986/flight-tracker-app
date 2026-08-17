-- Migration: let a wishlist board's owner remove any card on their board.
-- For projects created before this change. Run once in the SQL Editor.
-- (Fresh installs don't need this — policies.sql already includes it.)
--
-- Safe to run more than once.

-- Ownership check as a security definer function, matching the pattern
-- is_wishlist_collaborator()/can_access_wishlist_board() already use here.
-- A plain subquery over wishlist_boards inside a policy is evaluated with
-- that table's own RLS applied, which makes the result depend on a second
-- policy holding up; this reads the table directly and answers one question.
create or replace function public.is_wishlist_board_owner(p_board_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.wishlist_boards b
    where b.id = p_board_id and b.owner_id = auth.uid()
  );
$$;

revoke all on function public.is_wishlist_board_owner(uuid) from public, anon;
grant execute on function public.is_wishlist_board_owner(uuid) to authenticated;

-- Delete was creator-only. It's now the creator OR the board's owner, so the
-- owner can curate what's on their board.
--
-- Editing is deliberately NOT widened: a pitch is someone's own words, and
-- the owner silently rewriting them is a different thing from moderating.
-- wishlist_entries_update stays creator-only and is untouched here.
--
-- This is a real delete, not a hide — the author doesn't get the card back.
drop policy if exists wishlist_entries_delete on public.wishlist_entries;

create policy wishlist_entries_delete on public.wishlist_entries
  for delete using (
    created_by = auth.uid()
    or public.is_wishlist_board_owner(board_id)
  );

-- Check it landed. Should print one row whose expression mentions
-- is_wishlist_board_owner:
--
--   select polname, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--   where polrelid = 'public.wishlist_entries'::regclass
--     and polcmd = 'd';
