# Deployment Guide — MathVision Stock

End-to-end setup: **Supabase → Vercel → Twilio WhatsApp → kiosk tablets →
go-live**. Budget ~45 minutes for the first three sections; the WhatsApp
production sender (optional at launch) is the only step with external
lead time.

---

## 1. Supabase (database + auth)

1. Create a project at [supabase.com](https://supabase.com) (choose the
   Singapore region — `ap-southeast-1` — for snappy kiosks).
2. Open **SQL Editor** → paste the entire contents of
   [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql)
   → **Run**. This creates the schema, stock-mutation functions, RLS
   policies, the `item-photos` storage bucket, realtime publication, and
   seeds the two locations (Level 8, Basement) + categories.
3. *(Optional)* Run [`supabase/seed_demo.sql`](../supabase/seed_demo.sql) for
   a sample catalog to click around with. Skip if you'll import your real
   stocktake CSV right away.
4. **Authentication → Sign In / Up**: turn **off** "Allow new users to sign
   up". Accounts are created from the app's Users screen (or the Supabase
   dashboard) — this keeps strangers out, since the first-ever account is
   auto-promoted to super admin.
5. **Project Settings → API**: copy these three values for later:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only secret)

> **Google sign-in (optional, later):** enable the Google provider in
> Supabase Auth and restrict to your Workspace domain. Email/password works
> out of the box and is what the Users screen provisions.

## 2. Vercel (hosting + cron)

1. Push this repository to GitHub and import it into
   [vercel.com](https://vercel.com) (framework auto-detects Next.js).
2. **Environment variables** (Project → Settings → Environment Variables) —
   see [`.env.example`](../.env.example):

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 1.5 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 1.5 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1.5 (mark as secret) |
   | `NEXT_PUBLIC_APP_URL` | your production URL, e.g. `https://stock.mathvision.sg` |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `TWILIO_ACCOUNT_SID` | section 3 (can add later) |
   | `TWILIO_AUTH_TOKEN` | section 3 (can add later) |
   | `TWILIO_WHATSAPP_FROM` | section 3 (can add later) |

3. Deploy. The daily digest cron (`vercel.json` → `0 0 * * *` UTC =
   **8:00am SGT**) is registered automatically; Vercel calls
   `/api/cron/daily-digest` with your `CRON_SECRET`.
4. **Bootstrap your super admin**: create your own account first —
   Supabase dashboard → Authentication → Users → **Add user** (email +
   password, check "Auto Confirm User") — then sign in at your Vercel URL.
   The first non-kiosk account ever created is automatically promoted to
   **super admin**. Every later account defaults to staff/whatever role the
   Users screen assigns.

## 3. Twilio WhatsApp

The app sends four kinds of WhatsApp messages: the daily 8am digest,
immediate out-of-stock alerts, approval pings, and requester notifications.
**Everything works without Twilio** — sends are skipped and logged, and the
Reorder dashboard has a "Copy as WhatsApp message" button as the manual
fallback — so you can launch first and wire this up after.

### Testing today (sandbox, 10 minutes)

1. Create an account at [twilio.com](https://twilio.com) → Console →
   **Messaging → Try it out → Send a WhatsApp message**.
2. The sandbox gives you a number (e.g. `+1 415 523 8886`) and a join code.
   Each procurement team member sends `join <code>` to that number on
   WhatsApp once.
3. Set the env vars in Vercel:
   - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — Console → Account Info
   - `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` (the sandbox number)
4. Redeploy, then in the app: **Admin → Settings** → add each recipient's
   number in E.164 format (`+65…`) → **Send test message**.

> Sandbox caveat: recipients must re-join every 72 hours. Fine for testing;
> get a production sender before relying on it.

### Production sender (when ready)

1. Twilio Console → **Messaging → Senders → WhatsApp senders** → register a
   dedicated number with your Meta Business account (Twilio walks you
   through Meta Business verification — this can take days; start early).
2. For business-initiated messages WhatsApp requires **approved templates**
   once outside a 24-hour reply window. Register templates matching the
   app's message shapes (digest, out-of-stock, approval, request update) in
   Twilio's Content Template Builder, or simply have the team message the
   sender number once ("subscribe") to open the 24h session window — the
   digest itself keeps the window warm on active days.
3. Swap `TWILIO_WHATSAPP_FROM` to your production number.

## 4. Users, PINs & kiosk tablets

### People

**Admin → Users** (super admin only):

- **Login users** (procurement/admins/staff who need the web app on their
  own devices): "Add login user" creates the account and shows a one-time
  temporary password to pass on. Role: `procurement` for the central team,
  `staff` for office admins.
- **Kiosk-only staff** (people who only ever use the wall tablet): "Add
  staff member" with just a name + PIN — no email needed. They appear on
  the kiosk picker immediately.
- Set/reset **PINs** (4–6 digits) from the same screen. Only users with a
  PIN show up on the kiosk picker.
- Add each person's WhatsApp number (`+65…`) if they should receive request
  status / approval notifications.

### Kiosk device accounts

On **Admin → Users → "Add kiosk device"**: one per store room, e.g.
`kiosk-level8@mathvision.sg` and `kiosk-basement@mathvision.sg`, each pinned
to its location. The account's only powers are reading the catalog and
calling the checkout/return RPCs (enforced by RLS, not just UI).

### Tablet setup (any ~10" Android tablet or iPad)

1. Open the app URL in the browser, sign in with the kiosk device account —
   it lands on `/kiosk` automatically and stays signed in.
2. Add to home screen, then lock it down:
   - **iPad**: Settings → Accessibility → **Guided Access** (triple-click to
     pin the app), disable auto-lock while charging.
   - **Android**: screen pinning, or a kiosk launcher (e.g. Fully Kiosk).
3. Keep it plugged in and wall-mounted by the door with a small
   **"Log what you take"** sign. The app requests a screen wake-lock, and
   returns to the name picker after 45 s idle.

## 5. Go-live checklist

1. Physical stocktake of both rooms → fill
   [`supabase/templates/catalog_template.csv`](../supabase/templates/catalog_template.csv)
   (one row per SKU: quantities per room, reorder point, par level).
2. **Admin → Inventory → Import CSV** → preview → confirm. Counts are
   trustworthy from day 1. (Re-importing the same file is safe — the import
   is idempotent on SKU.)
3. Flag the case-by-case approval items (toner, high-value) with
   **Requires approval** in Inventory, and put them in the locked cabinet.
4. Create all staff (PINs) and both kiosk device accounts; mount tablets.
5. Add procurement numbers in **Settings** and send a test WhatsApp.
6. Walk each team through the 15-second flow once: *name → PIN → tap items →
   Done*.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| WhatsApp not arriving | Admin → Settings → recipients set? Twilio env vars deployed? Sandbox joined (72h)? Check the `notifications_log` table in Supabase for the exact error. |
| Digest didn't fire | Vercel → Project → Cron Jobs → check the last run of `/api/cron/daily-digest`; confirm `CRON_SECRET` matches. |
| "This kiosk has no location assigned" | Admin → Users → edit the kiosk device → set its location. |
| Kiosk picker is empty | Only active users **with a PIN** appear — set PINs on the Users screen. |
| First user isn't super admin | Promote manually: SQL Editor → `update public.users set role = 'super_admin' where id = (select id from auth.users where email = 'you@…');` |
| Item photos not loading | The `item-photos` bucket is created by the migration; confirm it exists and is public (Storage → buckets). |
