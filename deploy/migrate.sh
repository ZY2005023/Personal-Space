#!/bin/sh
# Forward-only migrations plus least-privilege grants for the runtime role.
set -eu
if [ -z "${MIGRATION_DATABASE_URL:-}" ]; then
  echo "MIGRATION_DATABASE_URL is required" >&2
  exit 1
fi
npx prisma migrate deploy
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO ps_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ps_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ps_app;
REVOKE UPDATE,DELETE ON content_revisions,revision_media,revision_categories,revision_tags,audit_logs FROM ps_app;
REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM ps_app;
SQL
echo "Migrations applied and runtime grants refreshed."