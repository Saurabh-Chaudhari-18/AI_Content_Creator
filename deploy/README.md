# Deploying OmniPost to a server

This folder runs the whole product on **one Linux server with Docker**. Use it for the
owner's review environment and for the first real customers.
Your own computer keeps using `backend/docker-compose.yml`, which is unchanged.

| | Developer stack (`backend/`) | Production stack (`deploy/`) |
|---|---|---|
| Address | http://localhost:4173 | https://your-domain, with a certificate renewed automatically |
| Mode | development, demo data, API docs on | production, no demo data, no API docs |
| Database | `postgres` superuser, port open on your machine | no open port; three restricted logins (below) |
| Redis | no password | password required |
| API | 2 processes | 3 processes (`API_WORKERS`) |
| Photos | on disk | Cloudflare R2 / S3 (Meta downloads them by URL) |
| Backups | none | nightly, kept 14 days |
| Error alerts | none | Sentry, when `SENTRY_DSN` is set |

## 1. What you need

- A Linux server (VPS) with 2–4 CPUs, 4 GB RAM and Docker installed. Hetzner, DigitalOcean and
  Lightsail all work.
- A domain or subdomain (for example `app.omnipost.in`) with an **A record pointing at the server**.
  Ports 80 and 443 must be open.
- An R2 bucket (or S3) and an access key for it.
- Optional: a Sentry project (sentry.io, free tier) for error alerts.

## 2. First start

```sh
git clone <repo> omnipost && cd omnipost/deploy
cp .env.example .env
nano .env                      # fill in EVERY value; .env.example says how to generate each
docker compose -f docker-compose.prod.yml up -d --build
```

The first start:

1. creates the database and its logins;
2. applies all migrations;
3. starts everything;
4. gets the HTTPS certificate.

Then:

1. Open `https://<DOMAIN>` and register your own account.
2. Make that account the first super admin. There is deliberately no web page for this:
   ```sh
   docker compose -f docker-compose.prod.yml exec api python -m app.cli grant-super-admin you@example.com
   ```
3. In the Meta developer console, set the OAuth redirect URI to
   `https://<DOMAIN>/api/v1/social/callback/facebook`.

**Keep a copy of `deploy/.env` somewhere safe, such as a password manager.**

- If you lose `FERNET_KEY`, every connected Facebook and Instagram account has to reconnect.
- If you lose `SECRET_KEY`, everyone is signed out.

## 3. Updating

```sh
cd omnipost && git pull
cd deploy && docker compose -f docker-compose.prod.yml up -d --build
```

New migrations run automatically before the API starts. The API is unavailable for a few seconds.

## 4. Database logins

These are created on the first start by `postgres-init/01-roles.sh`.

| Login | Used by | Can |
|---|---|---|
| `omnipost_owner` | migrations only | create and change tables (not a superuser) |
| `omnipost_app` | API, worker, scheduler | read and write rows. It cannot drop or alter tables, so a bug or an injection can't destroy the schema |
| `omnipost_admin_app` | the admin panel | read-only access to customer content. Passwords and tokens are unreadable (migration 0006) |
| `postgres` | backups, emergencies | everything |

**The init script runs only when the database volume is empty.** To change a password later:

```sh
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "ALTER ROLE omnipost_app PASSWORD '<new>'"
```

Then update `.env` and run `up -d`.

## 5. Backups

The `backup` service writes `deploy/backups/omnipost-<time>.dump` every 24 hours and deletes
files older than 14 days. The log says `backup ok` or `BACKUP FAILED`:

```sh
docker compose -f docker-compose.prod.yml logs backup
```

**A backup on the same server is lost with the server.** Copy the folder off the server
every day. For example, use rclone to an R2 bucket that is separate from the media bucket, from the server's crontab:

```sh
15 3 * * *  rclone copy /path/to/omnipost/deploy/backups r2-backups:omnipost-db-backups --max-age 48h
```

The alternative is a managed database with point-in-time recovery (Neon, Supabase, RDS).
To use one, point the `DATABASE_URL`s at it and remove the `postgres` and `backup` services.

### Restore (test this once before real customers, then every few months)

```sh
# 1. Stop everything that writes to the database
docker compose -f docker-compose.prod.yml stop api worker beat
# 2. Restore a dump (replaces the current data)
docker compose -f docker-compose.prod.yml exec -T backup \
  pg_restore --clean --if-exists --no-owner --role=omnipost_owner -d ai_content /backups/omnipost-<time>.dump
# 3. Start again
docker compose -f docker-compose.prod.yml start api worker beat
```

## 6. Monitoring

- **Errors.** Set `SENTRY_DSN` (API and workers) and `VITE_SENTRY_DSN` (web app; it's built into
  the app, so rebuild after changing it).
  - Crashes, failed tasks and the publishing health check all arrive in Sentry.
  - No passwords, cookies, captions or other request bodies are sent.
- **Publishing health.** Every 5 minutes the scheduler checks for:
  - posts more than 10 minutes overdue (the scheduler or workers are down);
  - 5 or more failed posts in the last hour.

  Each problem is logged as an error, which Sentry turns into an alert.
- **Uptime.** Add a free external monitor (UptimeRobot, Better Stack) on
  `https://<DOMAIN>/api/v1/ready`. It returns 503 when the database or Redis is unreachable.
- **Logs.** `docker compose -f docker-compose.prod.yml logs -f api worker beat`. Each container keeps
  at most 5 × 20 MB of logs.

## 7. Trying it on your own computer

You can run the production stack locally with `DOMAIN=localhost` and different ports
(`HTTP_PORT=8080`, `HTTPS_PORT=8443`) as a separate project:

```sh
docker compose --env-file test.env -f docker-compose.prod.yml -p omnipost-prodtest up -d --build
```

Then open https://localhost:8443. The browser warns about the certificate, because Caddy uses its
own local certificate authority for `localhost`.
