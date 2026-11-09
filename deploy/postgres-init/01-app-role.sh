#!/bin/sh
# Runs only when PostgreSQL initializes an empty data directory.
# The application role is intentionally separate from the migration owner.
set -eu
if [ -z "${APP_DATABASE_PASSWORD:-}" ]; then
  echo "APP_DATABASE_PASSWORD is required to create the application role" >&2
  exit 1
fi
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_password="$APP_DATABASE_PASSWORD" -v dbname="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE ps_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ps_app')
\gexec
GRANT CONNECT ON DATABASE :"dbname" TO ps_app;
GRANT USAGE ON SCHEMA public TO ps_app;
SQL