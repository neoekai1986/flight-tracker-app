-- Migration: let a wishlist board's owner remove any card on their board.
-- For projects created before this change. Run once in the SQL Editor.
-- (Fresh installs don't need this — policies.sql already includes it.)

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
    or board_id in ( select id from public.wishlist_boards where owner_id = auth.uid() )
  );
