-- Rollback of 20261123001100_search.sql
-- The pg_trgm extension and the `extensions` schema are left in place: Supabase projects
-- usually have them already and other objects may depend on them.
drop function if exists public.global_search(uuid, text, int);
drop index if exists public.companies_search_trgm;
drop index if exists public.products_search_trgm;
drop index if exists public.saved_items_search_trgm;
drop function if exists public.az_fold(text);
