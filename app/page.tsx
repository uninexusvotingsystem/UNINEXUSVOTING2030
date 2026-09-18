"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";
import { createClient } from "@/lib/supabase/client";
import { Loader2, UploadCloud, X, CheckCircle2 } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";

const MAX_MEDIA = 2;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

function NominateFormInner() {
  const searchParams = useSearchParams();
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", categoryId: "", about: "", submitterEmail: "", submitterPhone: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("categories").select("*").eq("nominations_open", true).order("sort_order", { ascending: true }).then(({ data }) => {
      setCategories(data || []);
      const preselect = searchParams.get("category");
      if (preselect && data) {
        const match = data.find((c: any) => c.slug === preselect);
        if (match) setForm((f) => ({ ...f, categoryId: match.id }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    // Silently drop anything that isn't an allowed image type (e.g. video) —
    // the accept attribute on the input already steers people away from this,
    // but a filter here catches drag-and-drop and other paths around it.
    const validOnly = Array.from(newFiles).filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type));
    const combined = [...files, ...validOnly].slice(0, MAX_MEDIA);
    setFiles(combined);
  }

  function removeFile(index: number) {
    setFiles((f) => f.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.categoryId) return setError("Please choose a category.");
    if (!form.submitterEmail.trim()) return setError("Please enter your email.");
    if (!form.submitterPhone.trim()) return setError("Please enter your phone number.");
    if (files.length === 0) return setError("Please upload a photo — it's required as the nominee's profile photo during voting.");

    setSubmitting(true);
    const body = new FormData();
    body.set("name", form.name);
    body.set("categoryId", form.categoryId);
    body.set("about", form.about);
    body.set("submitterEmail", form.submitterEmail);
    body.set("submitterPhone", form.submitterPhone);
    // Honeypot — left blank by real visitors, sometimes filled by bots.
    body.set("website", "");
    files.forEach((f) => body.append("media", f));

    try {
      // Turnstile injects a hidden input with this name inside its widget div
      // once the visitor passes the challenge. Since this FormData is built
      // field-by-field rather than from the <form> element directly, it has to
      // be read and appended explicitly.
      const turnstileInput = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
      if (TURNSTILE_SITE_KEY) {
        if (!turnstileInput?.value) {
          setError("Please complete the verification check before submitting.");
          setSubmitting(false);
          return;
        }
        body.set("turnstileToken", turnstileInput.value);
      }

      const res = await fetch("/api/nominations/submit", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't submit your nomination. Please try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="card-elegant p-10 text-center max-w-lg mx-auto">
        <CheckCircle2 className="size-10 text-emerald-600 mx-auto mb-4" />
        <h2 className="font-display text-2xl mb-2">Nomination received</h2>
        <p className="text-sm text-ink/60">Thank you — this nomination will be reviewed before it appears publicly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card-elegant p-7 sm:p-9 max-w-lg mx-auto space-y-4">
      <p className="text-[12px] text-ink/50 text-center -mt-1 mb-1">
        Need help with your nomination? Call <a href="tel:+254718547198" className="text-gold-deep font-medium">+254 718 547198</a> or email{" "}
        <a href="mailto:uninexusplatformke@gmail.com" className="text-gold-deep font-medium">uninexusplatformke@gmail.com</a>
      </p>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div>
        <label className="text-xs text-ink/50 block mb-1">Nominee&apos;s name *</label>
        <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm" />
      </div>

      <div>
        <label className="text-xs text-ink/50 block mb-1">Category *</label>
        <select required value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm bg-white">
          <option value="">Choose a category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div>
        <label className="text-xs text-ink/50 block mb-1">Why are they being nominated? (short &amp; precise) *</label>
        <textarea required rows={4} maxLength={600} value={form.about} onChange={(e) => setForm((f) => ({ ...f, about: e.target.value }))}
          placeholder="A few sentences on what they do and why they deserve this nomination."
          className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm resize-none" />
        <p className="text-[11px] text-ink/35 mt-1">{form.about.length}/600</p>
      </div>

      <div>
        <label className="text-xs text-ink/50 block mb-1">Photo or logo * (required, up to {MAX_MEDIA})</label>
        <p className="text-[11px] text-ink/40 mb-2">Required — a clear photo of the nominee, or a brand/organization logo. This will be used as their profile photo during voting.</p>
        <label className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gold/30 p-6 text-center cursor-pointer hover:bg-gold/5 transition-colors ${files.length >= MAX_MEDIA ? "opacity-50 pointer-events-none" : ""}`}>
          <UploadCloud className="size-6 text-gold-deep" />
          <span className="text-sm text-ink/60">Click to add a photo or logo</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} disabled={files.length >= MAX_MEDIA} />
        </label>
        {files.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {files.map((f, i) => (
              <div key={i} className="relative rounded-lg overflow-hidden border border-black/10 bg-black/5 aspect-square flex items-center justify-center">
                <span className="text-[10px] text-ink/50 text-center px-1 truncate">{f.name}</span>
                <button type="button" onClick={() => removeFile(i)} className="absolute top-1 right-1 size-5 rounded-full bg-black/70 text-white flex items-center justify-center">
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg bg-black/[0.03] border border-black/10 p-3 text-[11px] text-ink/55 leading-relaxed">
        Each name can only be nominated once per category — in any spelling or capitalization, and regardless of who submits it. If this name (or a very close spelling of it) has already been submitted in this category, the system will decline the nomination automatically.
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-ink/50 block mb-1">Your email *</label>
          <input required type="email" value={form.submitterEmail} onChange={(e) => setForm((f) => ({ ...f, submitterEmail: e.target.value }))}
            placeholder="In case we need to reach you" className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-ink/50 block mb-1">Your phone *</label>
          <input required value={form.submitterPhone} onChange={(e) => setForm((f) => ({ ...f, submitterPhone: e.target.value }))}
            placeholder="e.g. 0712345678" className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm" />
        </div>
      </div>

      {/* Honeypot field — hidden from real visitors via CSS, not `type="hidden"`
          (some bots skip type=hidden inputs specifically, but not off-screen ones). */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="absolute -left-[9999px] w-px h-px opacity-0"
        onChange={(e) => setForm((f) => ({ ...f, website: e.target.value } as any))}
      />

      {TURNSTILE_SITE_KEY && (
        <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} data-theme="light" />
      )}

      <button type="submit" disabled={submitting} className="btn-gold w-full !py-3.5 disabled:opacity-60">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : "Submit nomination"}
      </button>
    </form>
  );
}

export default function NominatePage() {
  return (
    <div className="bg-cream min-h-screen py-14 sm:py-20">
      {TURNSTILE_SITE_KEY && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      )}
      <div className="container">
        <div className="text-center mb-10">
          <p className="eyebrow mb-3">Nominate someone</p>
          <h1 className="heading-display text-3xl sm:text-4xl">Tell us who deserves recognition</h1>
        </div>
        <Suspense fallback={null}>
          <NominateFormInner />
        </Suspense>
      </div>
      <div className="mt-14">
        <SiteFooter />
      </div>
    </div>
  );
}
