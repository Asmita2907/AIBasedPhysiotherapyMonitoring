-- Camera-based home physiotherapy assistant: initial schema.
-- Video never leaves the device; flagged reps store landmark + angle frames only.

create type public.user_role as enum ('patient', 'physio');
create type public.review_status as enum ('not_required', 'pending', 'reviewed');
create type public.review_verdict as enum ('correct', 'incorrect');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  role public.user_role not null default 'patient',
  created_at timestamptz not null default now()
);

create table public.exercise_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  exercise text not null,
  side text not null check (side in ('left', 'right')),
  confidence_threshold numeric(4, 3) not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  total_reps int not null default 0,
  correct_reps int not null default 0,
  flagged_reps int not null default 0,
  avg_confidence numeric(4, 3),
  tips jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index exercise_sessions_patient_idx on public.exercise_sessions (patient_id, started_at desc);

create table public.reps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.exercise_sessions (id) on delete cascade,
  patient_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  rep_index int not null,
  is_correct boolean not null,
  confidence numeric(4, 3) not null,
  needs_review boolean not null,
  feedback jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  -- Landmark + angle frames for skeleton replay. Only kept for flagged reps.
  frames jsonb,
  review_status public.review_status not null default 'not_required',
  assigned_physio_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (session_id, rep_index)
);
create index reps_review_queue_idx on public.reps (review_status, created_at) where needs_review;
create index reps_assigned_idx on public.reps (assigned_physio_id) where review_status = 'pending';

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null unique references public.reps (id) on delete cascade,
  physio_id uuid not null default auth.uid() references public.profiles (id),
  verdict public.review_verdict not null,
  comment text not null default '',
  created_at timestamptz not null default now()
);

-- Helpers -------------------------------------------------------------------

create or replace function public.is_physio()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'physio');
$$;

-- New sign-ups are always patients. Promote physiotherapists with:
--   update public.profiles set role = 'physio' where email = '...';
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Clients cannot choose review state or assignment for their own reps.
create or replace function public.prepare_rep()
returns trigger
language plpgsql
as $$
begin
  new.review_status := case when new.needs_review then 'pending' else 'not_required' end;
  new.assigned_physio_id := null;
  if not new.needs_review then
    new.frames := null;
  end if;
  return new;
end;
$$;

create trigger reps_prepare
  before insert on public.reps
  for each row execute function public.prepare_rep();

create or replace function public.mark_rep_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.reps set review_status = 'reviewed' where id = new.rep_id;
  return new;
end;
$$;

create trigger reviews_mark_rep
  after insert on public.reviews
  for each row execute function public.mark_rep_reviewed();

-- Row level security --------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.exercise_sessions enable row level security;
alter table public.reps enable row level security;
alter table public.reviews enable row level security;

create policy "profiles: read own or as physio" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_physio());

create policy "sessions: patient reads own, physio reads all" on public.exercise_sessions
  for select to authenticated using (patient_id = auth.uid() or public.is_physio());
create policy "sessions: patient inserts own" on public.exercise_sessions
  for insert to authenticated with check (patient_id = auth.uid());

create policy "reps: patient reads own, physio reads flagged" on public.reps
  for select to authenticated using (patient_id = auth.uid() or (public.is_physio() and needs_review));
create policy "reps: patient inserts own" on public.reps
  for insert to authenticated with check (
    patient_id = auth.uid()
    and exists (select 1 from public.exercise_sessions s where s.id = session_id and s.patient_id = auth.uid())
  );

create policy "reviews: patient reads own, physio reads all" on public.reviews
  for select to authenticated using (
    public.is_physio()
    or exists (select 1 from public.reps r where r.id = rep_id and r.patient_id = auth.uid())
  );
create policy "reviews: physio reviews flagged reps" on public.reviews
  for insert to authenticated with check (
    public.is_physio()
    and physio_id = auth.uid()
    and exists (select 1 from public.reps r where r.id = rep_id and r.needs_review)
  );
