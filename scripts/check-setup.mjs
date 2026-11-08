// Checks that every key in .env.local works. Run with:  npm run check-setup
// It only reads — it doesn't change anything in Supabase, Stripe or Gmail.

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import nodemailer from "nodemailer";

let failures = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  ❌ ${msg}`);
};
const env = (name) => process.env[name]?.trim();

console.log("\nChecking .env.local …\n");

// --- Supabase -----------------------------------------------------------------
console.log("Supabase");
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const pub = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const secret = env("SUPABASE_SECRET_KEY");
if (!url || !pub || !secret) {
  bad("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must all be set");
} else {
  try {
    const anon = createClient(url, pub);
    const { data, error } = await anon.from("settings").select("business_name, lead_days").single();
    if (error) throw error;
    ok(`Connected with the publishable key — settings found for "${data.business_name}"`);

    const { error: hidden } = await anon.from("customers").select("id").limit(1);
    if (hidden) ok("Publishable key can't read customers (row-level security is on)");
    else bad("Publishable key could read the customers table — re-run the migration SQL");

    const admin = createClient(url, secret, { auth: { persistSession: false } });
    const { count, error: e2 } = await admin.from("suburbs").select("id", { count: "exact", head: true });
    if (e2) throw e2;
    ok(`Secret key works — ${count} suburbs in the service area`);

    const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
    if (admins?.length) ok(`${admins.length} admin login(s) set up`);
    else console.log("  ⚠️  No admin login yet — see docs/SETUP.md step 6");
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/relation .* does not exist|Could not find the table/i.test(msg)) {
      bad("Connected, but the tables aren't there — run supabase/migrations/0001_initial_schema.sql in the SQL Editor");
    } else bad(`Supabase error: ${msg}`);
  }
}

// --- Stripe -------------------------------------------------------------------
console.log("\nStripe");
const sk = env("STRIPE_SECRET_KEY");
const pk = env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
if (!sk || !pk || sk === "sk_test_" || pk === "pk_test_") {
  bad("STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be set");
} else {
  if (!sk.startsWith("sk_test_") || !pk.startsWith("pk_test_")) {
    console.log("  ⚠️  These aren't test-mode keys. Use test keys (sk_test_/pk_test_) until launch.");
  }
  try {
    const stripe = new Stripe(sk);
    const acct = await stripe.accounts.retrieve();
    ok(`Connected to Stripe account ${acct.settings?.dashboard?.display_name ?? acct.id} (${acct.country}, ${acct.default_currency?.toUpperCase()})`);
    if (acct.default_currency && acct.default_currency !== "nzd") {
      console.log("  ⚠️  Account currency isn't NZD — check the Stripe account country is New Zealand");
    }
  } catch (e) {
    bad(`Stripe error: ${e?.message ?? e}`);
  }
}
if (env("STRIPE_WEBHOOK_SECRET")) ok("STRIPE_WEBHOOK_SECRET is set");
else console.log("  ⏳ STRIPE_WEBHOOK_SECRET not set yet — that's fine until Prompt 2");

// --- Gmail --------------------------------------------------------------------
console.log("\nGmail");
const user = env("GMAIL_USER");
const pass = env("GMAIL_APP_PASSWORD")?.replace(/\s+/g, "");
if (!user || !pass) {
  bad("GMAIL_USER and GMAIL_APP_PASSWORD must be set");
} else {
  try {
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await transport.verify();
    ok(`Gmail login works for ${user} (no email was sent)`);
  } catch (e) {
    bad(`Gmail error: ${e?.message ?? e}. Check 2-Step Verification is on and use an App Password, not your normal password.`);
  }
}

// --- Site ---------------------------------------------------------------------
console.log("\nSite");
const site = env("NEXT_PUBLIC_SITE_URL");
if (site) ok(`NEXT_PUBLIC_SITE_URL = ${site}`);
else bad("NEXT_PUBLIC_SITE_URL must be set (http://localhost:3000 while building)");

console.log(failures ? `\n${failures} problem(s) to fix.\n` : "\nAll good! 🎉\n");
process.exit(failures ? 1 : 0);
