-- Remove legacy share model. Active share links use public.shared_items.

drop table if exists public.public_gear_shares;
