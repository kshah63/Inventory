# Database smoke tests

These run the real migrations against a plain PostgreSQL 16 instance (no
Supabase needed) and assert the core acceptance criteria: PIN rate-limiting
and lockout (the kiosk paths that 0008 later removes), checkout stock math
and ledger writes, per-checkout caps
(including the split-line bypass), overdraw rejection, return caps, atomic
transfers, mandatory adjustment notes, stocktake variance, CSV import
idempotency, ledger immutability, and RLS (staff cannot write stock or read
other users' history). Some of what 01 covers — kiosk PINs, the approval
flow — is removed by a later migration; it runs first, against the schema
that still had them.

`02_requests_and_zones.sql` covers migration 0007: zones are the bare numbers
3–22, and a request can carry a description, a product link and a photo with
no catalogue item and no store room.

`04_order_limits.sql` covers migration 0009: an order at the per-item cap is
accepted, one over it is refused, and the cap can't be beaten by splitting the
same item across two lines of one order.

`05_order_read_state.sql` covers migration 0010: placing your own order isn't
news, procurement packing it is, opening My orders clears the marker, a later
change raises it again, and nobody sees a marker for someone else's order.

`06_stock_matching.sql` covers migrations 0011 and 0012: names, typos,
reordered words and plurals all find the right item, a single letter and a genuine unknown find
nothing, aliases are learned and de-duplicated, resolving a request from stock
raises an order for the requester, and staff can do neither.

`07_request_delivery.sql` covers migration 0013: ordering and receiving stay
silent for the requester, ready to collect tells them, the expected date is
stored and clearable, and only procurement can move a request along.

`08_edit_and_collect.sql` covers migration 0014: quantities can be corrected
while an order is pending and not after it's packed, nobody can touch someone
else's, emptying an order is refused as a disguised cancellation, and the
requester can tick their own collection.

`09_restricted_and_rooms.sql` covers migration 0015: a central-team item is
invisible to everyone else — querying the table directly, searching, and
ordering it by id all come back empty or refused, while the central team sees
it and its stock levels normally; a store room still holding stock can't be
quietly dropped from an item; and an item can be deleted outright only while
nothing points at it. Its assertions run under `set role authenticated`,
because RLS is not enforced for the role that owns the tables.

`10_collect_request.sql` covers migration 0017: a request can't be collected
before it's ready, can't be collected by anyone but the requester, can't be
collected twice, records when it happened, and procurement can still tick it
for somebody who forgets.

`11_keep_about.sql` covers migration 0019: an item under half of what we
like to keep needs reordering, its count is totalled across rooms, the
suggestion tops it back up, an item with no number never appears even at
zero, the dashboard's low-stock count matches the reorder list exactly, out
of stock counts every item at zero whether tracked or not, and staff can't
read the list at all.

`12_claims.sql` covers migration 0020: a claim totals its lines in whole
cents, is refused without a reason or with a zero line, is invisible to
everyone but the claimant and procurement, is editable only while it's still
requested, can't be marked paid by the person claiming, can't be declined
without a reason, and can be neither edited nor cancelled once settled. It
also asserts the receipts bucket is private, unlike the other two.

`13_suppliers.sql` covers migration 0021: the approved supplier master is
seeded in full with spot-checked codes, a new supplier takes the next number
in its sub-group, duplicate names and known old QuickBooks spellings are
refused, a retired supplier's number is never reissued, a full sub-group says
so, a new sub-group claims an aligned free block, an alias points at exactly
one supplier, and staff can neither read nor write the register.

`03_no_kiosks.sql` covers migration 0008: the kiosk functions, tables and
columns are gone, no active device is left, and the paths that touched those
columns — new accounts, role and User ID changes — still work. Run the first
two suites *before* 0008, since they exercise the kiosk flow it removes.

```bash
createdb mvtest
psql -d mvtest -v ON_ERROR_STOP=1 -f 00_supabase_shim.sql   # fakes auth.*, storage.*, roles
for f in ../migrations/000[1-7]*.sql; do psql -d mvtest -v ON_ERROR_STOP=1 -f "$f"; done
psql -d mvtest -v ON_ERROR_STOP=1 -f ../seed_demo.sql        # tests use the demo catalog
psql -d mvtest -f 01_smoke_test.sql                          # expect: ALL SMOKE TESTS PASSED
psql -d mvtest -f 02_requests_and_zones.sql                  # expect: REQUESTS + ZONES TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0008_remove_kiosks.sql
psql -d mvtest -f 03_no_kiosks.sql                           # expect: NO-KIOSK TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0009_order_limits.sql
psql -d mvtest -f 04_order_limits.sql                        # expect: ORDER LIMIT TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0010_order_read_state.sql
psql -d mvtest -f 05_order_read_state.sql                    # expect: ORDER READ-STATE TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0011_stock_matching.sql
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0012_word_order_search.sql
psql -d mvtest -f 06_stock_matching.sql                      # expect: STOCK MATCHING TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0013_request_delivery.sql
psql -d mvtest -f 07_request_delivery.sql                    # expect: REQUEST DELIVERY TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0014_edit_and_collect.sql
psql -d mvtest -f 08_edit_and_collect.sql                    # expect: EDIT AND COLLECT TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0015_restricted_and_rooms.sql
psql -d mvtest -f 09_restricted_and_rooms.sql                # expect: RESTRICTED AND ROOMS TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0016_remove_notifications.sql
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0017_collect_request.sql
psql -d mvtest -f 10_collect_request.sql                     # expect: COLLECT REQUEST TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0018_remove_approvals.sql
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0019_keep_about.sql
psql -d mvtest -f 11_keep_about.sql                          # expect: KEEP ABOUT TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0020_reimbursement_claims.sql
psql -d mvtest -f 12_claims.sql                              # expect: CLAIMS TESTS PASSED
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0021_suppliers.sql
psql -d mvtest -f 13_suppliers.sql                           # expect: SUPPLIER REGISTER TESTS PASSED
```

The shim replaces `auth.uid()` with a `test.uid` session setting so tests can
impersonate any user. Never run any of this against a real Supabase project.
