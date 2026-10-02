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
