# Verification and deployment record

Software checks and frozen-file checks establish application behavior and byte identity. They are not judgments that paper content or conference versions align.

## Reproduce

Use PostgreSQL 17 or newer with `pgcrypto`, Python 3.11+, Node.js 24+, and an installed Playwright/Chrome for browser checks. Use an isolated disposable database; never run test fixtures against the real annotation database.

- `python3 scripts/verify_site.py`: verify all frozen sample and PDF hashes and runtime assets.
- `bash scripts/test_database.sh`: apply the migration twice, then run transaction-isolated SQL tests with simulated Supabase roles and an `auth.uid()` fixture. The bootstrap is for the isolated test database only, never the real project.
- `node --test tests/frontend*.mjs`: cloud adapter and frontend unit checks, if present.
- `tests/browser_server.py` and `tests/browser.cjs`: run the real browser against the SQL RPCs in a local test database. The test bridge replaces Supabase Auth/Data HTTP transport with explicitly synthetic anonymous JWTs; the official vendored SDK, SQL validation, auth.uid binding, authorization and revision history execute normally. This does not claim to test the production Supabase gateway itself.

Test artifacts and temporary runtimes belong in `.runtime/`, not in the published `site/` directory. Synthetic notes are labeled as software fixtures, not human ratings. No private production recovery codes are required by tests.

See `deployment-status.json` for the latest recorded checks and remaining manual initialization requirement.
