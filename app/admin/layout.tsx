"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LayoutList, Trophy, LogOut, Settings } from "lucide-react";

const LINKS = [
  { href: "/admin/nominees", label: "Nominees", icon: LayoutList },
  { href: "/admin/categories", label: "Categories", icon: Trophy },
  { href: "/admin/settings", label: "Site Settings", icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
  }

  if (pathname === "/admin/login") return <>{children}</>;

  return (
    <div className="min-h-screen flex bg-cream">
      <aside className="hidden lg:flex w-64 shrink-0 surface-ink flex-col p-6">
        <p className="eyebrow mb-6">Admin Panel</p>
        <nav className="space-y-1 flex-1">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm ${pathname.startsWith(l.href) ? "bg-gold/15 text-gold" : "text-cream/70 hover:bg-white/5"}`}>
              <l.icon className="size-4" /> {l.label}
            </Link>
          ))}
        </nav>
        <button onClick={logout} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-cream/50 hover:bg-white/5">
          <LogOut className="size-4" /> Log out
        </button>
      </aside>

      <div className="lg:hidden fixed top-0 inset-x-0 z-40 surface-ink border-b border-gold/15 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="eyebrow">Admin Panel</p>
          <button onClick={logout} className="text-cream/60 text-xs flex items-center gap-1"><LogOut className="size-3.5" /> Log out</button>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${pathname.startsWith(l.href) ? "bg-gold/15 text-gold" : "text-cream/60"}`}>
              <l.icon className="size-3.5" /> {l.label}
            </Link>
          ))}
        </nav>
      </div>

      <main className="flex-1 lg:pt-0 pt-24">{children}</main>
    </div>
  );
}
