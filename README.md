# UniNexus Connect Gala Awards — standalone nominations + voting system

A fully separate system from UniNexus Connect: its own domain, its own Supabase
project, its own admin panel. Built so a public, high-traffic voting event
can never affect the main site's members, tickets, or payments.

## How it works

1. **Nominations phase** — share a category's nomination link (Admin →
   Categories → "Copy nominate link"). Anyone can submit a nominee: name,
   category, a short description, and optionally 3-6 photos and/or one short
   (~20s) video. Every submission lands as **pending** — nothing is ever
   public until an admin approves it.
2. **Moderation** — Admin → Nominees. Filter by category/status, search by
   name, and bulk approve/reject/delete. Trim each category down to your
   target shortlist (e.g. ~10 nominees) here.
3. **Voting phase** — once a category's shortlist is ready, open voting for
   it (Admin → Categories → "Voting: Open"). Share the vote link. Voters
   verify with a phone OTP (via Africa's Talking SMS) before their vote
   counts — one phone number, one vote, per category, enforced by a database
   constraint (not just app logic, so it can't be raced or bypassed).
4. **Results** — toggle "Results: Public" on a category once you want the
   live tally visible.

## First-time setup

### 1. Supabase
- Create a **new** Supabase project (don't reuse the main site's).
- Run `supabase/migrations/0001_init.sql` in the SQL Editor.
- Create your admin login: Authentication → Users → Add user (email +
  password). Copy the new user's UUID.
- In the SQL Editor, run:
  ```sql
  insert into public.admin_users (user_id) values ('paste-the-uuid-here');
  ```
  This is the only way to become an admin — there's no self-registration.

### 2. Vercel
- New project, import this repo.
- Add all the environment variables from `.env.example`.
- Deploy, then connect your domain (Settings → Domains).
- Update `NEXT_PUBLIC_SITE_URL` to match your real domain once connected,
  and redeploy.

### 3. Africa's Talking
- Use a **live** account (not `sandbox`) so OTP codes actually reach real
  phone numbers — see `AFRICASTALKING_USERNAME`.
- Make sure the account has real SMS credit loaded.

### 4. Upstash Redis
- Free tier is enough to start. Without this configured, rate limiting on
  nominations/OTP/voting silently does nothing — set it up before going
  live publicly.

### 5. Cloudflare Turnstile (CAPTCHA)
- Go to the [Cloudflare dashboard](https://dash.cloudflare.com) → Turnstile →
  Add a site, using your domain.
- Copy the **Site Key** into `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the
  **Secret Key** into `TURNSTILE_SECRET_KEY`.
- The nomination form works without these set (just with no bot protection) —
  but set them before a public launch, since an open, unlimited-submission
  form is a realistic bot target.

### 6. Admin nomination notifications (optional)
- Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (must use a domain verified in
  Resend), and `ADMIN_NOTIFICATION_EMAIL` (where you want to be notified).
- Leave `ADMIN_NOTIFICATION_EMAIL` blank if you'd rather just check the admin
  panel manually — notifications are skipped quietly if it's not set.

### 7. Scheduled voting close (optional)
- Set `CRON_SECRET` to any long random string in Vercel — Vercel
  automatically sends it as a Bearer token when it calls your cron route, no
  extra setup needed on your end.
- In Admin → Categories, each category has an optional "Auto-close voting
  at" field — set a deadline and voting closes itself, no manual toggling
  needed.
- **Note on frequency:** `vercel.json` currently checks once a day
  (`0 0 * * *`), which is compatible with Vercel's free Hobby plan (frequent
  cron schedules like hourly or every-15-minutes require Vercel Pro). If
  you're on Pro and want tighter precision on deadlines, change the schedule
  in `vercel.json` to `0 * * * *` (hourly) or `*/15 * * * *` (every 15 min).

## Managing the scrolling banner

Admin → Site Settings. The gold banner scrolling across the top of every
public page is edited there and updates for visitors within seconds — no
redeploy needed. Seeded with the launch message by migration `0003`.

## Security notes

- Every table has Row-Level Security; public submissions go through a
  server API route (not a direct client insert), so file uploads are
  validated (type + size) before anything touches storage.
- The one-vote-per-phone-per-category rule is a **database unique
  constraint**, the same proven design used on the main UniNexus Connect
  gala voting — this is what actually makes it race-proof under concurrent
  voters, not just application logic.
- A hidden honeypot field on the nomination form silently discards
  obvious bot submissions without telling the bot why.
- Cloudflare Turnstile blocks scripted/bot submissions before they ever
  reach the server, on top of the honeypot and rate limiting.
- CSP, HSTS, and clickjacking protection headers are already configured in
  `next.config.mjs`.
- Cloudflare Turnstile guards BOTH the nomination form and the OTP request
  step. The OTP one matters most: every code sent costs you real SMS money,
  so without it a script could drain your Africa's Talking balance just by
  requesting codes in a loop.
- Layered rate limiting, all per-IP: a global ceiling across every API route
  (120/min), a burst limit on voting and OTP requests (5/min), and slower
  sustained limits on top (40 votes/hr, 3 OTPs per phone per 15 min). The
  burst limits are what actually catch scripted mass-voting, while the
  sustained limits stay generous enough for a whole campus sharing one IP.
- **All of the above depends on `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` being set.** Without them every limiter silently
  enforces nothing — set them before voting opens.
- A diagnostics endpoint at `/api/diagnostics?key=YOUR_CRON_SECRET` checks
  env vars, database access, table inserts, and storage in one page, so a
  failure can be pinpointed instead of guessed at.

## A note on true DDoS protection

Rate limiting stops abuse at the application layer — one IP hammering your
endpoints. A genuine distributed attack (thousands of IPs at once) has to be
absorbed *before* it reaches your app, which is infrastructure, not code:
Vercel's platform absorbs a baseline automatically, and **Vercel Pro adds the
configurable Firewall / Attack Challenge Mode** you can switch on during
voting hours. If a high-stakes vote is happening, that upgrade is the single
most effective protection available — worth having ready before the night
itself.
