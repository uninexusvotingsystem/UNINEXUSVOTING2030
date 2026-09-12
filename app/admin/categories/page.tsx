"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Plus, Link2, Trash2 } from "lucide-react";

const EMPTY = { name: "", slug: "", description: "" };

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
    setCategories(data || []);
  }
  useEffect(() => { load(); }, []);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();
    const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    await supabase.from("categories").insert({ ...form, slug, sort_order: categories.length });
    setForm(EMPTY);
    setSaving(false);
    load();
  }

  async function toggle(id: string, field: "nominations_open" | "voting_open" | "results_published", current: boolean) {
    const supabase = createClient();
    await supabase.from("categories").update({ [field]: !current }).eq("id", id);
    load();
  }

  async function setVotingDeadline(id: string, value: string) {
    const supabase = createClient();
    await supabase.from("categories").update({ voting_closes_at: value ? new Date(value).toISOString() : null }).eq("id", id);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this category and every nominee/vote in it? This cannot be undone.")) return;
    const supabase = createClient();
    await supabase.from("categories").delete().eq("id", id);
    load();
  }

  function copyNominateLink(slug: string) {
    const url = `${location.origin}/nominate?category=${slug}`;
    navigator.clipboard.writeText(url);
    alert(`Copied nomination link for this category:\n${url}`);
  }

  function copyVoteLink(slug: string) {
    const url = `${location.origin}/vote/${slug}`;
    navigator.clipboard.writeText(url);
    alert(`Copied voting link for this category:\n${url}`);
  }

  return (
    <div className="p-8 sm:p-10 max-w-4xl">
      <h1 className="heading-display text-3xl mb-8">Categories</h1>

      <form onSubmit={addCategory} className="card-elegant p-6 space-y-3 mb-8">
        <h2 className="font-display text-lg mb-1">New category</h2>
        <input required placeholder="Category name e.g. Dancer of the Year" value={form.name}
          onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))}
          className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm" />
        <textarea placeholder="Short description (optional)" rows={2} value={form.description}
          onChange={(e) => setForm((f: any) => ({ ...f, description: e.target.value }))}
          className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm resize-none" />
        <button type="submit" disabled={saving} className="btn-gold !py-2.5 !px-5 disabled:opacity-60">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <><Plus className="size-4" /> Add category</>}
        </button>
      </form>

      <div className="space-y-3">
        {categories.map((c) => (
          <div key={c.id} className="card-elegant p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="font-display text-lg">{c.name}</h3>
                {c.description && <p className="text-sm text-ink/50">{c.description}</p>}
              </div>
              <button onClick={() => remove(c.id)} className="text-red-500 hover:text-red-700 shrink-0"><Trash2 className="size-4" /></button>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={() => toggle(c.id, "nominations_open", c.nominations_open)}
                className={`text-xs px-3 py-1.5 rounded-full border ${c.nominations_open ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "border-black/10 text-ink/50"}`}>
                Nominations: {c.nominations_open ? "Open" : "Closed"}
              </button>
              <button onClick={() => toggle(c.id, "voting_open", c.voting_open)}
                className={`text-xs px-3 py-1.5 rounded-full border ${c.voting_open ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "border-black/10 text-ink/50"}`}>
                Voting: {c.voting_open ? "Open" : "Closed"}
              </button>
              <button onClick={() => toggle(c.id, "results_published", c.results_published)}
                className={`text-xs px-3 py-1.5 rounded-full border ${c.results_published ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "border-black/10 text-ink/50"}`}>
                Results: {c.results_published ? "Public" : "Hidden"}
              </button>
            </div>

            <div className="mb-3">
              <label className="text-[11px] text-ink/45 block mb-1">
                Auto-close voting at (optional — checked periodically by a scheduled job, see README for frequency; leave blank to close manually)
              </label>
              <input
                type="datetime-local"
                defaultValue={c.voting_closes_at ? new Date(c.voting_closes_at).toISOString().slice(0, 16) : ""}
                onBlur={(e) => setVotingDeadline(c.id, e.target.value)}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-xs"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => copyNominateLink(c.slug)} className="text-xs px-3 py-1.5 rounded-full border border-gold/30 text-gold-deep hover:bg-gold/10 flex items-center gap-1">
                <Link2 className="size-3" /> Copy nominate link
              </button>
              <button onClick={() => copyVoteLink(c.slug)} className="text-xs px-3 py-1.5 rounded-full border border-gold/30 text-gold-deep hover:bg-gold/10 flex items-center gap-1">
                <Link2 className="size-3" /> Copy vote link
              </button>
            </div>
          </div>
        ))}
        {categories.length === 0 && <p className="text-sm text-ink/40 text-center py-4">No categories yet — add one above.</p>}
      </div>
    </div>
  );
}
