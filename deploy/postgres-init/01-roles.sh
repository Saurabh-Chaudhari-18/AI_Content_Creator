#!/bin/sh
# Runs ONCE, when the Postgres data volume is first created (the official
# image runs /docker-entrypoint-initdb.d/* on an empty data directory only).
#
# Three logins instead of one superuser:
#   omnipost_owner      owns the database and runs the migrations (no superuser)
#   omnipost_app        the API and workers: read and write rows, nothing else
#                       (no DROP, ALTER, CREATE, no other databases)
#   omnipost_admin_app  the admin panel, through the omnipost_admin role whose
#                       read-only grants migration 0006 sets up
# The `postgres` superuser stays for backups and emergencies; no app uses it.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v owner_pw="$OWNER_DB_PASSWORD" \
  -v app_pw="$APP_DB_PASSWORD" \
  -v admin_pw="$ADMIN_DB_PASSWORD" <<'SQL'
CREATE ROLE omnipost_owner LOGIN CREATEROLE PASSWORD :'owner_pw';
CREATE ROLE omnipost_app LOGIN PASSWORD :'app_pw';

-- Created here so its login can exist before the first migration;
-- migration 0006 then finds it and only adds the grants.
CREATE ROLE omnipost_admin NOLOGIN;
CREATE ROLE omnipost_admin_app LOGIN PASSWORD :'admin_pw' IN ROLE omnipost_admin;
GRANT omnipost_admin TO omnipost_owner WITH ADMIN OPTION;

-- The owner role owns the database, so the public schema too
-- (PostgreSQL 15+: public belongs to pg_database_owner).
ALTER DATABASE :"db" OWNER TO omnipost_owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO omnipost_app, omnipost_admin;

GRANT USAGE ON SCHEMA public TO omnipost_app;
-- Every table and sequence the migrations create (as omnipost_owner) is
-- automatically usable by the app — rows only.
ALTER DEFAULT PRIVILEGES FOR ROLE omnipost_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omnipost_app;
ALTER DEFAULT PRIVILEGES FOR ROLE omnipost_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO omnipost_app;
SQL

echo "omnipost: database roles created"
