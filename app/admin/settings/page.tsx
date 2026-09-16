"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Check, AlertCircle } from "lucide-react";

export default function AdminSettingsPage() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "marquee_text")
      .maybeSingle()
      .then(({ data }) => {
        setText(data?.value || "");
        setLoading(false);
      });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    const supabase = createClient();
    // upsert, not update — the row may not exist yet if the seed in migration
    // 0003 was skipped or the key was deleted.
    const { error } = await supabase
      .from("site_settings")
      .upsert({ key: "marquee_text", value: text.trim(), updated_at: new Date().toISOString() });

    setResult(
      error
        ? { ok: false, message: error.message }
        : { ok: true, message: "Saved — visitors will see the new banner within a few seconds." }
    );
    setSaving(false);
  }

  return (
    <div className="p-8 sm:p-10 max-w-2xl">
      <h1 className="heading-display text-3xl mb-1">Site Settings</h1>
      <p className="text-sm text-ink/50 mb-8">
        The scrolling banner shown at the very top of every public page.
      </p>

      <form onSubmit={save} className="card-elegant p-6 space-y-3">
        <label className="text-xs text-ink/50 block">Scrolling banner text</label>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-ink/40 py-3">
            <Loader2 className="size-4 animate-spin" /> Loading current text…
          </div>
        ) : (
          <>
            <textarea
              required
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Nominations now open — closes Friday 25th September!"
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm resize-none"
            />
            <p className="text-[11px] text-ink/40">
              Keep it short — it scrolls across the screen, so long messages take a while to read fully.
            </p>

            <div className="rounded-lg bg-gold/10 border border-gold/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-gold-deep mb-1.5">Preview</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink truncate">
                {text || "Your banner text will appear here"}
              </p>
            </div>

            {result && (
              <div
                className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                  result.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-red-50 border border-red-200 text-red-700"
                }`}
              >
                {result.ok ? <Check className="size-4 mt-0.5 shrink-0" /> : <AlertCircle className="size-4 mt-0.5 shrink-0" />}
                {result.message}
              </div>
            )}

            <button type="submit" disabled={saving} className="btn-gold !py-2.5 !px-5 disabled:opacity-60">
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save banner"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
