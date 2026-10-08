-- SlotWise: schema, constraints, RLS. Run once in the Supabase SQL editor (or `supabase db push`).
create extension if not exists btree_gist;

-- ───────────── Tenants ─────────────
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  description text check (length(description) <= 500),
  timezone text not null default 'UTC',
  phone text, email text,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade, -- one business per user (v1)
  role text not null default 'owner' check (role in ('owner','admin')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

-- ───────────── Tenant-owned data ─────────────
-- unique (id, business_id) enables composite FKs so a row can never point at another tenant's parent.
create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  description text check (length(description) <= 500),
  duration_minutes int not null check (duration_minutes between 5 and 480),
  price_cents int not null check (price_cents between 0 and 10000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);

-- day_of_week: ISO, 1 = Monday ... 7 = Sunday. One interval per day (v1).
create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  start_time time not null, end_time time not null,
  enabled boolean not null default true,
  check (end_time > start_time),
  unique (business_id, day_of_week)
);

create table public.provider_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  provider_id uuid not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  start_time time not null, end_time time not null,
  enabled boolean not null default true,
  check (end_time > start_time),
  unique (provider_id, day_of_week),
  foreign key (provider_id, business_id) references public.providers(id, business_id) on delete cascade
);

create table public.blocked_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider_id uuid,                     -- null = whole business
  starts_at timestamptz not null, ends_at timestamptz not null,
  reason text check (length(reason) <= 200),
  check (ends_at > starts_at),
  foreign key (provider_id, business_id) references public.providers(id, business_id) on delete cascade
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  email text check (email = lower(email)),
  phone text,
  notes text check (length(notes) <= 2000),   -- private, never exposed publicly
  created_at timestamptz not null default now(),
  unique (id, business_id)
);
create unique index clients_email_uq on public.clients (business_id, email) where email is not null;
create unique index clients_phone_uq on public.clients (business_id, phone) where phone is not null;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id uuid not null, provider_id uuid not null, client_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('pending','confirmed','cancelled','completed','no_show')),
  price_cents int not null check (price_cents >= 0),
  source text not null default 'public',
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (service_id, business_id)  references public.services(id, business_id),
  foreign key (provider_id, business_id) references public.providers(id, business_id),
  foreign key (client_id, business_id)   references public.clients(id, business_id),
  -- FINAL double-booking guarantee: no two active bookings for a provider may overlap.
  -- '[)' means a booking ending at 10:00 and another starting at 10:00 do NOT overlap.
  constraint bookings_no_overlap exclude using gist (
    provider_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending','confirmed'))
);
create index bookings_business_starts_idx on public.bookings (business_id, starts_at);
create index bookings_client_idx on public.bookings (client_id);
create index clients_business_name_idx on public.clients (business_id, name);

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  event_type text not null,
  actor_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events (booking_id);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null default 'email',
  kind text not null default '24h',
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  unique (booking_id, channel, kind)       -- idempotency: one reminder row per booking/channel/kind
);
create index reminders_due_idx on public.reminders (status, scheduled_for);

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  channel text not null, template text not null, status text not null,
  provider_message_id text, error text,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  provider_customer_id text, provider_subscription_id text,
  plan text not null default 'pro',
  status text not null default 'incomplete'
    check (status in ('active','trialing','past_due','cancelled','incomplete')),
  trial_ends_at timestamptz,
  current_period_end timestamptz
);

create table public.webhook_events (      -- replay protection for billing webhooks
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ───────────── CRM view (aggregation in the database) ─────────────
create view public.client_stats with (security_invoker = true) as
select c.*,
  count(b.id)                                                        as total_bookings,
  coalesce(sum(b.price_cents) filter (where b.status = 'completed'), 0) as lifetime_value_cents,
  max(b.starts_at) filter (where b.status = 'completed')             as last_appointment,
  min(b.starts_at) filter (where b.status in ('pending','confirmed') and b.starts_at > now()) as next_appointment
from public.clients c
left join public.bookings b on b.client_id = c.id
group by c.id;

-- ───────────── Row-Level Security ─────────────
create or replace function public.is_member(bid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from business_members where business_id = bid and user_id = auth.uid())
$$;

alter table public.businesses       enable row level security;
alter table public.business_members enable row level security;
alter table public.booking_events   enable row level security;
alter table public.reminders        enable row level security;
alter table public.notification_logs enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.webhook_events   enable row level security;   -- no policies: service role only

create policy businesses_select on public.businesses for select to authenticated using (public.is_member(id));
create policy businesses_update on public.businesses for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));
create policy members_select_own on public.business_members for select to authenticated using (user_id = auth.uid());

create policy booking_events_select on public.booking_events for select to authenticated using (public.is_member(business_id));
create policy booking_events_insert on public.booking_events for insert to authenticated with check (public.is_member(business_id));
create policy reminders_select on public.reminders for select to authenticated using (public.is_member(business_id));
create policy notif_select on public.notification_logs for select to authenticated using (public.is_member(business_id));
create policy subscriptions_select on public.subscriptions for select to authenticated using (public.is_member(business_id));

do $$
declare t text;
begin
  foreach t in array array['services','providers','business_hours','provider_hours','blocked_periods','clients','bookings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id))',
      t || '_tenant_all', t);
  end loop;
end $$;

-- Least privilege: anon sees nothing (public pages go through the server); users can only edit safe business columns.
revoke all on all tables in schema public from anon;
revoke update on public.businesses from authenticated;
grant update (name, slug, description, timezone, phone, email) on public.businesses to authenticated;
revoke insert, delete on public.businesses, public.business_members, public.subscriptions from authenticated;
revoke insert, update, delete on public.reminders, public.notification_logs, public.subscriptions from authenticated;

-- ───────────── Functions ─────────────
-- Onboarding: creates tenant + membership + default provider/hours + 14-day trial atomically.
create or replace function public.create_business(p_name text, p_slug text, p_timezone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; d int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from business_members where user_id = auth.uid()) then
    raise exception 'user already has a business'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone'; end if;
  insert into businesses (owner_user_id, name, slug, timezone)
    values (auth.uid(), p_name, lower(p_slug), p_timezone) returning id into v_id;
  insert into business_members (business_id, user_id, role) values (v_id, auth.uid(), 'owner');
  insert into providers (business_id, name) values (v_id, p_name);
  for d in 1..7 loop
    insert into business_hours (business_id, day_of_week, start_time, end_time, enabled)
    values (v_id, d, '09:00', '17:00', d <= 5);
  end loop;
  insert into subscriptions (business_id, status, trial_ends_at, current_period_end)
    values (v_id, 'trialing', now() + interval '14 days', now() + interval '14 days');
  return v_id;
end $$;
revoke all on function public.create_business(text, text, text) from public, anon;
grant execute on function public.create_business(text, text, text) to authenticated;

-- Dashboard aggregates (security invoker => RLS limits rows to the caller's tenant).
create or replace function public.dashboard_stats(p_day_start timestamptz, p_day_end timestamptz)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'today',    count(*) filter (where status in ('pending','confirmed','completed') and starts_at >= p_day_start and starts_at < p_day_end),
    'upcoming', count(*) filter (where status in ('pending','confirmed') and starts_at >= now() and starts_at < now() + interval '7 days'),
    'revenue_cents', coalesce(sum(price_cents) filter (where status in ('confirmed','completed')), 0),
    'completed', count(*) filter (where status = 'completed'),
    'no_show',   count(*) filter (where status = 'no_show'),
    'clients',   (select count(*) from clients)
  ) from bookings
$$;

-- Reminder claiming: atomic + skip-locked so two overlapping job runs never send the same reminder.
create or replace function public.claim_reminders(p_limit int default 50)
returns setof public.reminders language sql security definer set search_path = public as $$
  update reminders r set status = 'sending', attempts = r.attempts + 1
  where r.id in (
    select id from reminders
    where status = 'pending' and scheduled_for <= now() and attempts < 3
    order by scheduled_for limit p_limit for update skip locked)
  returning r.*
$$;
revoke all on function public.claim_reminders(int) from public, anon, authenticated;
grant execute on function public.claim_reminders(int) to service_role;
