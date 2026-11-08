# Setting up Nova Bin Cleaning on your computer

Follow these steps once. It takes about 30 minutes. Never paste keys into chat or commit them:
they only go in the `.env.local` file, which git ignores.

## 1. Get the code

1. Install **Node.js 22 LTS** from <https://nodejs.org> (choose the LTS download).
2. Open a terminal and run:

   ```bash
   git clone https://github.com/zjfisher08-bit/nova-bins.git
   ```

   ```bash
   cd nova-bins
   ```

   ```bash
   npm install
   ```

3. Make your own settings file from the template:

   ```bash
   cp .env.example .env.local
   ```

   Open `.env.local` in a text editor. You'll fill it in over the next steps.

## 2. Supabase (database, logins, photos)

1. At <https://supabase.com/dashboard>, create a **New project**. Region: **Asia-Pacific (Sydney)**.
   Save the database password in your password manager (you won't need it day to day).
2. When the project is ready, click **Connect** (top of the page) or go to
   **Project Settings → Data API** and copy the **Project URL** into
   `NEXT_PUBLIC_SUPABASE_URL`.
3. Go to **Project Settings → API Keys**:
   - Copy the **Publishable key** (starts `sb_publishable_`) into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - Copy a **Secret key** (starts `sb_secret_`; click *Create new secret key* if there isn't one,
     then reveal it) into `SUPABASE_SECRET_KEY`. Treat this like a password.
4. Create the tables: **SQL Editor → New query**, paste the whole of
   `supabase/migrations/0001_initial_schema.sql`, click **Run**. You should see "Success. No rows returned".
5. Stop strangers making logins: **Authentication → Sign In / Providers** → turn **off**
   "Allow new users to sign up" → Save. (Leave the Email provider itself on.)
6. **Authentication → URL Configuration** → set **Site URL** to `http://localhost:3000` for now
   (we change it to the live address when we deploy).

## 3. Stripe (payments) — test mode

1. At <https://dashboard.stripe.com>, make sure the account country is **New Zealand**.
2. Turn on **Test mode** (toggle top right; it may be called a "Sandbox").
3. **Developers → API keys**: copy the **Publishable key** (`pk_test_…`) into
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and the **Secret key** (`sk_test_…`) into `STRIPE_SECRET_KEY`.
4. Leave `STRIPE_WEBHOOK_SECRET` empty — we set it up in Prompt 2.

## 4. Gmail (automatic emails)

1. Sign in to the business Gmail account → <https://myaccount.google.com/security>.
2. Turn on **2-Step Verification** if it isn't already.
3. Go to <https://myaccount.google.com/apppasswords>, create an app password named
   "Nova website", and copy the 16 letters into `GMAIL_APP_PASSWORD` (spaces don't matter).
4. Put the Gmail address in `GMAIL_USER`.

## 5. Check everything connects

```bash
npm run check-setup
```

Every line should show ✅. Each ❌ says what to fix. (It only reads; it sends no emails.)

## 6. Create your admin login

1. Supabase → **Authentication → Users → Add user → Create new user**. Enter your email and a
   strong password, tick **Auto Confirm User**, click Create.
2. Supabase → **SQL Editor → New query**, paste this (with your email and name), click **Run**:

   ```sql
   update public.profiles
   set role = 'admin', full_name = 'Your Name'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

   It should say "1 row affected". If it says 0, check the email matches exactly.

3. Start the site:

   ```bash
   npm run dev
   ```

4. Open <http://localhost:3000/login>, log in, and you should land on the Admin page.

## 7. (Optional now) Create the worker's login

The admin page will do this from Prompt 4 onwards. To set one up early, add the user the
same way as step 6.1, then run:

```sql
update public.profiles set role = 'worker', full_name = 'Worker Name'
where id = (select id from auth.users where email = 'worker@example.com');

insert into public.workers (id, name, phone, home_address, is_default)
select id, 'Worker Name', '021 000 0000', '1 Example Street, Glenfield', true
from auth.users where email = 'worker@example.com';
```

## Day-to-day commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the site on your computer at http://localhost:3000 |
| `npm test` | Run the automatic tests (prices, pay, scheduling) |
| `npm run check-setup` | Test the keys in `.env.local` |
| `npm run build` | Check the site builds the way Netlify will build it |

## Note on the free Supabase plan

Supabase pauses free projects after about a week with no activity. Once bookings are coming in
this won't happen, but during quiet spells log in to the admin page now and then.
