"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Check, X, Trash2, Search, Film } from "lucide-react";

const PAGE_SIZE = 25;

export default function AdminNomineesPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [status, setStatus] = useState<string>("pending");
  const [search, setSearch] = useState("");
  const [nominees, setNominees] = useState<any[]>([]);
  const [mediaByNominee, setMediaByNominee] = useState<Record<string, any[]>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("categories").select("id, name").order("sort_order", { ascending: true }).then(({ data }) => setCategories(data || []));
  }, []);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    let query = supabase.from("nominees").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (categoryId) query = query.eq("category_id", categoryId);
    if (status !== "all") query = query.eq("status", status);
    if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
    query = query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    const { data, count } = await query;
    setNominees(data || []);
    setTotal(count || 0);
    setSelected(new Set());

    if (data && data.length > 0) {
      const { data: media } = await supabase.from("nominee_media").select("*").in("nominee_id", data.map((n) => n.id));
      const grouped: Record<string, any[]> = {};
      (media || []).forEach((m) => {
        grouped[m.nominee_id] = grouped[m.nominee_id] || [];
        grouped[m.nominee_id].push(m);
      });
      setMediaByNominee(grouped);
    } else {
      setMediaByNominee({});
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [categoryId, status, page]);
  // Search is debounced-by-hand via the button below rather than firing per keystroke.

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(selected.size === nominees.length ? new Set() : new Set(nominees.map((n) => n.id)));
  }

  async function setStatusFor(ids: string[], newStatus: "approved" | "rejected") {
    const supabase = createClient();
    await supabase.from("nominees").update({ status: newStatus, moderated_at: new Date().toISOString() }).in("id", ids);
    load();
  }

  async function deleteNominees(ids: string[]) {
    if (!confirm(`Permanently delete ${ids.length} nominee(s) and their media/votes? This cannot be undone.`)) return;
    const supabase = createClient();
    await supabase.from("nominees").delete().in("id", ids);
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-8 sm:p-10">
      <h1 className="heading-display text-3xl mb-1">Nominees</h1>
      <p className="text-sm text-ink/50 mb-6">{total} nominee{total === 1 ? "" : "s"} matching your filters.</p>

      <div className="flex flex-wrap gap-2 mb-5">
        <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(0); }} className="rounded-lg border border-black/10 px-3 py-2 text-sm bg-white">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="inline-flex rounded-full border border-black/10 p-1">
          {(["pending", "approved", "rejected", "all"] as const).map((s) => (
            <button key={s} onClick={() => { setStatus(s); setPage(0); }}
              className={`text-xs px-3 py-1.5 rounded-full capitalize ${status === s ? "bg-gold-foil text-ink shadow-gold" : "text-ink/50"}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(0), load())}
            placeholder="Search by name" className="rounded-lg border border-black/10 px-3 py-2 text-sm" />
          <button onClick={() => { setPage(0); load(); }} className="p-2 rounded-lg border border-black/10 hover:bg-black/5"><Search className="size-4" /></button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-gold/10 border border-gold/20">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <button onClick={() => setStatusFor(Array.from(selected), "approved")} className="text-xs px-3 py-1.5 rounded-full bg-emerald-600 text-white flex items-center gap-1"><Check className="size-3" /> Approve</button>
          <button onClick={() => setStatusFor(Array.from(selected), "rejected")} className="text-xs px-3 py-1.5 rounded-full bg-black/70 text-white flex items-center gap-1"><X className="size-3" /> Reject</button>
          <button onClick={() => deleteNominees(Array.from(selected))} className="text-xs px-3 py-1.5 rounded-full bg-red-600 text-white flex items-center gap-1"><Trash2 className="size-3" /> Delete</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-gold-deep" /></div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-ink/50 px-1">
            <input type="checkbox" checked={selected.size > 0 && selected.size === nominees.length} onChange={toggleSelectAll} className="accent-[#C9A227]" />
            Select all on this page
          </label>

          {nominees.map((n) => {
            const media = mediaByNominee[n.id] || [];
            return (
              <div key={n.id} className="card-elegant p-4 flex items-start gap-4">
                <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggleSelect(n.id)} className="mt-1.5 accent-[#C9A227]" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-display text-base">{n.name}</h3>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      n.status === "approved" ? "bg-emerald-50 text-emerald-700" : n.status === "rejected" ? "bg-black/10 text-ink/50" : "bg-amber-50 text-amber-700"
                    }`}>{n.status}</span>
                  </div>
                  <p className="text-sm text-ink/60 mb-2">{n.about}</p>
                  {(n.submitter_email || n.submitter_phone) && (
                    <p className="text-[11px] text-ink/40 mb-2">Submitted by: {[n.submitter_email, n.submitter_phone].filter(Boolean).join(" · ")}</p>
                  )}
                  {media.length > 0 && (
                    <div className="flex gap-1.5">
                      {media.map((m) => (
                        <div key={m.id} className="size-12 rounded-md overflow-hidden bg-black/5 shrink-0">
                          {m.media_type === "video" ? (
                            <div className="w-full h-full flex items-center justify-center bg-black/80"><Film className="size-4 text-cream/70" /></div>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {n.status !== "approved" && (
                    <button onClick={() => setStatusFor([n.id], "approved")} className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100">Approve</button>
                  )}
                  {n.status !== "rejected" && (
                    <button onClick={() => setStatusFor([n.id], "rejected")} className="text-xs px-2.5 py-1 rounded-full bg-black/5 text-ink/60 hover:bg-black/10">Reject</button>
                  )}
                  <button onClick={() => deleteNominees([n.id])} className="text-xs px-2.5 py-1 rounded-full text-red-600 hover:bg-red-50">Delete</button>
                </div>
              </div>
            );
          })}
          {nominees.length === 0 && <p className="text-sm text-ink/40 text-center py-10">No nominees match these filters.</p>}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="text-xs px-3 py-1.5 rounded-full border border-black/10 disabled:opacity-40">Previous</button>
          <span className="text-xs text-ink/50">Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="text-xs px-3 py-1.5 rounded-full border border-black/10 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
