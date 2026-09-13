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
