"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Lock, Mail, AlertCircle } from "lucide-react";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const notAdmin = searchParams.get("error") === "not-admin";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      setError(signInErr.message);
      setLoading(false);
      return;
    }
    router.push(searchParams.get("redirect") || "/admin");
    router.refresh();
  }

  return (
    <div className="min-h-screen surface-ink flex items-center justify-center py-14">
      <div className="container max-w-sm">
        <div className="card-elegant p-8">
          <h1 className="heading-display text-2xl mb-6 text-center">UNX Awards — Admin</h1>

          {notAdmin && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <AlertCircle className="size-4 mt-0.5 shrink-0" /> That account isn&apos;t an admin on this system.
            </div>
          )}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink/35" />
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="Email" className="w-full rounded-lg border border-black/10 pl-10 pr-4 py-3 text-sm focus:border-gold outline-none" />
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink/35" />
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Password" className="w-full rounded-lg border border-black/10 pl-10 pr-4 py-3 text-sm focus:border-gold outline-none" />
            </div>
            <button type="submit" disabled={loading} className="btn-gold w-full !py-3.5 disabled:opacity-60">
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
