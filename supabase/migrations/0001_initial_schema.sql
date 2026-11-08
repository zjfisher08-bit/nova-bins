-- =============================================================================
-- Nova Bin Cleaning — initial database schema
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this whole
-- file → Run. Run it once, on a fresh project.
--
-- Money is always stored in cents (NZD). Dates are NZ calendar dates.
-- Row-level security (RLS) is on for every table:
--   * admin  → full access to everything
--   * worker → only their own jobs/problems/payouts, read through
--              worker_job_cards() which hides customer contact + payment info
--   * public → can read settings (prices) and active suburbs only
-- Server code that needs more (booking, webhooks, reminders) uses the secret
-- (service role) key, which bypasses RLS and never reaches the browser.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings (one row) — prices, worker rates, brand, booking rules
-- ---------------------------------------------------------------------------
create table public.settings (
  id smallint primary key default 1 check (id = 1),

  -- Brand
  business_name       text not null default 'Nova Bin Cleaning',
  logo_url            text,
  brand_primary       text not null default '#0f766e' check (brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  brand_accent        text not null default '#facc15' check (brand_accent ~ '^#[0-9a-fA-F]{6}$'),
  contact_email       text,
  contact_phone       text,
  -- Name shown on emails. The sending address is GMAIL_USER (env) unless this is
  -- set to a "Send mail as" alias verified in that Gmail account.
  email_from_name     text not null default 'Nova Bin Cleaning',
  email_from_address  text,

  -- Booking rules
  lead_days                   int not null default 2 check (lead_days between 0 and 28),
  subscription_cleans         int not null default 3 check (subscription_cleans between 1 and 12),
  subscription_interval_weeks int not null default 4 check (subscription_interval_weeks in (2, 4, 6, 8)),

  -- Customer prices (cents)
  one_off_first_bin_cents  int not null default 2000 check (one_off_first_bin_cents >= 0),
  one_off_extra_bin_cents  int not null default 1000 check (one_off_extra_bin_cents >= 0),
  subscription_bin_cents   int not null default 1500 check (subscription_bin_cents >= 0),
  caddy_cents              int not null default 500  check (caddy_cents >= 0),
  deodoriser_cents         int not null default 500  check (deodoriser_cents >= 0),
  callout_percent          int not null default 50   check (callout_percent between 0 and 100),

  -- Worker pay (cents)
  worker_bin_cents          int not null default 1000 check (worker_bin_cents >= 0),
  worker_extra_bin_cents    int not null default 700  check (worker_extra_bin_cents >= 0),
  worker_bin_tier_size      int not null default 2    check (worker_bin_tier_size >= 0),
  worker_caddy_cents        int not null default 300  check (worker_caddy_cents >= 0),
  worker_deodoriser_cents   int not null default 200  check (worker_deodoriser_cents >= 0),
  worker_callout_percent    int not null default 50   check (worker_callout_percent between 0 and 100),

  updated_at timestamptz not null default now()
);

comment on column public.settings.worker_bin_cents is 'Paid per wheelie bin for the first worker_bin_tier_size bins in a visit';
comment on column public.settings.worker_extra_bin_cents is 'Paid per wheelie bin after the first worker_bin_tier_size bins in a visit';

-- ---------------------------------------------------------------------------
-- Service area
-- ---------------------------------------------------------------------------
create table public.suburbs (
  id         serial primary key,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index suburbs_name_key on public.suburbs (lower(name));

-- ---------------------------------------------------------------------------
-- Logins: profiles (role) and workers
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  -- null = no access yet. Set to 'admin' or 'worker' by the owner.
  role       text check (role in ('admin', 'worker')),
  full_name  text,
  created_at timestamptz not null default now()
);

-- Every new Supabase login gets a profile row with no role.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.workers (
  id            uuid primary key references public.profiles (id) on delete cascade,
  name          text not null,
  phone         text,
  home_address  text,
  home_lat      double precision,
  home_lng      double precision,
  -- New jobs are given to the default worker.
  is_default    boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
-- Only one default worker at a time.
create unique index workers_one_default on public.workers (is_default) where is_default;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  email               text not null,
  phone               text not null,
  street_address      text not null,
  suburb_id           int not null references public.suburbs (id),
  lat                 double precision,
  lng                 double precision,
  geocoded_at         timestamptz,
  -- ISO weekday 1 = Monday ... 5 = Friday
  collection_day      smallint not null check (collection_day between 1 and 5),
  -- One known recycling collection date; recycling is every 14 days from it.
  recycling_anchor    date not null,
  tap_location        text,
  power_location      text,
  access_notes        text,
  bin_area_photo_path text,          -- in the 'customer-photos' storage bucket
  stripe_customer_id  text unique,
  created_at          timestamptz not null default now(),
  constraint recycling_anchor_on_collection_day
    check (extract(isodow from recycling_anchor) = collection_day)
);
create index customers_email_idx on public.customers (lower(email));

-- ---------------------------------------------------------------------------
-- Bookings (one purchase: a one-off clean or a 3-clean subscription)
-- ---------------------------------------------------------------------------
create table public.bookings (
  id                          uuid primary key default gen_random_uuid(),
  customer_id                 uuid not null references public.customers (id),
  type                        text not null check (type in ('one_off', 'subscription')),
  -- Items cleaned at every visit
  wheelie_bins                text[] not null default '{}'
                                check (wheelie_bins <@ array['rubbish', 'recycling', 'green']),
  caddy                       boolean not null default false,
  deodoriser                  boolean not null default false,
  visits                      int not null check (visits >= 1),
  visit_price_cents           int not null check (visit_price_cents >= 0),
  total_cents                 int not null check (total_cents >= 0),
  -- pending_payment → active (paid) → completed (all cleans done) | cancelled
  status                      text not null default 'pending_payment'
                                check (status in ('pending_payment', 'active', 'completed', 'cancelled')),
  source                      text not null default 'website' check (source in ('website', 'manual')),
  stripe_checkout_session_id  text unique,
  stripe_payment_intent_id    text unique,
  stripe_payment_method_id    text,      -- saved card, used for call-out fees
  amount_paid_cents           int,
  refunded_cents              int not null default 0,
  terms_accepted_at           timestamptz,
  paid_at                     timestamptz,
  cancelled_at                timestamptz,
  created_at                  timestamptz not null default now(),
  constraint booking_has_items check (cardinality(wheelie_bins) > 0 or caddy),
  constraint total_matches check (total_cents = visit_price_cents * visits)
);
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_status_idx on public.bookings (status);

-- ---------------------------------------------------------------------------
-- Jobs (one per visit)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings (id) on delete cascade,
  customer_id         uuid not null references public.customers (id),
  worker_id           uuid references public.workers (id),
  visit_number        int not null check (visit_number >= 1),   -- 1, 2, 3 for subscriptions
  scheduled_date      date not null,
  -- scheduled → done
  -- scheduled → problem → rescheduled (a new linked job is created)
  -- scheduled → cancelled
  status              text not null default 'scheduled'
                        check (status in ('scheduled', 'done', 'problem', 'rescheduled', 'cancelled')),
  -- What to clean (copied from the booking)
  wheelie_bins        text[] not null default '{}'
                        check (wheelie_bins <@ array['rubbish', 'recycling', 'green']),
  caddy               boolean not null default false,
  deodoriser          boolean not null default false,
  -- Map point (copied from the customer) and position in the day's route
  lat                 double precision,
  lng                 double precision,
  route_order         int,
  -- Photos in the 'job-photos' storage bucket
  before_photo_path   text,
  after_photo_path    text,
  completed_at        timestamptz,
  -- Worker pay for this visit, snapshotted when marked done
  worker_pay_cents    int check (worker_pay_cents >= 0),
  -- When this job replaces a rescheduled one
  rescheduled_from    uuid references public.jobs (id),
  created_at          timestamptz not null default now(),
  constraint done_has_photo check (status <> 'done' or (after_photo_path is not null and completed_at is not null))
);
create index jobs_date_idx on public.jobs (scheduled_date);
create index jobs_worker_date_idx on public.jobs (worker_id, scheduled_date);
create index jobs_booking_idx on public.jobs (booking_id);
create unique index jobs_one_replacement on public.jobs (rescheduled_from) where rescheduled_from is not null;

-- ---------------------------------------------------------------------------
-- Problems reported by the worker, and the admin's decision
-- ---------------------------------------------------------------------------
create table public.problems (
  id                        uuid primary key default gen_random_uuid(),
  job_id                    uuid not null references public.jobs (id) on delete cascade,
  worker_id                 uuid references public.workers (id),
  reason                    text not null
                              check (reason in ('bins_not_out', 'no_water', 'no_power', 'no_access', 'other')),
  note                      text,
  photo_path                text,
  status                    text not null default 'open' check (status in ('open', 'resolved')),
  resolution                text check (resolution in ('reschedule', 'reschedule_callout')),
  callout_fee_cents         int check (callout_fee_cents >= 0),
  -- Call-out charge attempt: succeeded | failed (error kept for follow-up)
  stripe_payment_intent_id  text,
  charge_status             text check (charge_status in ('succeeded', 'failed')),
  charge_error              text,
  -- Worker's share, snapshotted only when the charge succeeds
  worker_callout_cents      int check (worker_callout_cents >= 0),
  new_job_id                uuid references public.jobs (id),
  created_at                timestamptz not null default now(),
  resolved_at               timestamptz
);
create index problems_open_idx on public.problems (status) where status = 'open';
create index problems_job_idx on public.problems (job_id);

-- ---------------------------------------------------------------------------
-- Weekly payouts to workers (Mon–Sun weeks)
-- ---------------------------------------------------------------------------
create table public.payouts (
  id           uuid primary key default gen_random_uuid(),
  worker_id    uuid not null references public.workers (id),
  week_start   date not null check (extract(isodow from week_start) = 1),  -- a Monday
  amount_cents int not null check (amount_cents >= 0),
  -- Snapshot of what was counted (bins, caddies, deodorisers, call-outs)
  items        jsonb not null default '{}',
  paid_at      date not null,
  created_at   timestamptz not null default now(),
  unique (worker_id, week_start)
);

-- ---------------------------------------------------------------------------
-- Email log — stops the same email being sent twice (e.g. reminders)
-- ---------------------------------------------------------------------------
create table public.email_log (
  id          bigserial primary key,
  -- e.g. 'reminder:<job id>:2026-11-18' or 'confirmation:<booking id>'
  dedupe_key  text not null unique,
  kind        text not null,
  to_email    text not null,
  job_id      uuid references public.jobs (id) on delete set null,
  booking_id  uuid references public.bookings (id) on delete set null,
  sent_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Geocode cache — OpenStreetMap Nominatim results, so each address is only
-- looked up once (their usage policy asks us to cache).
-- ---------------------------------------------------------------------------
create table public.geocode_cache (
  query         text primary key,   -- normalised "street, suburb, Auckland, New Zealand"
  found         boolean not null,
  lat           double precision,
  lng           double precision,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- =============================================================================
-- Row-level security
-- =============================================================================

-- Helpers. SECURITY DEFINER so they can read profiles without tripping RLS.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create function public.is_worker() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.workers w on w.id = p.id
    where p.id = auth.uid() and p.role = 'worker' and w.active
  );
$$;

alter table public.settings      enable row level security;
alter table public.suburbs       enable row level security;
alter table public.profiles      enable row level security;
alter table public.workers       enable row level security;
alter table public.customers     enable row level security;
alter table public.bookings      enable row level security;
alter table public.jobs          enable row level security;
alter table public.problems      enable row level security;
alter table public.payouts       enable row level security;
alter table public.email_log     enable row level security;
alter table public.geocode_cache enable row level security;

-- Table permissions, set explicitly so this works whether or not the project
-- auto-exposes new tables. RLS policies below still decide which ROWS each user sees.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
-- Belt and braces: the public (anon) key gets no table access except prices and suburbs.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.settings, public.suburbs to anon;

-- Settings: anyone can read (prices are public); only admin can change.
create policy "settings readable by all" on public.settings for select using (true);
create policy "settings admin update" on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Suburbs: anyone can read active ones; admin manages.
create policy "active suburbs readable" on public.suburbs for select using (active or public.is_admin());
create policy "suburbs admin all" on public.suburbs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Profiles: see your own; admin sees and edits all. (No one can give themselves a role.)
create policy "own profile" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "profiles admin update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Workers: see your own row; admin manages.
create policy "own worker row" on public.workers for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "workers admin all" on public.workers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Customers and bookings: admin only (contact + payment details).
create policy "customers admin all" on public.customers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "bookings admin all" on public.bookings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Jobs: admin all; a worker can read only their own. (Jobs hold no prices.)
-- Workers change jobs only through server actions, which check ownership first.
create policy "jobs admin all" on public.jobs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "worker reads own jobs" on public.jobs for select to authenticated
  using (worker_id = auth.uid() and public.is_worker());

-- Problems: admin all; worker reads their own reports.
create policy "problems admin all" on public.problems for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "worker reads own problems" on public.problems for select to authenticated
  using (worker_id = auth.uid() and public.is_worker());

-- Payouts: admin all; worker reads their own.
create policy "payouts admin all" on public.payouts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "worker reads own payouts" on public.payouts for select to authenticated
  using (worker_id = auth.uid() and public.is_worker());

-- email_log and geocode_cache: no policies → only the server (secret key) can use them.

-- ---------------------------------------------------------------------------
-- What a worker sees on a job card. Only the logged-in worker's own jobs,
-- and only what's needed to do the job: no email, phone, surname or payments.
-- ---------------------------------------------------------------------------
create function public.worker_job_cards(p_from date, p_to date)
returns table (
  job_id              uuid,
  scheduled_date      date,
  status              text,
  visit_number        int,
  wheelie_bins        text[],
  caddy               boolean,
  deodoriser          boolean,
  lat                 double precision,
  lng                 double precision,
  route_order         int,
  before_photo_path   text,
  after_photo_path    text,
  customer_first_name text,
  street_address      text,
  suburb              text,
  tap_location        text,
  power_location      text,
  access_notes        text,
  bin_area_photo_path text
)
language sql stable security definer set search_path = '' as $$
  select j.id, j.scheduled_date, j.status, j.visit_number, j.wheelie_bins, j.caddy, j.deodoriser,
         j.lat, j.lng, j.route_order, j.before_photo_path, j.after_photo_path,
         split_part(c.name, ' ', 1), c.street_address, s.name,
         c.tap_location, c.power_location, c.access_notes, c.bin_area_photo_path
  from public.jobs j
  join public.customers c on c.id = j.customer_id
  join public.suburbs s on s.id = c.suburb_id
  where j.worker_id = auth.uid()
    and public.is_worker()
    and j.scheduled_date between p_from and p_to
    and j.status in ('scheduled', 'done', 'problem')
  order by j.scheduled_date, j.route_order nulls last, j.created_at;
$$;

revoke execute on function public.worker_job_cards(date, date) from public, anon;
grant execute on function public.worker_job_cards(date, date) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- =============================================================================
-- Photo storage (private buckets — photos are shown with short-lived signed
-- links made on the server, so no storage policies are needed)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('customer-photos', 'customer-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('job-photos',      'job-photos',      false, 2097152,  array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- =============================================================================
-- Seed data
-- =============================================================================
insert into public.settings (id) values (1);

-- Starter list of North Shore suburbs — edit in the admin page.
insert into public.suburbs (name) values
  ('Albany'), ('Albany Heights'), ('Bayswater'), ('Bayview'), ('Beach Haven'), ('Belmont'),
  ('Birkdale'), ('Birkenhead'), ('Browns Bay'), ('Campbells Bay'), ('Castor Bay'),
  ('Chatswood'), ('Cheltenham'), ('Devonport'), ('Fairview Heights'), ('Forrest Hill'),
  ('Glenfield'), ('Greenhithe'), ('Hauraki'), ('Hillcrest'), ('Long Bay'), ('Mairangi Bay'),
  ('Marlborough'), ('Milford'), ('Murrays Bay'), ('Narrow Neck'), ('Northcote'),
  ('Northcote Point'), ('Northcross'), ('Oteha'), ('Pinehill'), ('Rothesay Bay'),
  ('Schnapper Rock'), ('Stanley Point'), ('Sunnynook'), ('Takapuna'), ('Torbay'),
  ('Totara Vale'), ('Unsworth Heights'), ('Waiake'), ('Windsor Park');
