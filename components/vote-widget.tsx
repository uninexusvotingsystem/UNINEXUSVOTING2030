"use client";

import { useState } from "react";
import Script from "next/script";
import { CheckCircle2, Loader2, AlertCircle, Smartphone, ShieldCheck } from "lucide-react";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Nominee = {
  id: string;
  name: string;
  about: string;
  media?: { id: string; media_url: string; media_type: "image" | "video" }[];
};
type Step = "choose" | "phone" | "code" | "done";

export function VoteWidget({ categoryId, nominees }: { categoryId: string; nominees: Nominee[] }) {
  const [step, setStep] = useState<Step>("choose");
  const [selected, setSelected] = useState<Nominee | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(n: Nominee) {
    setSelected(n);
    setStep("phone");
    setError(null);
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let turnstileToken: string | undefined;
      if (TURNSTILE_SITE_KEY) {
        const input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
        if (!input?.value) {
          setError("Please complete the verification check first.");
          setLoading(false);
          return;
        }
        turnstileToken = input.value;
      }

      const res = await fetch("/api/vote/otp-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, phone, turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't send a code.");
      setStep("code");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmVote(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/vote/cast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, nomineeId: selected.id, phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't submit your vote.");
      setStep("done");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <div className="card-elegant p-8 text-center max-w-md mx-auto">
        <CheckCircle2 className="size-12 text-gold mx-auto mb-4" />
        <h3 className="heading-display text-2xl mb-2">Vote confirmed</h3>
        <p className="text-ink/65 text-sm">
          Thank you for voting for <strong>{selected?.name}</strong>. Your vote for this category is locked in.
        </p>
      </div>
    );
  }

  if (step === "phone" || step === "code") {
    return (
      <div className="card-elegant p-6 sm:p-8 max-w-md mx-auto">
        <p className="text-xs uppercase tracking-wider text-gold-deep mb-1">Voting for</p>
        <h3 className="font-display text-2xl mb-6">{selected?.name}</h3>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {step === "phone" ? (
          <form onSubmit={sendCode} className="space-y-3">
            {TURNSTILE_SITE_KEY && (
              <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            )}
            <label className="text-xs font-semibold text-ink/50 uppercase tracking-wider">Your phone number</label>
            <div className="relative">
              <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink/40" />
              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0712345678"
                className="w-full rounded-lg border border-black/10 pl-10 pr-4 py-3 text-sm focus:border-gold outline-none"
              />
            </div>
            {TURNSTILE_SITE_KEY && (
              <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} data-theme="light" />
            )}
            <button type="submit" disabled={loading} className="btn-gold w-full !py-3.5 disabled:opacity-60">
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Send verification code"}
            </button>
            <p className="text-[11px] text-ink/40 text-center">
              One SMS code, one vote — this number can only vote once in this category.
            </p>
          </form>
        ) : (
          <form onSubmit={confirmVote} className="space-y-3">
            <label className="text-xs font-semibold text-ink/50 uppercase tracking-wider">
              Enter the 6-digit code sent to {phone}
            </label>
            <div className="relative">
              <ShieldCheck className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink/40" />
              <input
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full rounded-lg border border-black/10 pl-10 pr-4 py-3 text-sm tracking-[0.3em] focus:border-gold outline-none"
              />
            </div>
            <button type="submit" disabled={loading || code.length !== 6} className="btn-gold w-full !py-3.5 disabled:opacity-60">
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Confirm my vote"}
            </button>
            <button type="button" onClick={() => setStep("phone")} className="text-xs text-ink/45 hover:text-gold-deep w-full text-center">
              Wrong number? Go back
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {nominees.map((n) => (
        <NomineeCard key={n.id} nominee={n} onVote={() => choose(n)} />
      ))}
    </div>
  );
}

function NomineeCard({ nominee, onVote }: { nominee: Nominee; onVote: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const media = nominee.media || [];
  const cover = media.find((m) => m.media_type === "image");

  return (
    <div className="card-elegant p-6">
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.media_url} alt={nominee.name} className="w-full aspect-square object-cover rounded-lg mb-4" />
      )}
      <h3 className="font-display text-lg mb-1">{nominee.name}</h3>

      <div className="mb-3">
        <p className={expanded ? "text-sm text-ink/60" : "text-sm text-ink/60 truncate"}>{nominee.about}</p>
        <button onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-gold-deep mt-0.5">
          {expanded ? "Show less" : "Read more"}
        </button>
      </div>

      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {media.slice(0, 6).map((m) => (
            <div key={m.id} className="rounded-md overflow-hidden aspect-square bg-black/5">
              {m.media_type === "video" ? (
                <video src={m.media_url} className="w-full h-full object-cover" muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.media_url} alt="" className="w-full h-full object-cover" />
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={onVote} className="btn-gold w-full !py-2.5">Vote</button>
    </div>
  );
}
