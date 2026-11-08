import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  "no-role": "Your login works, but it hasn't been given access yet. Ask the owner to set your role.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error = typeof params.error === "string" ? (ERRORS[params.error] ?? null) : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <h1 className="mb-1 text-2xl font-bold">Staff login</h1>
      <p className="mb-6 text-sm text-slate-600">For the Nova Bin Cleaning team. Customers don&apos;t need to log in.</p>
      <LoginForm next={next} initialError={error} />
    </main>
  );
}
