"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeFor, type Role } from "@/lib/auth";

export interface LoginState {
  error: string | null;
}

/** Only allow redirects back to our own admin/worker pages after login. */
function safeNext(next: FormDataEntryValue | null, role: Role | null): string {
  const home = homeFor(role);
  if (typeof next !== "string") return home;
  if (role === "admin" && next.startsWith("/admin")) return next;
  if (role === "worker" && next.startsWith("/worker")) return next;
  return home;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "That email and password don't match. Try again." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  const role = (profile?.role as Role | null) ?? null;
  if (!role) {
    await supabase.auth.signOut();
    return { error: "Your login works, but it hasn't been given access yet. Ask the owner to set your role." };
  }

  redirect(safeNext(formData.get("next"), role));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
