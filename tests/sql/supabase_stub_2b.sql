-- Minimal stand-ins for the Supabase pieces Phase 2B uses, so the migrations
-- can be tested on plain PostgreSQL. NOT deployed to Supabase.
--   • storage schema: buckets, objects (RLS on), storage.foldername()  — same shape as Supabase Storage
--   • supabase_realtime publication                                    — Supabase creates it in every project
-- Differences from real Supabase (stated in the Phase 2B report):
--   • file size / MIME limits are enforced by the Storage API, not by these tables;
--     here only the bucket configuration is checked.
--   • Realtime delivery itself is not emulated; only the publication membership is checked.
create schema storage;

create table storage.buckets (
  id                  text primary key,
  name                text not null unique,
  owner               uuid,
  public              boolean not null default false,
  file_size_limit     bigint,
  allowed_mime_types  text[],
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create table storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (bucket_id, name)
);

-- Same definition as Supabase: every path segment except the file name.
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects, storage.buckets to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;

create publication supabase_realtime;
