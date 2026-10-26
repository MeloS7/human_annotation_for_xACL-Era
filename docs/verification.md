# Verification and deployment record

Software checks and frozen-file checks establish application behavior and byte identity. They are not judgments that paper content or conference versions align.

## Reproduce

Use PostgreSQL 17 or newer with `pgcrypto`, Python 3.11+, Node.js 24+, and an installed Playwright/Chrome for browser checks. Use an isolated disposable database; never run test fixtures against the real annotation database.

- `python3 scripts/verify_site.py`: verify all frozen sample and PDF hashes and runtime assets.
- `bash scripts/test_database.sh`: apply the migration twice, then run transaction-isolated SQL tests with simulated Supabase roles and an `auth.uid()` fixture. The bootstrap is for the isolated test database only, never the real project.
- `node --test tests/frontend*.mjs`: cloud adapter and frontend unit checks, if present.
- `XACL_DISPOSABLE_DATABASE=1 QA_DATABASE_URL=... python3 tests/database_upgrade.py`: after applying the current migration to a disposable database, seed the recognized earlier guidance and verify preservation of legacy current records/history, idempotent upgrade, and rollback on unrecognized configuration drift. Requires `psycopg`.
- `tests/browser_server.py` and `tests/browser.cjs`: run the real browser against the SQL RPCs in a local test database. The test bridge replaces Supabase Auth/Data HTTP transport with explicitly synthetic anonymous JWTs; the official vendored SDK, SQL validation, auth.uid binding, authorization and revision history execute normally. This does not claim to test the production Supabase gateway itself.

Test artifacts and temporary runtimes belong in `.runtime/`, not in the published `site/` directory. Synthetic notes are labeled as software fixtures, not human ratings. No private production recovery codes are required by tests.

See `deployment-status.json` for the latest recorded checks and remaining manual initialization requirement.

For the integrated object-scoring update, see `integrated-scoring-verification.json` and `integrated-scoring.md`. Its verification record separates completed local software checks from the production database upgrade and matching frontend publication. Existing production annotations are not software fixtures.

## Document quality protocol v1 (2026-10-26)

The active frontend uses the separately versioned six-dimension document-quality protocol. Frozen alignment assets and database payloads remain unchanged. Run the original SQL baseline, upgrade and race checks before applying `002_document_quality.sql`; then run `quality_backend_setup.py`, `quality_upgrade.py` and `browser_quality.cjs`. The quality upgrade regression must establish that legacy records/history are unchanged, existing profiles start with blank quality ratings, cross-protocol payloads and unauthorized reads are rejected, version observations do not cap scores, history is immutable, and stale saves conflict.

The reviewed migration must be installed in production before the new frontend is deployed. Local and CI fixtures are software tests, not collected human judgments. The original alignment verification records above remain historical evidence and are not relabeled as quality-protocol validation.
