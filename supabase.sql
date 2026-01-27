-- Run this in Supabase SQL editor.

create table if not exists public.anki_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.anki_state enable row level security;

drop policy if exists "anki_state_select_own" on public.anki_state;
create policy "anki_state_select_own"
  on public.anki_state
  for select
  using (auth.uid() = user_id);

drop policy if exists "anki_state_insert_own" on public.anki_state;
create policy "anki_state_insert_own"
  on public.anki_state
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "anki_state_update_own" on public.anki_state;
create policy "anki_state_update_own"
  on public.anki_state
  for update
  using (auth.uid() = user_id);
