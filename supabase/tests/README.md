# Database smoke tests

These run the real migration against a plain PostgreSQL 16 instance (no
Supabase needed) and assert the core acceptance criteria: PIN rate-limiting
and lockout, checkout stock math and ledger writes, per-checkout caps
(including the split-line bypass), overdraw rejection, out-of-stock alert
payloads, the approval flow, return caps, atomic transfers, mandatory
adjustment notes, stocktake variance, CSV import idempotency, the reorder
dashboard, ledger immutability, and RLS (staff/kiosk cannot write stock or
read other users' history).

```bash
createdb mvtest
psql -d mvtest -v ON_ERROR_STOP=1 -f 00_supabase_shim.sql   # fakes auth.*, storage.*, roles
psql -d mvtest -v ON_ERROR_STOP=1 -f ../migrations/0001_init.sql
psql -d mvtest -v ON_ERROR_STOP=1 -f ../seed_demo.sql        # tests use the demo catalog
psql -d mvtest -f 01_smoke_test.sql                          # expect: ALL SMOKE TESTS PASSED
```

The shim replaces `auth.uid()` with a `test.uid` session setting so tests can
impersonate any user. Never run any of this against a real Supabase project.
