import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Supabase client using the SECRET key. It bypasses row-level security, so:
 *  - only use it in server code (the "server-only" import enforces this),
 *  - only after checking who is asking (e.g. Stripe signature, worker owns the job),
 *  - never return its raw results to the browser without picking the fields needed.
 *
 * Used by the booking page, Stripe webhooks, worker actions and the reminder function.
 */
export function createServiceClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Missing environment variable SUPABASE_SECRET_KEY. Add it to .env.local.");
  return createClient(publicEnv.supabaseUrl(), secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
