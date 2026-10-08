# SlotWise – multi-tenant appointment booking SaaS

Barbers, salons, clinics, photographers and consultants each get their own branded public booking page
(`/booking/:slug`) and a private dashboard (calendar, bookings, CRM, services, hours, billing).

**Live demo:** _add your Vercel URL here_

## Tech stack
React 18 + Vite + React Router · Node.js + Express 5 (Vercel serverless) · Supabase (PostgreSQL, Auth, RLS) ·
Stripe subscriptions (or built-in simulation) · Resend email (or console mock) · Vitest · Luxon (timezones) · Zod (validation)

## Architecture
```
Browser ─ React (Vercel) ──┬─ Supabase Auth (sign-up / login, JWT)
                           └─ /api/* ─ Express (Vercel function)
                                         ├─ tenant routes   -> Postgres AS THE USER (RLS enforced)
                                         ├─ public routes   -> service role, minimum fields, rate limited
                                         ├─ /billing/webhook (signature verified, replay-protected)
                                         └─ /cron/reminders (CRON_SECRET)
Postgres: tables + RLS + exclusion constraint (no double booking) + RPCs
```
Key decisions
* **Tenant is never chosen by the browser.** The API derives `business_id` from the verified JWT -> `business_members`.
* **RLS is the second line of defence.** Tenant routes run queries with the user's own JWT, so even a buggy endpoint cannot leak rows.
  Composite foreign keys `(id, business_id)` also stop a row pointing at another tenant's service/provider/client.
* **Double-booking:** the API re-validates the slot, and a PostgreSQL `EXCLUDE USING gist` constraint on
  `(provider_id, tstzrange(starts_at, ends_at,'[)'))` for active bookings is the final guarantee. Back-to-back bookings are allowed.
* **Availability engine:** `server/lib/slots.js` (pure, unit-tested) + `server/services/availability.js` (data loading).
  Uses business timezone, provider hours (override business hours), blocked periods, active bookings, service duration,
  30-min step, 60-min minimum notice, DST-safe epoch math. One DB round-trip per table for a 21-day range (no N+1).
* **Reminders:** `claim_reminders()` atomically claims due rows (`FOR UPDATE SKIP LOCKED`); `unique(booking_id, channel, kind)`;
  max 3 attempts; each attempt logged in `notification_logs`.
* **Billing:** server-side `hasAccess()` (active; trialing until trial end; past_due = 3-day grace; cancelled/incomplete = denied).
  Webhook: raw-body signature check + `webhook_events` table for replay protection.

## Local setup
1. Install **Node.js 20+** and Git.
2. `npm install`
3. Create a Supabase project, then in **SQL Editor** run `supabase/migrations/001_schema.sql`.
4. Supabase -> *Authentication -> Providers -> Email*: for local testing turn **off** "Confirm email".
5. `cp .env.example .env` and fill `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (Supabase -> Project Settings -> API). **The service-role key must never get a `VITE_` prefix.**
6. `npm run dev` -> web http://localhost:5173, API http://localhost:3001

## Using it
1. Sign up -> set up business (name, address, timezone). A default provider, Mon-Fri 9-5 hours and a 14-day trial are created.
2. Services -> add a service. Open `/booking/<your-slug>` and book.
3. Dashboard -> Calendar / Bookings (confirm, cancel, reschedule, complete, no-show) / Clients (CRM).
4. Billing -> demo buttons flip subscription state so you can see gating.

## Tests
```
npm test                       # unit tests (slots, overlap, DST, subscription gate, normalization) – no setup needed
```
`tests/integration.test.js` runs automatically when the three Supabase env vars are present. It creates two throwaway tenants and verifies:
RLS isolation, public-field exposure, 4 simultaneous bookings -> exactly 1 success, cancel frees slot, CRM scoping,
reminder idempotency, invalid webhook signature rejected, subscription gating. It deletes its test users afterwards.

Manual RLS check: sign in as user A in the browser console, `supabase.from('services').select('*').eq('business_id','<B id>')` -> `[]`.

## Reminders job
* Local: `npm run job:reminders` (or `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3001/api/cron/reminders`)
* Vercel: `vercel.json` schedules `/api/cron/reminders` **daily** (Hobby plan limit). Use Pro for hourly (`0 * * * *`) or an external scheduler.
* Emails are logged to the console until `EMAIL_PROVIDER_API_KEY` (Resend) is set.

## Billing
* `BILLING_MODE=simulate` (default): Subscribe activates instantly; demo buttons change state.
* `BILLING_MODE=stripe`: set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` (monthly price), `STRIPE_WEBHOOK_SECRET`.
  Local: `stripe listen --forward-to localhost:3001/api/billing/webhook`. Production endpoint: `https://<app>/api/billing/webhook`
  with events `customer.subscription.*` and `invoice.payment_failed`.

## Deploy (Vercel + Supabase)
1. Push to GitHub. Vercel -> *Add New Project* -> import repo (framework: Vite, defaults are fine).
2. Add every variable from `.env.example` in Vercel -> Settings -> Environment Variables; set `APP_URL` to your Vercel URL.
3. Deploy. In Supabase -> Authentication -> URL Configuration add your Vercel URL as Site URL.

## Scaling notes (hundreds -> thousands of tenants)
Indexes exist on `(business_id, starts_at)`, client lookups and reminder due-time. Use Supabase's pooled connection string / Supavisor
for serverless connections. Move reminders to hourly+ cron or a queue (e.g. Supabase Queues/pgmq) with batch size limits and provider rate limits.
Cache public business/service JSON at the edge (short TTL). Replace the in-memory rate limiter with a shared store (Upstash/Redis).
Partition or archive old bookings if tables grow very large.

## Known limitations
* One business per user; roles are owner/admin only (no invite flow yet).
* One working interval per day (no split shifts); no provider-to-service capability mapping.
* Rate limiting is per serverless instance. SMS is not implemented (email only).
* Public booking requires an email; bookings are auto-confirmed (the `pending` state exists for an approval workflow).
* Business-level timezone only. Staff reschedules respect the 60-minute minimum notice.

## Future improvements
Customer self-service reschedule links, waitlist, holidays/recurring exceptions, iCal export, analytics, AI scheduling assistant using the same availability API.
