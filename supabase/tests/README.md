# Database smoke tests

These run the real migrations against a plain PostgreSQL 16 instance (no
Supabase needed) and assert the core acceptance criteria: PIN rate-limiting
and lockout (the kiosk paths that 0008 later removes), checkout stock math
and ledger writes, per-checkout caps
(including the split-line bypass), overdraw rejection, out-of-stock alert
payloads, the approval flow, return caps, atomic transfers, mandatory
adjustment notes, stocktake variance, CSV import idempotency, the reorder
dashboard, ledger immutability, and RLS (staff/kiosk cannot write stock or
read other users' history).

`02_requests_and_zones.sql` covers migration 0007: zones are the bare numbers
3–22, and a request can carry a description, a product link and a photo with
no catalogue item and no store room.

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
```

The shim replaces `auth.uid()` with a `test.uid` session setting so tests can
impersonate any user. Never run any of this against a real Supabase project.
