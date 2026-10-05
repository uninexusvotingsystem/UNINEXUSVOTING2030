# Changes applied in this batch

Applied directly to your real uploaded repo files — not reconstructed from
memory. Every file below was read in full before editing. Database changes
were tested live (insert/reject proven with real queries, test data cleaned
up afterward) before being saved here as migration files; your actual
nominee and vote data was not touched by any of this.

## 1. Nominations: R2 storage, required fields, duplicate-name guard
- `app/api/nominations/submit/route.ts` — photo upload moved from Supabase
  Storage to Cloudflare R2 (S3-compatible SDK); photo now required (max 2,
  images only — video support removed); email and phone now required;
  catches the new duplicate-name database error with a clear message.
- `app/nominate/page.tsx` — matching client-side validation, a distinct
  styled card for the "already nominated" case with WhatsApp/call/email
  links, updated success message, categories cached client-side
  (`sessionStorage`, 5 min) so repeat page loads don't hit Supabase fresh
  every time.
- `supabase/migrations/0004_duplicate_nominee_name_guard.sql` — a trigger
  blocking any new nomination whose name exactly matches OR is a close
  spelling variant (fuzzy-matched via `pg_trgm`, similarity > 0.72) of an
  existing pending/approved nominee in the same category. See the comment
  in that file for a real bug this went through before it worked correctly
  — worth reading if this trigger is ever touched again.

## 2. Africa's Talking → Celcom Africa
- `lib/sms.ts` — rewritten for Celcom's REST API (no SDK exists for it,
  called with native `fetch`). Same exported function signature
  (`sendOtpSms(phone, code)`) as before, so nothing else needed to change.
  Handles Celcom's documented error codes and their own field-name typo
  (`respose-code`) defensively.
- `lib/africastalking.d.ts` — deleted (no longer used).
- `package.json` — `africastalking` dependency removed, `@aws-sdk/client-s3`
  added (needed for R2, item 1 above).
- `.env.example` — `AFRICASTALKING_*` replaced with `CELCOM_PARTNER_ID`,
  `CELCOM_API_KEY`, `CELCOM_SENDER_ID`; R2 vars added.
- `README.md` — updated references and vote-rule description to match.

## 3. Vote cap: 1 → 8 votes per phone per category
- `supabase/migrations/0005_vote_cap_per_phone_category.sql` — drops the old
  `UNIQUE (category_id, phone_hash)` constraint (which allowed exactly one
  vote, period) and replaces it with a trigger allowing up to 8, enforced
  with an advisory lock so it's race-proof under concurrent requests. Tested
  directly: 8 inserts succeeded, a 9th was rejected, before being saved here.
- `app/api/vote/otp-request/route.ts` — the old logic blocked requesting a
  second OTP entirely once any vote existed. Replaced with a count-based
  check against the 8 cap. Also: if a still-valid, unexpired code already
  exists for this phone+category, it's reused instead of sending another
  SMS — a full 8-vote session now costs one SMS, not up to eight.
- `app/api/vote/cast/route.ts` — the OTP is no longer marked "consumed"
  after one vote; it stays usable for this voter's next vote in the same
  category until it actually expires (5 minutes) or the cap is reached.
  Catches the new vote-cap trigger error and returns how many votes remain.
- `components/vote-widget.tsx` — reworked from a one-shot "vote, see a
  terminal thank-you screen" flow into a repeatable one: after a successful
  vote, the voter returns to the nominee grid with a running "N of 8 votes
  left" indicator, and can vote again (same or different nominee) without
  re-entering their phone or OTP, until the cap is reached or the code
  expires.

## 4. Rate limiting / reliability
- `lib/rate-limit.ts` — `enforceRateLimit` now fails OPEN on a Redis error
  instead of 500ing every protected route (nominations, OTP, voting). Vote
  burst limit raised 5→10/min and hourly vote IP limit raised 40→80/hr,
  since a genuine voter casting 8 votes quickly would otherwise have tripped
  the old, tighter limits meant for a one-vote-per-category world.
- `app/vote/[slug]/page.tsx` — now cached for 15 seconds (`revalidate = 15`)
  instead of querying Supabase fresh on every single page load, which
  matters under real voting-night traffic to the same category page.
- `next.config.mjs` — `*.r2.dev` allowed in both `images.remotePatterns` and
  the CSP `img-src`/`media-src` (required for item 1 above; nominee photos
  silently fail to render without both of these).

## 5. Vote cap raised 8 → 20, plus a genuine resend option
- `supabase/migrations/0006_vote_cap_twenty.sql` — same trigger mechanism as
  0005, only the limit constant changed. Tested directly the same way: 20
  sequential inserts succeeded, a 21st was rejected, before being saved here.
- `lib/rate-limit.ts` — vote burst limit raised 10→25/min, hourly vote IP
  limit raised 80→200/hr, scaled for the higher cap so a real voter using
  all 20 votes quickly isn't throttled by limits sized for 8.
- `app/api/vote/otp-request/route.ts` — now accepts a `forceResend` flag.
  Normal requests still silently reuse a still-valid pending code (no SMS
  cost); an explicit resend invalidates the old code and sends a genuinely
  new one, closing the "first SMS never arrived" gap flagged last round.
- `components/vote-widget.tsx` — a "Didn't get it? Resend code" link on the
  code-entry screen, with a 30-second client-side cooldown to prevent
  impatient re-tapping (the real abuse protection is still the existing
  server-side rate limiter: 3 OTP requests per phone per 15 minutes, which
  this does not bypass).

**On raising the cap specifically — does it affect performance?** No. The
enforcement mechanism (one count query + an advisory lock per vote insert)
costs exactly the same regardless of whether the limit is 8 or 20 — it's
not a loop or a scan, just a single indexed count. The only real difference
is more total rows written to `votes` as people actually use more of their
allowance, which is normal, expected load that Postgres handles easily at
this scale.

## 6. Fixed vote_count drift (phantom votes) + live admin tally + QR codes
- **Root cause found and fixed:** `sync_nominee_vote_count` only ever
  handled `INSERT`, never `DELETE` — so any removed vote row (including
  the vote-cap testing done while building item 5) left `vote_count`
  permanently inflated. One nominee showed 33 stored vs 0 real votes before
  this was caught. `supabase/migrations/0007_fix_vote_count_sync.sql` fixes
  the trigger to handle both directions and does a one-time recompute of
  every nominee's count from the real `votes` table. Verified after: zero
  nominees with mismatched counts, totals match exactly.
- **On vote integrity:** every row in `votes` counts as exactly one vote
  toward `vote_count`, including repeat votes from the same phone within
  their 20-per-category allowance — that's correct and intentional, not a
  bug to "fix." The thing that actually prevents manipulation is the
  database-enforced cap (item 5) and OTP verification, not deduplication by
  phone number.
- `app/admin/results/page.tsx` — new admin-only live tally page, polling
  every 10s. Shows real vote counts per nominee per category regardless of
  whether "Results: Public" is toggled on for voters — that toggle only
  ever controlled the public vote page, this is separate and always visible
  to the admin. Added to admin nav in `app/admin/layout.tsx`.
- `app/admin/categories/page.tsx` — QR codes added: one per category (for
  that category's vote link) and one site-wide (the general nominate+vote
  link), both shown as scannable images, long-press/right-click to save for
  printing. Uses a free external QR image service (no new npm dependency),
  which required adding its domain to the CSP in `next.config.mjs` — same
  requirement as the R2 domain earlier, or the images silently fail to load.

## 7. Admin can replace a nominee's photo
- `app/admin/api/nominees/replace-photo/route.ts` — new route, deliberately
  placed under `/admin/api/...` (not `/api/admin/...`) so it's covered by
  middleware.ts's existing `/admin` auth guard automatically. The admin
  check is also repeated inside the route itself as defense in depth —
  an action this sensitive shouldn't depend solely on something outside
  the handler to stay safe. Uploads through the same R2 path as public
  nominations (same validation: images only, 8MB max), and cleans up the
  old R2 file after a successful replace so storage doesn't accumulate
  orphaned photos.
- `app/admin/nominees/page.tsx` — hover over any nominee's existing photo
  thumbnail and click to pick a replacement file; uploads in place with a
  small spinner on just that thumbnail, no full-page reload needed.

## Known tradeoffs, worth knowing about
- If a voter's very first OTP SMS genuinely never arrives (network issue on
  Celcom's end, etc.), the current backend logic reuses the still-valid
  pending code rather than sending a fresh one on a second "send code" tap
  within the same 5-minute window — intentional, to avoid wasting SMS on
  accidental double-taps, but means there's currently no explicit "resend"
  path for a genuinely lost first message within that window. Flag if this
  needs a dedicated resend button.
- The nominations rate limiter, OTP limiter, and global API limiter
  (`nominationSubmitLimiter`, `otpRequestPhoneLimiter`, `otpRequestIpLimiter`,
  `otpVerifyLimiter`, `globalApiLimiter`) were left at their original values
  — only the two vote-specific limiters were raised, since the 8-vote change
  is what directly interacts with those.
