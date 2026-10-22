#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${XACL_DISPOSABLE_DATABASE:-}" != "1" ]]; then
  echo 'Refusing SQL fixtures. Set XACL_DISPOSABLE_DATABASE=1 ONLY for a disposable test database.' >&2
  exit 2
fi
command -v psql >/dev/null || { echo 'psql is required (PostgreSQL 17+).' >&2; exit 2; }
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;
SQL
psql -X -v ON_ERROR_STOP=1 -f tests/backend_bootstrap.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/001_annotation.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/001_annotation.sql
psql -X -v ON_ERROR_STOP=1 -f tests/backend.sql
