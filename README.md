# MathVision Inventory

Procurement & inventory management for MathVision Educational Enrichment
Centre — a single source of truth for the **Level 8** and **Basement** store
rooms, replacing scattered chat messages and cupboard raiding with a live
catalogue, pre-ordering from your own device, and a reorder dashboard that
says what to buy before it runs out.

## What it does

- **Order → pack → collect** (the core flow) — the store rooms stay locked.
  Zone admins shop from their own device (search, cart, pack-of-N
  quantities, "which zone is this for?"), the procurement team packs each
  order and marks it ready (that's when stock is decremented, attributed to
  the requester — nobody self-logs, so nothing gets forgotten or fat-fingered),
  and the requester sees it turn Ready to collect.
- **Immutable ledger** — every checkout, return, receive, transfer, and
  adjustment is a row in an append-only transactions ledger. Stock levels and
  the ledger can never diverge (both are written in a single Postgres
  function with row locks — concurrent "last unit" checkouts are handled
  gracefully).
- **Requests** — out-of-stock or brand-new items become structured requests
  with statuses (open → acknowledged → ordered → received → ready →
  fulfilled), replacing the ad-hoc chat thread. The requester's own view shows
  the stages that concern them, with the expected date where procurement has
  set one.
- **Proactive procurement** — reorder dashboard of every item down to about
  half of what we like to keep, with suggested order quantities and
  days-to-stockout, exportable as CSV or as a plain-text order list to paste
  wherever you order from the supplier.
- **Reimbursement claims** — the third way somebody gets what they need,
  after ordering it and requesting it: they bought it themselves. Lines with
  amounts in whole cents, receipts in a *private* bucket served by
  short-lived signed URLs, and a required "why wasn't this ordered?" that
  feeds back into what we should be stocking. Money only — a claim never
  touches the stock ledger, because nothing arrived in a store room.
- **Store rooms per item** — a room means "we keep it here", so the Basement
  lists the A3/A4 paper it actually holds instead of a hundred items at zero.
  A room still holding stock can't be dropped from an item.
- **Admin suite** — one Update stock screen (delivery arrived / moved
  between rooms / recount or breakage), stocktake mode with variance
  reports, full inventory grid with CSV import/export (idempotent on SKU),
  consumption reports (by user/item/category/zone), filterable audit
  log, and user management.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), TypeScript |
| DB / Auth / RLS | Supabase (Postgres + Auth + RLS + SECURITY DEFINER RPCs) |
| Hosting | Vercel |
| UI | Tailwind CSS, shadcn-style component kit, Archivo, MathVision navy |
| Charts | Recharts |
| Photos | Supabase Storage (`item-photos` bucket) |

## Repository layout

```
supabase/
  migrations/                # 0001 schema + RPCs + RLS, then 0002…0016 in order
  seed_demo.sql              # optional sample catalog
  templates/catalog_template.csv
src/
  app/
    (staff)/                 # catalogue / order tracking / profile
    admin/                   # dashboard, reorder, inventory, ops, reports…
  lib/
    actions/                 # server actions (all mutations go through here)
    supabase/                # server/browser/admin clients
    search.ts                # word-order-independent catalogue matching
  components/                # UI kit + shared components
```

## Getting started

Full step-by-step deployment guide (Supabase → Vercel → users → go-live):
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

Local development:

```bash
cp .env.example .env.local   # fill in Supabase keys
npm install
npm run dev
```

The first account to sign in becomes the super admin automatically.

## Security model (summary)

- All stock mutations go through SECURITY DEFINER Postgres functions; there
  are deliberately **no** insert/update policies on `stock_levels` or
  `transactions` — clients cannot write them directly, and the ledger has a
  belt-and-braces trigger blocking updates/deletes.
- Everyone signs in as themselves — Department Admins and Heads with a
  four-digit User ID, procurement and super admins with an email address.
  Shared devices and PIN sign-in were removed in migration `0008`.
- Procurement and super admin roles are assigned in Supabase, never from the
  app, and no super admin can change another's account.
- Staff see their own history and requests; procurement/super admins see
  everything (enforced by RLS, not just UI).
- Items flagged **central team only** (heavy cleaning supplies and the like)
  are hidden by the read policy on `items` and `stock_levels`, and the two
  SECURITY DEFINER functions that face everyone — catalogue search and
  ordering — filter them out themselves, since a definer function bypasses
  RLS by definition. Knowing the item's id is not enough.
