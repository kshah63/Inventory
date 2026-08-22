# Deployment Guide — MathVision Inventory

End-to-end setup: **Supabase → Vercel → Twilio WhatsApp → users →
go-live**. Budget ~45 minutes for the first three sections; the WhatsApp
production sender (optional at launch) is the only step with external
lead time.

---

## 1. Supabase (database + auth)

1. Create a project at [supabase.com](https://supabase.com) (choose the
   Singapore region — `ap-southeast-1` — so the app feels local).
2. Open **SQL Editor** → paste the entire contents of
   [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql)
   → **Run**. This creates the schema, stock-mutation functions, RLS
   policies, the `item-photos` storage bucket, realtime publication, and
   seeds the two locations (Level 8, Basement) + categories.
3. Run the remaining migration files in
   [`supabase/migrations/`](../supabase/migrations) **in numerical order**
   (`0002` → `0015`), one at a time, same way. Each is safe to run on a live
   database and only needs running once:

   | File | What it adds |
   | --- | --- |
   | `0002_zones_and_packs.sql` | Zones on the ledger, pack sizes, the pre-order/pack/collect flow |
   | `0003_roles_user_ids_departments.sql` | Department Head role, four-digit user IDs |
   | `0004_password_reset_requests.sql` | The in-app "forgot my password" queue |
   | `0005_procurement_super_admin.sql` | Gives `procurement@mathvision.com.sg` super-admin powers |
   | `0006_login_status.sql` | Shows which profiles have a login |
   | `0007_new_item_requests.sql` | Request photos/links/descriptions, zones 3–22, the `request-photos` bucket |
   | `0008_remove_kiosks.sql` | Removes kiosk devices, PIN sign-in and the sessions behind them |
   | `0009_order_limits.sql` | Enforces each item's max-per-order so one person can't take the shelf |
   | `0010_order_read_state.sql` | Unread marker on My orders when procurement moves an order on |
   | `0011_stock_matching.sql` | Suggests what we already stock as people type a request, and lets procurement resolve one from stock |
   | `0012_word_order_search.sql` | Makes that search word-order independent — "pen blue" finds the same thing as "blue pen" |
   | `0013_request_delivery.sql` | Expected delivery dates, and a Received stage procurement sees but requesters don't |
   | `0014_edit_and_collect.sql` | Change an order while it's still pending; the requester ticks their own collection |
   | `0015_restricted_and_rooms.sql` | Central-team-only items, per-item store rooms, and deleting an item that has no history |

4. *(Optional)* Run [`supabase/seed_demo.sql`](../supabase/seed_demo.sql) for
   a sample catalog to click around with. Skip if you'll import your real
   stocktake CSV right away.
5. **Authentication → Sign In / Up**: turn **off** "Allow new users to sign
   up". Accounts are created from the app's Users screen (or the Supabase
   dashboard) — this keeps strangers out, since the first-ever account is
   auto-promoted to super admin.
6. **Project Settings → API**: copy these three values for later:
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
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 1.6 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 1.6 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1.6 (mark as secret) |
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
   The first account ever created is automatically promoted to
   **super admin**. Every later account defaults to staff/whatever role the
   Users screen assigns.

## 3. Twilio WhatsApp

The app sends five kinds of WhatsApp messages: the daily 8am digest,
immediate out-of-stock alerts, approval pings, approval decisions, and
request status updates. **Everything works without Twilio** — sends are
skipped and logged, and the Reorder dashboard has a "Copy as WhatsApp
message" button as the manual fallback — so alerts can be wired up any time.

### Production sender (approved WhatsApp number)

WhatsApp only delivers **business-initiated** messages outside a 24-hour
reply window when they use a **pre-approved content template**. All of this
app's alerts are business-initiated, so with a production sender you must
register five templates once — after that, everything is automatic.

1. Set the basics in Vercel and redeploy:
   - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — Console → Account Info
   - `TWILIO_WHATSAPP_FROM=whatsapp:+65…` — your approved sender number
2. Twilio Console → **Messaging → Content Template Builder** → create these
   five templates (type **Text**, category **Utility**, language English).
   Copy each body exactly — `{{1}}`…`{{5}}` are the variables the app fills:

   | Template name | Body |
   | --- | --- |
   | `mv_stock_digest` | `📦 MathVision Stock daily update: {{1}} item(s) are running low across the store rooms: {{2}}. There are also {{3}} open stock request(s) and {{4}} checkout approval(s) waiting for review. See suggested order quantities on the reorder dashboard: {{5}}` |
   | `mv_out_of_stock` | `🔴 MathVision Stock alert: {{1}} has just run out at the {{2}} store room. Availability in the other rooms: {{3}}. Please review and reorder soon from the dashboard: {{4}}` |
   | `mv_approval_needed` | `🟡 MathVision Stock approval needed: {{1}} is requesting {{2}} unit(s) of {{3}} from the {{4}} store room. Please approve or reject this checkout in the approvals queue: {{5}}` |
   | `mv_approval_decided` | `Update from MathVision Stock: your checkout request for {{1}} × {{2}} has been reviewed by the procurement team. Decision: {{3}}. Note from the team: {{4}}` |
   | `mv_request_update` | `Update from MathVision Stock: your stock request for {{1}} × {{2}} has been updated by the procurement team. New status: {{3}}. Note from the team: {{4}}` |

   > These bodies say "MathVision Stock" because that's how they were
   > submitted to Meta and approved. The app is called **MathVision
   > Inventory** everywhere else; renaming an approved template means
   > duplicating it under a new name, resubmitting, waiting for approval and
   > swapping in the new HX… SID, so it's a deliberate follow-up rather than
   > part of the rename.

   > The bodies are deliberately wordy: Meta rejects templates whose text is
   > short relative to their variable count ("This template has too many
   > variables for its length", subCode 2388293). If a template is rejected,
   > **Duplicate** it in Twilio (new name, e.g. `mv_request_update_2`), paste
   > the body above, resubmit, and use the *new* HX… SID. Line breaks inside
   > a body are fine — just never inside a variable.

   Meta asks for **sample values** for each variable when you submit — use
   these (they mirror what the app really sends):

   | Template | {{1}} | {{2}} | {{3}} | {{4}} | {{5}} |
   | --- | --- | --- | --- | --- | --- |
   | `mv_stock_digest` | `4` | `A4 paper 80gsm (Level 8: 2 ream left); Whiteboard marker blue (Basement: 6 pcs left); Tea bags (Level 8: OUT)` | `2` | `1` | `https://your-app.vercel.app/admin/reorder` |
   | `mv_out_of_stock` | `Whiteboard marker (blue)` | `Level 8` | `14 remain in Basement` | `https://your-app.vercel.app/admin/reorder` | — |
   | `mv_approval_needed` | `Priya` | `2` | `HP 26A toner cartridge` | `Level 8` | `https://your-app.vercel.app/admin/approvals` |
   | `mv_approval_decided` | `2` | `HP 26A toner cartridge` | `approved — please collect from Level 8` | `Spare key is with the ops lead` | — |
   | `mv_request_update` | `5` | `A4 paper 80gsm (ream)` | `ordered 🛒` | `Arriving Thursday with Popular Book Co` | — |

   Other values `{{3}}` can take in `mv_approval_decided`: `not approved`.
   Other values `{{3}}` can take in `mv_request_update`: `acknowledged`,
   `ready for collection — stock has arrived ✅`, `declined`. Meta only
   needs one sample each; these are just so reviewers see realistic content.
3. Submit each for WhatsApp approval (usually minutes to a few hours). Then
   copy each template's **Content SID** (`HX…`) into Vercel env vars:

   ```
   TWILIO_CONTENT_SID_DIGEST=HX…
   TWILIO_CONTENT_SID_OUT_OF_STOCK=HX…
   TWILIO_CONTENT_SID_APPROVAL_NEEDED=HX…
   TWILIO_CONTENT_SID_APPROVAL_DECIDED=HX…
   TWILIO_CONTENT_SID_REQUEST_UPDATE=HX…
   ```
4. Redeploy, then **Admin → Settings** → add each recipient's number in
   E.164 format (`+65…`) → **Send test message** (the test uses the digest
   template, so it verifies the whole production path).

> Without the ContentSid vars the app falls back to freeform messages, which
> WhatsApp only delivers inside a 24h window after the recipient last
> messaged your sender. Freeform failures can look "sent" in Twilio and
> still not arrive — check Twilio's Monitor → Logs → Messaging (error 63016)
> if something seems missing. The app's own send log is in **Supabase →
> `notifications_log`**.

### Sandbox (only if you want a scratch environment)

Console → Messaging → Try it out → Send a WhatsApp message; each recipient
sends the `join <code>` message once; set
`TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` and leave the ContentSid vars
unset. Recipients must re-join every 72 hours.

## 4. Users

**Admin → Users** (super admin only). Everyone works from their own phone or
laptop — there are no shared tablets.

- **Add user** creates the account and shows a one-time temporary password to
  pass on. They sign in with their four-digit **User ID**, and change the
  password themselves under **Profile**.
- Roles: **Department Admin** orders for their zone; **Department Head** does
  the same and can also read Reports and the audit log. Procurement and super
  admin accounts are made in Supabase, not here.
- Add each person's WhatsApp number (`+65…`) if they should receive request
  status and approval notifications.
- If someone forgets their password they can ask for a new one from the login
  screen; the request lands on procurement's dashboard.

## 5. Go-live checklist

1. Physical stocktake of both rooms → fill
   [`supabase/templates/catalog_template.csv`](../supabase/templates/catalog_template.csv)
   (one row per SKU: quantities per room, reorder point, par level).
2. **Admin → Inventory → Import CSV** → preview → confirm. Counts are
   trustworthy from day 1. (Re-importing the same file is safe — the import
   is idempotent on SKU.)
3. Flag the case-by-case approval items (toner, high-value) with
   **Requires approval** in Inventory, and put them in the locked cabinet.
4. Add everyone on **Admin → Users** and pass on their temporary passwords.
5. Add procurement numbers in **Settings** and send a test WhatsApp.
6. Walk each team through the flow once: *Catalogue → add items → pick a zone
   → Place order*, then collect from the procurement room when it's packed.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| WhatsApp not arriving | Admin → Settings → recipients set? Twilio env vars deployed? Sandbox joined (72h)? Check the `notifications_log` table in Supabase for the exact error. |
| Digest didn't fire | Vercel → Project → Cron Jobs → check the last run of `/api/cron/daily-digest`; confirm `CRON_SECRET` matches. |
| Someone can't sign in with their ID | Admin → Users → check the ID column. A "signs in as" badge means the login is on a different number — open Edit, re-save the ID they should have, and the two are brought back together. |
| First user isn't super admin | Promote manually: SQL Editor → `update public.users set role = 'super_admin' where id = (select id from auth.users where email = 'you@…');` |
| Item photos not loading | The `item-photos` bucket is created by the migration; confirm it exists and is public (Storage → buckets). |
