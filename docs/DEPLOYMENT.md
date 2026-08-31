# Deployment Guide — MathVision Inventory

End-to-end setup: **Supabase → Vercel → users → go-live**. Budget about
half an hour.

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
   (`0002` → `0021`), one at a time, same way. Each is safe to run on a live
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
   | `0010_order_read_state.sql` | Unread marker on Track my orders when procurement moves an order on |
   | `0011_stock_matching.sql` | Suggests what we already stock as people type a request, and lets procurement resolve one from stock |
   | `0012_word_order_search.sql` | Makes that search word-order independent — "pen blue" finds the same thing as "blue pen" |
   | `0013_request_delivery.sql` | Expected delivery dates, and a Received stage procurement sees but requesters don't |
   | `0014_edit_and_collect.sql` | Change an order while it's still pending; the requester ticks their own collection |
   | `0015_restricted_and_rooms.sql` | Central-team-only items, per-item store rooms, and deleting an item that has no history |
   | `0016_remove_notifications.sql` | Clears what the removed WhatsApp feature had stored |
   | `0017_collect_request.sql` | Lets the requester tick a bought-in request as collected, the same as an order |
   | `0018_remove_approvals.sql` | Removes the approval flow, which nothing had enforced since 0008 |
   | `0019_keep_about.sql` | Replaces reorder point and par level with one number per item |
   | `0020_reimbursement_claims.sql` | Claims for things people bought themselves, with a private receipts bucket |
   | `0021_suppliers.sql` | The supplier register — groups, coded sub-groups, 128 seeded suppliers, 205 QuickBooks aliases |

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

## 2. Vercel (hosting)

1. Push this repository to GitHub and import it into
   [vercel.com](https://vercel.com) (framework auto-detects Next.js).
2. **Environment variables** (Project → Settings → Environment Variables) —
   see [`.env.example`](../.env.example):

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 1.6 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 1.6 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1.6 (mark as secret) |

3. Deploy.
4. **Bootstrap your super admin**: create your own account first —
   Supabase dashboard → Authentication → Users → **Add user** (email +
   password, check "Auto Confirm User") — then sign in at your Vercel URL.
   The first account ever created is automatically promoted to
   **super admin**. Every later account defaults to staff/whatever role the
   Users screen assigns.

## 3. Users

**Admin → Users** (super admin only). Everyone works from their own phone or
laptop — there are no shared tablets.

- **Add user** creates the account and shows a one-time temporary password to
  pass on. They sign in with their four-digit **User ID**, and change the
  password themselves under **Profile**.
- Roles: **Department Admin** orders for their zone; **Department Head** does
  the same and can also read Reports and the audit log. Procurement and super
  admin accounts are made in Supabase, not here.
- A phone number is optional. Nothing is sent to it — it is contact
  details only, kept for the larger app this will eventually roll into.
- If someone forgets their password they can ask for a new one from the login
  screen; the request lands on procurement's dashboard.

## 4. Go-live checklist

1. Physical stocktake of both rooms → fill
   [`supabase/templates/catalog_template.csv`](../supabase/templates/catalog_template.csv)
   (one row per SKU: quantities per room, and roughly how many to keep).
2. **Admin → Inventory → Import CSV** → preview → confirm. Counts are
   trustworthy from day 1. (Re-importing the same file is safe — the import
   is idempotent on SKU.)
3. Mark the central-team-only items (heavy cleaning supplies and the like)
   with **Central team only** in Inventory, so they stay off everyone else's
   catalogue.
4. Add everyone on **Admin → Users** and pass on their temporary passwords.
5. Walk each team through the flow once: *Catalogue → add items → pick a zone
   → Place order*, then collect from the procurement room when it's packed.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Someone can't sign in with their ID | Admin → Users → check the ID column. A "signs in as" badge means the login is on a different number — open Edit, re-save the ID they should have, and the two are brought back together. |
| First user isn't super admin | Promote manually: SQL Editor → `update public.users set role = 'super_admin' where id = (select id from auth.users where email = 'you@…');` |
| Item photos not loading | The `item-photos` bucket is created by the migration; confirm it exists and is public (Storage → buckets). |
