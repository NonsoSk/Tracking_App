-- DEV ONLY: lets the dev API verify passwords (real Supabase Auth does this itself).
create extension if not exists pgcrypto with schema extensions;
alter table auth.users add column if not exists encrypted_password text;
