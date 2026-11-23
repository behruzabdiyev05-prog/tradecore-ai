-- Rollback of 20261125001800_opportunities.sql — removes the opportunities table (and its rows).
drop table if exists public.opportunities;
drop function if exists public.opportunities_guard();
