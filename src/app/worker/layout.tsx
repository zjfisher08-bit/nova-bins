import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import LogoutButton from "../LogoutButton";

export const metadata: Metadata = { title: "Jobs", robots: { index: false } };

export default async function WorkerLayout({ children }: LayoutProps<"/worker">) {
  const user = await requireRole("worker");
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span className="font-semibold">Hi {user.name?.split(" ")[0] ?? "there"}</span>
        <LogoutButton />
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
