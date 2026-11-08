import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "worker";

export interface CurrentUser {
  id: string;
  email: string | null;
  role: Role | null;
  name: string | null;
}

/** The logged-in user and their role, or null if logged out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;

  // RLS lets each user read their own profile row.
  const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", claims.sub).maybeSingle();

  return {
    id: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    role: (profile?.role as Role | null) ?? null,
    name: profile?.full_name ?? null,
  };
}

/** Where each role lands after logging in. */
export function homeFor(role: Role | null): string {
  if (role === "admin") return "/admin";
  if (role === "worker") return "/worker";
  return "/login?error=no-role";
}

/**
 * Use at the top of every admin/worker layout and server action.
 * Logged out → login page. Wrong role → their own home (or an error if no role).
 */
export async function requireRole(role: Role): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}
