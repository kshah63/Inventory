# MathVision Inventory

Procurement & inventory management for MathVision Educational Enrichment
Centre — a single source of truth for the **Level 8** and **Basement** store
rooms, replacing WhatsApp asks and cupboard raiding with a live catalogue,
pre-ordering from your own device, and proactive reorder alerts.

## What it does

- **Order → pack → collect** (the core flow) — the store rooms stay locked.
  Zone admins shop from their own device (search, cart, pack-of-N
  quantities, "which zone is this for?"), the procurement team packs each
  order and marks it ready (that's when stock is decremented, attributed to
  the requester — nobody self-logs, so nothing gets forgotten or fat-fingered),
  and the requester collects it after a WhatsApp ping.
- **Immutable ledger** — every checkout, return, receive, transfer, and
  adjustment is a row in an append-only transactions ledger. Stock levels and
  the ledger can never diverge (both are written in a single Postgres
  function with row locks — concurrent "last unit" checkouts are handled
  gracefully).
- **Approval flow** — items flagged `requires_approval` (toner, high-value)
  can't just be packed; procurement gets a WhatsApp ping and one tap approves
  and records the checkout.
- **Requests** — out-of-stock or brand-new items become structured requests
  with statuses (open → acknowledged → ordered → fulfilled), replacing the
  WhatsApp channel. Requesters are notified on status changes.
- **Proactive procurement** — reorder dashboard of every item at/below its
  reorder point with suggested order quantities (par − on-hand) and
  days-to-stockout, exportable as CSV or a copy-paste WhatsApp order message.
- **WhatsApp alerts (Twilio)** — daily 8:00am SGT digest, immediate
  out-of-stock alerts, approval pings, and requester notifications. Sends
  approved content templates on production WhatsApp senders (required by
  Meta outside 24h reply windows), freeform in the sandbox, and degrades
  gracefully (skipped + logged) when Twilio isn't configured.
- **Admin suite** — receive/transfer/adjust, stocktake mode with variance
  reports, full inventory grid with CSV import/export (idempotent on SKU),
  consumption reports (by user/item/category/zone), filterable audit
  log, and user management.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), TypeScript |
| DB / Auth / RLS | Supabase (Postgres + Auth + RLS + SECURITY DEFINER RPCs) |
| Hosting | Vercel (cron for the daily digest) |
| UI | Tailwind CSS, shadcn-style component kit, Archivo, MathVision navy |
| Notifications | Twilio WhatsApp API (plain fetch, no SDK) |
| Charts | Recharts |
| Photos | Supabase Storage (`item-photos` bucket) |

## Repository layout

```
supabase/
  migrations/                # 0001 schema + RPCs + RLS, then 0002…0008 in order
  seed_demo.sql              # optional sample catalog
  templates/catalog_template.csv
src/
  app/
    (staff)/                 # catalogue / orders / activity / requests / profile
    admin/                   # dashboard, reorder, inventory, ops, reports…
    api/cron/daily-digest/   # Vercel cron → WhatsApp digest
  lib/
    actions/                 # server actions (all mutations go through here)
    supabase/                # server/browser/admin clients
    whatsapp.ts              # Twilio sender + message composers
  components/                # UI kit + shared components
```

## Getting started

Full step-by-step deployment guide (Supabase → Vercel → Twilio → users →
go-live): **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

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
