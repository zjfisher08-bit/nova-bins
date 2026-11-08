# Nova Bin Cleaning

Booking website for a wheelie-bin cleaning business on Auckland's North Shore.

- **Customers** book and pay online (no account needed).
- **Worker** sees the day's jobs in route order at `/worker`.
- **Admin** manages jobs, customers, call-outs, prices and payouts at `/admin`.

Built with Next.js, Supabase, Stripe Checkout and Gmail; hosted on Netlify's free plan.
See [`CLAUDE.md`](CLAUDE.md) for the full brief and business rules.

## Getting started

Follow [`docs/SETUP.md`](docs/SETUP.md), then:

```bash
npm run dev
```

## Project layout

| Path | What's there |
| --- | --- |
| `src/app/` | Pages: `/` booking, `/login`, `/admin`, `/worker` |
| `src/lib/scheduling.ts` | Clean dates, recycling weeks, reschedules (tested) |
| `src/lib/pricing.ts` | Customer prices, call-out fees, worker pay (tested) |
| `src/lib/supabase/` | Database connections (user session vs. server-only secret key) |
| `src/proxy.ts` | Keeps logins fresh; sends logged-out visitors to `/login` |
| `supabase/migrations/` | Database tables, security rules and starting data |
| `scripts/check-setup.mjs` | `npm run check-setup` — tests your `.env.local` keys |
