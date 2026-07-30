# User acceptance test script — MathVision Inventory

A complete walkthrough of every feature, in the order that makes each test
set up the next. Time needed: ~45 minutes. The database-level rules (stock
math, race conditions, RLS, PIN lockout) are already covered by the
automated suite in `supabase/tests/` — this script is the human/browser
layer on top.

## Setup (once)

- Migration + (optionally) `seed_demo.sql` run in Supabase.
- You are signed in as the super admin.
- Create the test cast on **Admin → Users**:
  - a **login user** "Priya Test", role *staff*, with a WhatsApp-able phone
    number and PIN `4821` (note the temp password it shows you),
  - a **kiosk device** `kiosk-level8@…` pinned to Level 8.
- **Admin → Settings**: add your own number as an alert recipient →
  **Send test message** → it should arrive on WhatsApp (uses the digest
  template when ContentSids are configured).
- Open the kiosk: a second browser window (or the real tablet), signed in as
  the kiosk device account. It should land on `/kiosk` showing the name
  picker with a Level 8 badge.

## 1. Kiosk — the 15-second checkout

| # | Do | Expect |
| --- | --- | --- |
| 1.1 | Tap **Priya Test** → enter `0000` (wrong) five times | Error each time; 5th says locked, try again in 60 s |
| 1.2 | Wait 60 s → correct PIN `4821` | Catalog for Level 8 appears with live counts |
| 1.3 | Time this: name → PIN → tap *Ballpoint pen (blue)* → **Take** → **Done** | Confirmation "You took: 1 × …", auto-returns to picker in 6 s. Under 15 s total |
| 1.4 | Admin window → **Audit log** | Checkout row: Priya Test, −1, Level 8, timestamp in SGT |
| 1.5 | PIN in again, touch nothing for 45 s | Kiosk returns to the name picker by itself |
| 1.6 | Add 2 items to basket, remove one via the basket bar, **Done** | Only the remaining item is checked out |
| 1.7 | Open *Whiteboard marker (blue)* (cap 4), try stepping to 5 | Stepper stops at 4; "Max 4 per checkout" hint shown |
| 1.8 | Admin: **Adjust** an item to qty 1 (note required). Kiosk: take 1 while, in a second admin tab, you **Adjust** it to 0 first | Kiosk shows "Someone just took the last ones — 0 left"; basket auto-adjusts; stock never goes negative |
| 1.9 | Open an item with 0 stock | Button reads **Request restock** → submits a request |
| 1.10 | Open *HP 26A toner* (approval-flagged) | Button reads **Request approval**; after tapping, WhatsApp approval alert arrives |
| 1.11 | **Return items** → the pen you took → qty 1 | Stock back up; audit shows a `return` row |
| 1.12 | Try returning an item you never took | Friendly rejection ("No recent checkout…") |
| 1.13 | **Can't find it?** → "Laminating pouches A4", qty 2 | Request appears in admin queue with a NEW ITEM badge |
| 1.14 | Leave kiosk on catalog; in admin, **Receive** 10 of a visible item into Level 8 | Kiosk count updates live, no refresh |

## 2. Staff on their own device

Sign in as Priya Test (temp password) in a private window.

| # | Do | Expect |
| --- | --- | --- |
| 2.1 | Lands on **/browse** (Catalogue) | Total availability per item; search + category chips work; no store-room picker anywhere in the order flow |
| 2.2 | **My activity** | Only Priya's checkouts/returns, grouped by day |
| 2.3 | **Requests** → Request a new item: name, description, product link, a photo, qty 2, zone 14 | Listed as *Open* with the photo thumbnail, description and working link; cancel it — it disappears |
| 2.3a | Same form — check there is no catalogue dropdown and no Level 8/Basement field | Callout at the top points catalogue items back to **Catalogue**; only new-item fields are shown |
| 2.4 | Place a catalogue order and pick a zone | Zones are the bare numbers 3–22; order lands in the procurement queue tagged with that zone |
| 2.5 | Type `/admin` in the URL bar | Bounced back to /browse — staff can't see admin screens |
| 2.6 | **Profile** → change password, then sign out and back in with the new one | Change succeeds; the old password no longer works. (If a password is forgotten instead, "Request a new password" on the login screen puts it in procurement's dashboard queue.) |

## 3. Admin operations

| # | Do | Expect |
| --- | --- | --- |
| 3.1 | **Receive**: 2 lines + note "Popular Book Co, Inv #4821" | Stock up; two `receive` audit rows carrying the note |
| 3.2 | **Transfer**: 5 × pens, Level 8 → Basement | Both rooms update; audit shows paired transfer_out/transfer_in |
| 3.3 | **Adjust**: −2 with empty note | Blocked until a reason is entered |
| 3.4 | **Stocktake**: Level 8, count 3 items (one deliberately off by −2) | Variance report shows the −2; adjustment row in audit; stocktake listed under "Past stocktakes" |
| 3.5 | **Inventory**: create an item with photo; set its reorder/par inline | Appears on kiosk & browse; photo renders |
| 3.6 | Deactivate that item | Gone from kiosk/browse; its history remains in the audit log |
| 3.7 | **Export CSV** → edit a qty in the file → **Import CSV** | Preview shows the change; import reports "updated N, stock adjusted 1"; re-import → "stock adjusted 0" (idempotent) |
| 3.8 | **Reorder**: set an item's reorder point ≥ its qty | Appears on the reorder dashboard with suggested qty = par − on-hand and days-to-stockout |
| 3.9 | Select reorder rows → **Copy as WhatsApp message** | Formatted order list on the clipboard |
| 3.10 | **Approvals**: approve the toner request from 1.10 | Stock decremented, checkout attributed to Priya in the audit log, Priya gets a WhatsApp (phone on file); History tab shows the decision |
| 3.11 | **Requests**: open Priya's new-item request | Photo thumbnail, description and product link all visible; move it Open → Ordered with a note — Priya's /requests shows the new status + note and a WhatsApp update arrives |
| 3.12 | **Reports**: switch group-by User/Item/Category/Zone, ranges 7/30/90 | Charts + ranked tables respond; "by user" is the fairness view |
| 3.13 | **Audit log**: filter by type/location/user/item/date; export CSV | Filters compose; pagination works; CSV downloads |
| 3.14 | **Users**: reset Priya's password; deactivate her | Old session can't act (deactivated notice); her name shows as "Former staff — Priya Test" in history views. Reactivate after |

## 4. WhatsApp end-to-end (production sender)

| # | Do | Expect |
| --- | --- | --- |
| 4.1 | Settings → **Send test message** | Digest-template message arrives at every recipient |
| 4.2 | Check out an item down to 0 (reorder point > 0) | Immediate 🔴 out-of-stock alert |
| 4.3 | Trigger the digest manually:<br>`curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/daily-digest` | 📦 digest message; response JSON shows counts. (Otherwise it fires daily 8:00 SGT via Vercel cron) |
| 4.4 | Supabase → `notifications_log` table | Every send logged with status sent/failed/skipped |

## 5. Security spot-checks (browser level)

- Kiosk account → type `/admin` → redirected to /kiosk.
- Staff account → `/admin/inventory` → redirected to /browse.
- Sign out → any admin URL → login page.
- (DB level — RLS, ledger immutability, PIN brute force — is covered by
  `supabase/tests/01_smoke_test.sql`, 36 assertions, plus
  `02_requests_and_zones.sql`, 8 more; all passing.)

## Known limitations (by design, per the spec's phasing)

- Suppliers, purchase orders, receive-against-PO, unit costs / spend
  reports — Phase 3, not built.
- Email digest fallback (Resend) — not wired; the fallback is
  copy-as-WhatsApp plus the send log.
- QR-code label printing — not built (spec listed it as out of hardware
  scope; easy to add later).
- Kiosk PIN sign-in works only on kiosk device accounts; admins opening
  /kiosk get a read-only preview banner.
