"use client";

import { useState, useEffect } from "react";
import Script from "next/script";
import { CheckCircle2, Loader2, AlertCircle, Smartphone, ShieldCheck } from "lucide-react";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type Nominee = {
  id: string;
  name: string;
  about: string;
  vote_count?: number;
  media?: { id: string; media_url: string; media_type: "image" | "video" }[];
};
const VOTE_LIMIT = 20;
type Step = "choose" | "phone" | "code" | "limit";

// Vote counts render ONLY when resultsPublished is true — this comes
// straight from the category's results_published column, which only an
// admin can flip (Admin → Categories → "Results: Public"). Nothing in this
// component can show a tally the admin hasn't explicitly chosen to publish.
export function VoteWidget({
  categoryId,
  nominees,
  resultsPublished = false,
}: {
  categoryId: string;
  nominees: Nominee[];
  resultsPublished?: boolean;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [selected, setSelected] = useState<Nominee | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Votes already cast by this phone in this category, and whether a verified
  // phone+code pair is currently held so a 2nd-20th vote can skip straight
  // past the phone/OTP steps instead of asking the voter to re-verify (and
  // without sending another SMS) for every single vote.
  const [votesUsed, setVotesUsed] = useState(0);
  const [verified, setVerified] = useState(false);
  const [lastVotedName, setLastVotedName] = useState<string | null>(null);
  // Seconds remaining before "Resend code" can be tapped again — a short
  // client-side cooldown so an impatient voter can't spam the button; the
  // real protection against abuse is still the server-side rate limiter
  // (3 OTP requests per phone per 15 min), this is just a friendlier UX
  // nudge on top of it.
  const [resendCooldown, setResendCooldown] = useState(0);

  function choose(n: Nominee) {
    setSelected(n);
    setError(null);
    setLastVotedName(null);
    // Already verified from an earlier vote this session — skip straight to
    // casting instead of re-asking for phone + OTP.
    if (verified && phone && code) {
      void castVote(n);
    } else {
      setStep("phone");
    }
  }

  // Ticks the resend cooldown down to zero once a resend has been triggered.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function sendCode(e: React.FormEvent, resend = false) {
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
        body: JSON.stringify({ categoryId, phone, turnstileToken, forceResend: resend }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't send a code.");
      setStep("code");
      if (resend) {
        setCode("");
        setResendCooldown(30);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    if (resendCooldown > 0 || loading) return;
    await sendCode({ preventDefault: () => {} } as React.FormEvent, true);
  }

  async function castVote(nominee: Nominee) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/vote/cast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, nomineeId: nominee.id, phone, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        // The code this voter was relying on no longer works (expired, or
        // never matched) — drop back to asking for a fresh one rather than
        // showing a dead end. A true "limit reached" response is handled
        // below via res.ok, since the cap can also be hit via the
        // otp-request pre-check before a vote is ever attempted.
        const expiredOrInvalid = /expired|request a new|incorrect code/i.test(data.error || "");
        if (expiredOrInvalid) {
          setVerified(false);
          setCode("");
          setStep("phone");
        }
        throw new Error(data.error || "Couldn't submit your vote.");
      }

      setVerified(true);
      setVotesUsed(data.votesUsed ?? votesUsed + 1);
      setLastVotedName(nominee.name);

      if ((data.votesRemaining ?? 0) <= 0) {
        setStep("limit");
      } else {
        setStep("choose");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmVote(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    await castVote(selected);
  }

  if (step === "limit") {
    return (
      <div className="card-elegant p-8 text-center max-w-md mx-auto">
        <CheckCircle2 className="size-12 text-gold mx-auto mb-4" />
        <h3 className="heading-display text-2xl mb-2">All votes used</h3>
        <p className="text-ink/65 text-sm">
          {lastVotedName && <>Thank you for your vote for <strong>{lastVotedName}</strong>. </>}
          This phone number has now used all {VOTE_LIMIT} votes allowed in this category — your votes are locked in.
          You're welcome to vote in a different category.
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
              One SMS code covers up to {VOTE_LIMIT} votes — this number can cast up to {VOTE_LIMIT} total votes in this category.
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
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setStep("phone")} className="text-xs text-ink/45 hover:text-gold-deep text-center">
                Wrong number? Go back
              </button>
              <button
                type="button"
                onClick={resendCode}
                disabled={resendCooldown > 0 || loading}
                className="text-xs font-semibold text-gold-deep hover:text-gold disabled:text-ink/30 disabled:cursor-not-allowed text-center"
              >
                {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Didn't get it? Resend code"}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div>
      {votesUsed > 0 && (
        <div className="mb-5 max-w-md mx-auto flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>
            {lastVotedName && <>Vote recorded for <strong>{lastVotedName}</strong>. </>}
            You have {VOTE_LIMIT - votesUsed} of {VOTE_LIMIT} votes left in this category.
          </span>
        </div>
      )}
      {error && (
        <div className="mb-5 max-w-md mx-auto flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Only reordered into a leaderboard once the admin has published
            results for this category — otherwise nominees stay in their
            normal sort_order, same as before. */}
        {(resultsPublished ? [...nominees].sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0)) : nominees).map((n, i) => (
          <NomineeCard
            key={n.id}
            nominee={n}
            onVote={() => choose(n)}
            loading={loading}
            resultsPublished={resultsPublished}
            rank={resultsPublished ? i + 1 : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function NomineeCard({
  nominee,
  onVote,
  loading,
  resultsPublished,
  rank,
}: {
  nominee: Nominee;
  onVote: () => void;
  loading?: boolean;
  resultsPublished?: boolean;
  rank?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const media = nominee.media || [];
  const cover = media.find((m) => m.media_type === "image");

  return (
    // minWidth: 0 overrides the grid item's default min-width:auto — without
    // it, a long "about" description can force this card (and everything
    // inside it, including the photo) wider than its grid column, which is
    // very likely the real cause of cards appearing cut off at the screen
    // edge rather than properly contained like Onsarigo Joshua's. This is a
    // well-documented CSS Grid behavior, not specific to this photo issue.
    <div className="card-elegant p-6" style={{ minWidth: 0 }}>
      {cover && (
        // Sizing is forced with INLINE styles, not Tailwind classes — a
        // class only ends up in the final CSS if detected at build time and
        // can be served from a stale cached stylesheet. A FIXED PIXEL HEIGHT
        // is used here instead of the CSS `aspect-ratio` property: evidence
        // pointed to some voters opening this link inside an app's built-in
        // browser (Facebook/TikTok's in-app viewer — no address bar visible
        // in their screenshot), which can run an older WebView engine with
        // incomplete support for aspect-ratio even though real Chrome has
        // supported it since 2021. A fixed pixel height has no such
        // dependency — it's the most basic, universally supported sizing
        // CSS there is, nothing left for an older engine to fail on.
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "300px",
            overflow: "hidden",
            borderRadius: "0.5rem",
            marginBottom: "1rem",
            backgroundColor: "rgba(0,0,0,0.05)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cover.media_url}
            alt={nominee.name}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              // Biased toward the top rather than dead-center: a center crop
              // on a tall portrait photo cuts equally off the top and
              // bottom, which is exactly what was cutting faces off (most
              // portrait/headshot photos have the face in the upper half,
              // not the vertical middle).
              objectPosition: "center top",
              display: "block",
            }}
          />
          {resultsPublished && rank === 1 && (
            <span
              style={{
                position: "absolute",
                top: "0.5rem",
                left: "0.5rem",
                background: "#C9A227",
                color: "#0A0A0B",
                fontSize: "11px",
                fontWeight: 600,
                padding: "0.25rem 0.5rem",
                borderRadius: "9999px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }}
            >
              #1
            </span>
          )}
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="font-display text-lg">{nominee.name}</h3>
        {resultsPublished && (
          <span className="shrink-0 text-xs font-semibold text-gold-deep bg-gold/10 px-2 py-1 rounded-full whitespace-nowrap">
            {nominee.vote_count ?? 0} {nominee.vote_count === 1 ? "vote" : "votes"}
          </span>
        )}
      </div>

      <div className="mb-3">
        <p
          className={expanded ? "text-sm text-ink/60" : "text-sm text-ink/60 truncate"}
          style={{ overflowWrap: "break-word", wordBreak: "break-word" }}
        >
          {nominee.about}
        </p>
        <button onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-gold-deep mt-0.5">
          {expanded ? "Show less" : "Read more"}
        </button>
      </div>

      {media.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.375rem", marginBottom: "1rem" }}>
          {media.slice(0, 6).map((m) => (
            <div
              key={m.id}
              style={{
                position: "relative",
                width: "100%",
                height: "110px",
                overflow: "hidden",
                borderRadius: "0.375rem",
                backgroundColor: "rgba(0,0,0,0.05)",
              }}
            >
              {m.media_type === "video" ? (
                <video
                  src={m.media_url}
                  muted
                  playsInline
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.media_url}
                  alt=""
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={onVote} disabled={loading} className="btn-gold w-full !py-2.5 disabled:opacity-60">
        {loading ? <Loader2 className="size-4 animate-spin mx-auto" /> : "Vote"}
      </button>
    </div>
  );
}
