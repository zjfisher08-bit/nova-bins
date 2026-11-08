# Nova Bin Cleaning — project brief

Read this file at the start of every task. Also read `AGENTS.md`: this is Next.js 16, and its
APIs differ from older versions — check `node_modules/next/dist/docs/` before using a Next API.

## Project
Nova Bin Cleaning booking website, North Shore Auckland, NZ. Wheelie-bin cleaning business. Owner (admin) takes bookings; one contracted worker does the cleaning, paid per item.

Three sides:
- **Booking site** (`/`) — customers, no login. Book and pay in about 2 minutes.
- **Worker page** (`/worker`) — the cleaner, login. Today's jobs in route order, mark done with photo, report problems.
- **Admin page** (`/admin`) — owner, login. Jobs, customers, call-out approvals, prices, payouts.

## Stack
- Next.js 16 (App Router, TypeScript, Tailwind v4). `cacheComponents` is OFF on purpose — keep it simple.
  Request interception lives in `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`).
- Hosted on **Netlify free plan** (free netlify.app subdomain). Netlify supports Next.js natively.
- Supabase (Postgres, Auth, Storage) free tier, Sydney region. Schema lives in `supabase/migrations/*.sql`.
- Stripe Checkout (NZD).
- Email via Gmail SMTP with an app password (nodemailer).
- Geocoding via OpenStreetMap Nominatim: max 1 request/sec, send an identifying User-Agent
  (`NovaBinCleaning/1.0 (+site URL)`, never a personal email), and cache every result in the
  `geocode_cache` table so the same address is never looked up twice.
- Route ordering computed in our own code (nearest-neighbour from the worker's home).
- Navigation via Google Maps directions URLs (no paid Google API). Build links that open the
  **Google Maps app** (`https://www.google.com/maps/dir/?api=1&...` — the app handles these on
  phones). Split routes into parts of max 9 waypoints.
- Daily reminder email via a **Netlify Scheduled Function** at **05:00 UTC** (6pm NZDT in summer,
  5pm NZST in winter).
- Tests: Vitest (`npm test`). Pure business logic (pricing, pay, scheduling) lives in `src/lib/`
  with unit tests next to it.
- Goal: $0/month running cost.

## Users and security
- Customers: no accounts. Everything they need comes by email.
- Worker: login, role = `worker`. Admin: login, role = `admin`. Role is in `profiles.role`.
- Public sign-ups are disabled in Supabase; admin creates logins.
- Row-level security on every table. Workers only see their own jobs and never customer
  payment info or contact details (they read job cards through the `worker_job_cards()` function).
- Server code that must bypass RLS (booking page, webhooks, scheduled function) uses the
  service client in `src/lib/supabase/service.ts`, which is `server-only`.
- Never trust the browser for prices — always calculate on the server.
- Verify Stripe webhook signatures. No keys in code; secrets live in `.env.local` (and Netlify env vars).

## Pricing
Stored in the single-row `settings` table, editable in admin, NZD, amounts stored in cents.
- Wheelie bin = rubbish, recycling or green waste, all priced the same.
- One-off: first wheelie bin $20, each additional wheelie bin $10.
- Subscription: $15 per wheelie bin per clean, 3 cleans, paid upfront, ends after clean 3 (no auto-renew).
- Food scraps caddy: $5 per clean (not part of the wheelie-bin count).
- Deodoriser: +$5 per wheelie bin per clean.
- Call-out fee: 50% of that visit's price, charged off-session to the saved card only when admin approves.

Worked examples (these are unit tests):
- One-off, 1 bin = $20.
- One-off, 3 bins + deodoriser = 20 + 10 + 10 + 3×5 = $55.
- Subscription, rubbish + recycling = 2 × 15 × 3 = $90.
- Subscription, rubbish + recycling + deodoriser = (2×15 + 2×5) × 3 = $120.

## Worker pay
Settings, editable. Admin pays manually by bank transfer; the site calculates weekly (Mon–Sun) totals.
- $10 each for the first 2 wheelie bins per visit, $7 for each wheelie bin after that
- $3 per food scraps caddy
- $2 per deodoriser applied
- 50% of any call-out fee charged
Pay is snapshotted onto the job (`jobs.worker_pay_cents`) when it is marked done, so later rate
changes don't rewrite history.

## Scheduling
All dates are NZ calendar dates (Pacific/Auckland), stored as `date` and handled as
`YYYY-MM-DD` strings in code. Logic is in `src/lib/scheduling.ts`.
- Cleans happen on the customer's collection day (Mon–Fri), after the truck has emptied the bins.
- Customer gives collection day and whether recycling goes out on the upcoming collection day
  (the form shows the actual date, e.g. "Does recycling go out on Thu 12 Nov?"). We store one
  known recycling date (`customers.recycling_anchor`); recycling is every 2 weeks.
- First clean = first collection day at least `lead_days` (setting, default 2) after booking;
  must be a recycling week if a recycling bin is booked. Without a recycling bin it may fall on
  either week.
- Subscription cleans 2 and 3 are every 4 weeks after the first, same weekday (so they keep the
  same recycling/non-recycling parity as clean 1).
- Reschedule = next eligible collection day after today (a recycling week if the booking includes
  recycling). The old job is marked `rescheduled` and a new job is created and linked. **Later
  subscription cleans keep their original dates.**
- Admin "move job / move day" (e.g. public holidays) just changes the date; customers are emailed.
- New jobs go to the default worker (`workers.is_default`). Schema supports multiple workers.
- No daily cap for now.
- Service area = `suburbs` table (North Shore). Anything else can't book.

## Policies
- Pay in full at booking via Stripe Checkout with `customer_creation: 'always'` and
  `payment_intent_data.setup_future_usage: 'off_session'` so the card is saved to a Stripe customer.
- Water and power from the property always required.
- Green waste: the booking form and Terms say green waste bins must already be emptied by the
  clean day (green waste is often collected on a different day). No separate green waste day field.
- Terms must state that a call-out fee (50% of that visit's price) may be charged to the saved
  card if the clean can't go ahead because of the customer (bins not out, no water/power/access).
- Customers cancel by contacting the owner; admin cancels in the dashboard and refunds in Stripe.
- Terms and Privacy pages (NZ Privacy Act 2020).

## Style
- Mobile-first, clean, fast.
- Brand name, logo and colours come from settings.
- Plain friendly NZ English.
- Keep the code simple and well commented; prefer fewer pages and fewer dependencies.

## Workflow
- Build in the order of the prompts in the spec (0–6). After each prompt: `npm test`,
  `npm run lint`, `npm run build`, then commit and push to GitHub (`zjfisher08-bit/nova-bins`).
