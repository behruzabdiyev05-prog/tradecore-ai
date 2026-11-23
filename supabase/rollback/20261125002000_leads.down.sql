-- Rollback of 20261125002000_leads.sql — removes the pipeline; the companies (prospects) stay.
drop table if exists public.lead_activities;
drop table if exists public.leads;
drop function if exists public.leads_guard();
