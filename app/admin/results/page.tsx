"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, RefreshCw, Trophy } from "lucide-react";

// How often this page re-fetches while left open. Admin-only, low traffic
// relative to the public site, so a tight interval here isn't a real load
// concern — but 10s is already fast enough to feel "live" without hammering
// Supabase on every single vote.
const POLL_INTERVAL_MS = 10_000;

export default function AdminResultsPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [nomineesByCategory, setNomineesByCategory] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: cats } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
    setCategories(cats || []);

    // Deliberately NOT filtered by results_published or voting_open — this
    // page is for the admin's own eyes only (already behind the /admin
    // auth guard in middleware.ts), and always shows the real, current
    // vote_count regardless of what's visible to the public. That's the
    // whole point: the admin can watch tallying live without waiting for
    // (or needing) the public results toggle.
    const { data: noms } = await supabase
      .from("nominees")
      .select("id, name, category_id, vote_count")
      .eq("status", "approved")
      .order("vote_count", { ascending: false });

    const grouped: Record<string, any[]> = {};
    (noms || []).forEach((n) => {
      grouped[n.category_id] = grouped[n.category_id] || [];
      grouped[n.category_id].push(n);
    });
    setNomineesByCategory(grouped);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const visibleCategories = selectedCategoryId ? categories.filter((c) => c.id === selectedCategoryId) : categories;

  return (
    <div className="p-8 sm:p-10 max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="heading-display text-3xl">Live Results</h1>
        <button onClick={load} className="shrink-0 text-xs px-3 py-1.5 rounded-full border border-gold/30 text-gold-deep hover:bg-gold/10 flex items-center gap-1.5">
          <RefreshCw className="size-3.5" /> Refresh now
        </button>
      </div>
      <p className="text-sm text-ink/50 mb-1">
        Admin-only — real vote counts, always visible to you regardless of whether "Results: Public" is on for voters.
      </p>
      {lastUpdated && (
        <p className="text-[11px] text-ink/35 mb-6">
          Updated {lastUpdated.toLocaleTimeString()} · refreshes automatically every {POLL_INTERVAL_MS / 1000}s
        </p>
      )}

      <select
        value={selectedCategoryId}
        onChange={(e) => setSelectedCategoryId(e.target.value)}
        className="rounded-lg border border-black/10 px-3 py-2 text-sm bg-white mb-6"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-gold-deep" /></div>
      ) : (
        <div className="space-y-6">
          {visibleCategories.map((c) => {
            const noms = nomineesByCategory[c.id] || [];
            const totalVotes = noms.reduce((sum, n) => sum + (n.vote_count || 0), 0);
            return (
              <div key={c.id} className="card-elegant p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display text-lg">{c.name}</h2>
                  <span className="text-xs text-ink/40">{totalVotes} total vote{totalVotes === 1 ? "" : "s"}</span>
                </div>
                {noms.length === 0 ? (
                  <p className="text-sm text-ink/40">No approved nominees in this category yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {noms.map((n, i) => (
                      <div key={n.id} className="flex items-center gap-3 py-1.5 border-b border-black/5 last:border-0">
                        <span className={`shrink-0 text-xs font-semibold w-6 text-center ${i === 0 && n.vote_count > 0 ? "text-gold-deep" : "text-ink/30"}`}>
                          {i === 0 && n.vote_count > 0 ? <Trophy className="size-3.5 inline" /> : `#${i + 1}`}
                        </span>
                        <span className="flex-1 text-sm truncate">{n.name}</span>
                        <span className="shrink-0 text-sm font-semibold text-gold-deep">{n.vote_count || 0}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {visibleCategories.length === 0 && <p className="text-sm text-ink/40 text-center py-10">No categories yet.</p>}
        </div>
      )}
    </div>
  );
}
