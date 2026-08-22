# User acceptance test script — MathVision Inventory

A complete walkthrough of every feature, in the order that makes each test
set up the next. Time needed: ~30 minutes. The database-level rules (stock
math, race conditions, RLS) are already covered by the automated suite in
`supabase/tests/` — this script is the human/browser layer on top.

## Setup (once)

- Migrations `0001` → `0017` + (optionally) `seed_demo.sql` run in Supabase.
- You are signed in as the super admin.
- On **Admin → Users**, add "Priya Test" — role *Department Admin*, User ID
  `1901`. Note the temporary password.
- Check the Users list shows ID `1901` and the role you picked. If it doesn't,
  stop — that's the bug this check exists to catch.

## 1. Ordering on your own device

The header has three items now: **Order**, **Track my orders**, **Profile**.

Sign in as Priya Test in a private window — User ID `1901` and the
temporary password.

| # | Do | Expect |
| --- | --- | --- |
| 1.1 | Lands on **Order** (/browse) | Total availability per item; search + category chips work; no store-room picker anywhere in the order flow |
| 1.2 | **Track my orders** → **Collected** tab | Only what Priya has finished with — collected orders and bought-in requests, nobody else's |
| 1.3pre | **Order** → *Request a new item* → type "sticky notes" (something you stock) | Matches appear under the field — "We stock these already" — with **Order this**, which adds it to the order instead |
| 1.3pre2 | Same field: type the words backwards, e.g. "pen blue" then "blue pen" | Both find the same item; so does a plural like "pens blue" |
| 1.3 | **Order** → Request a new item: name, description, product link, a photo, qty 2, zone 14 | Listed as *Open* with the photo thumbnail, description and working link; cancel it — it disappears |
| 1.3a | Same form — check there is no catalogue dropdown and no Level 8/Basement field | Only new-item fields are shown |
| 1.3b | Order: page through with **Back** / **Next**; scroll down mid-page | Nine items per page; the search box and category chips stay pinned at the top |
| 1.3c | Open an item procurement capped (Inventory → Max per order), try to exceed it | The quantity stops at the cap and the dialog says how many are allowed per order |
| 1.4 | Place a catalogue order and pick a zone | Zones are the bare numbers 3–22; order lands in the procurement queue tagged with that zone |
| 1.4b | Leave Priya signed in. As admin, pack her order, then look at Priya's header | **Track my orders** carries a count badge; the order shows an "Updated" flag and a highlighted border |
| 1.4c | Open Track my orders as Priya, then go back to Order | The badge is gone; it comes back only when procurement changes the order again |
| 1.5 | Type `/admin` in the URL bar | Bounced back to /browse — no Reports or admin screens below procurement |
| 1.6 | **Profile** → change password, then sign out and back in with the new one | Change succeeds; the old password no longer works. (If a password is forgotten instead, "Request a new password" on the login screen puts it in procurement's dashboard queue.) |

## 2. Admin operations

| # | Do | Expect |
| --- | --- | --- |
| 2.1 | **Receive**: 2 lines + note "Popular Book Co, Inv #4821" | Stock up; two `receive` audit rows carrying the note |
| 2.2 | **Transfer**: 5 × pens, Level 8 → Basement | Both rooms update; audit shows paired transfer_out/transfer_in |
| 2.3 | **Adjust**: −2 with empty note | Blocked until a reason is entered |
| 2.4 | **Stocktake**: Level 8, count 3 items (one deliberately off by −2) | Variance report shows the −2; adjustment row in audit; stocktake listed under "Past stocktakes" |
| 2.4b | **Inventory** → edit an item → set **Max per order** to 5 | Grid shows a "Max 5 per order" badge; ordering 6 of it is refused |
| 2.5 | **Inventory**: create an item with photo; set its reorder/par inline | Appears in the catalogue; photo renders |
| 2.6 | Deactivate that item | Gone from the catalogue; its history remains in the audit log |
| 2.7 | **Export CSV** → edit a qty in the file → **Import CSV** | Preview shows the change; import reports "updated N, stock adjusted 1"; re-import → "stock adjusted 0" (idempotent) |
| 2.8 | **Reorder**: set an item's reorder point ≥ its qty | Appears on the reorder dashboard with suggested qty = par − on-hand and days-to-stockout |
| 2.9 | Select reorder rows → **Copy order list** | Formatted order list on the clipboard |
| 2.10 | **Approvals**: approve a pending approval-flagged checkout | Stock decremented, checkout attributed to Priya in the audit log; History tab shows the decision |
| 2.10b | **Requests** → **We stock this** on a request matching something you carry, leaving "remember these words" on | An order is raised for the requester, the request closes as fulfilled, and those words now suggest that item in the request form |
| 2.11 | **Requests**: open Priya's new-item request | Photo thumbnail, description and product link all visible; move it Open → Ordered with a note — Priya's **Track my orders → Waiting** shows the card, badged "Bought in for you", with the new status + note |
| 2.12 | **Reports**: switch group-by User/Item/Category/Zone, ranges 7/30/90 | Charts + ranked tables respond; "by user" is the fairness view |
| 2.13 | **Audit log**: filter by type/location/user/item/date; export CSV | Filters compose; pagination works; CSV downloads |
| 2.14 | **Users**: reset Priya's password; deactivate her | Old session can't act (deactivated notice); her name shows as "Former staff — Priya Test" in history views. Reactivate after |

## 3. Security spot-checks (browser level)

- Staff account → `/admin/inventory` → redirected to /browse.
- Signed out → any admin URL → login page.
- (DB level — RLS and ledger immutability — is covered by
  `supabase/tests/01_smoke_test.sql` (36 assertions), plus
  `02_requests_and_zones.sql` (8), `03_no_kiosks.sql` (8),
  `04_order_limits.sql` (6), `05_order_read_state.sql` (7),
  `06_stock_matching.sql` (20), `07_request_delivery.sql` (10),
  `08_edit_and_collect.sql` (8), `09_restricted_and_rooms.sql` (14) and
  `10_collect_request.sql` (6); all passing.)

## Known limitations (by design, per the spec's phasing)

- Suppliers, purchase orders, receive-against-PO, unit costs / spend
  reports — Phase 3, not built.
- Notifications of any kind — removed in migration `0016`. People see
  where things stand when they open the app; messaging comes back with the
  larger app this rolls into.
- QR-code label printing — not built (spec listed it as out of hardware
  scope; easy to add later).
- Shared kiosk tablets and PIN sign-in were removed in migration `0008` —
  everyone orders from their own device.
- Reports and the audit log are procurement/super admin only. Department Head
  keeps its own role but currently has the same access as Department Admin.
