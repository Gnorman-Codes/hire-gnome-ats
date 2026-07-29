# Operations Runbook

## 0) Hosted Docker Instance

Copy and manually edit the customer-specific configuration:
```bash
cp hosted-instance.example.json hosted-instance.json
chmod 600 hosted-instance.json
```

Set all required values and first-run users directly in `hosted-instance.json`, then start the stack:
```bash
npm run hosted:up -- --config hosted-instance.json
```

The launcher validates the JSON and privately renders the values Docker Compose requires. The generated `.env.hosted` is internal; never maintain it manually. Verify:
```bash
npm run hosted:status -- --config hosted-instance.json
curl -fsS https://ats.customer.example/api/health
```

Provisioning creates missing divisions and users, skips existing email addresses, and never overwrites an existing account.

The stack persists MySQL, local attachments, generated exports, SQL backups, and TLS state in named volumes. The `backup` service runs a backup immediately after the application becomes healthy and then every `DB_BACKUP_INTERVAL_SECONDS` seconds (default `86400`).

After all users verify their first login:
1. Have each user change their initial password.
2. Remove the provisioned entries from the JSON `users` array.
3. Set `admin.provisioningEnabled` to `false` and remove `admin.password` from `hosted-instance.json`.
4. Rerun `npm run hosted:up -- --config hosted-instance.json`.

Clearing the JSON users array removes the plaintext initial credentials only. It does not remove or modify the database users.

To add or change an integration later, update only that section of `hosted-instance.json` and rerun `npm run hosted:up -- --config hosted-instance.json`. Missing properties are left unchanged; explicit `null` values clear nullable database-backed properties. Existing user records are always create-only through reconciliation.

Run an immediate backup:
```bash
npm run hosted:backup -- --config hosted-instance.json
```

List backup files:
```bash
docker compose --env-file .env.hosted -f docker-compose.hosted.yml exec app \
  find /app/.backups -maxdepth 1 -type f -name 'ats-backup-*.sql' -print
```

Copy a backup off-host:
```bash
docker compose --env-file .env.hosted -f docker-compose.hosted.yml cp \
  app:/app/.backups/ats-backup-YYYYMMDD-HHMMSS.sql ./
```

Stopping the stack with `npm run hosted:down -- --config hosted-instance.json` preserves volumes. Do not add `--volumes` unless intentionally destroying the instance data.

## 1) Release Gate (CI)

CI workflow file:
- `.github/workflows/ci.yml`

Jobs:
- `build`: dependency install + production build.
- `api-smoke`: MySQL-backed smoke run:
	- apply migrations
	- start app
	- wait for `/api/health`
	- run permissions smoke tests

Local equivalent:
```bash
npm run ci:preflight
npm ci
npm run ci:build
```

Server deploy equivalent:
```bash
npm ci
npm run build:deploy
```

## 2) Backups

### One-off backup
```bash
npm run db:backup
```

### Scheduled backup with retention pruning
```bash
npm run db:backup:scheduled
```

Config:
- `DB_BACKUP_DIR` (default: `.backups`)
- `DB_BACKUP_RETENTION_DAYS` (default: `14`)

### Cron example (daily at 2:15 AM)
```cron
15 2 * * * cd /opt/hire-gnome-ats && /usr/bin/env npm run db:backup:scheduled >> /var/log/hire-gnome-backup.log 2>&1
```

## 3) Restore

Restore from a SQL dump:
```bash
npm run db:restore -- --input .backups/ats-backup-YYYYMMDD-HHMMSS.sql --drop-first
```

Flags:
- `--input <file>` required.
- `--drop-first` optional; drops/recreates target DB before restore.

## 4) Health Monitoring

Run health check:
```bash
npm run health
```

Use a custom URL + one-off alert webhook:
```bash
npm run health -- http://localhost:3000/api/health --alert-webhook "https://example.com/webhook"
```

Env:
- `HEALTH_ALERT_WEBHOOK_URL`
- `HEALTH_ALERT_SOURCE` (default: `hire-gnome-ats`)

## 4.1) API Trace Headers

All API responses include:
- `x-request-id` (correlates request across proxy/API logs)
- `x-response-time-ms` (route execution timing)
- `server-timing: app;dur=<ms>`

Use these in reverse-proxy logs and incident debugging.

## 5) Error Alert Hooks

API errors are logged and can send webhook alerts from server runtime.

Env:
- `ERROR_ALERT_WEBHOOK_URL`
- `ERROR_ALERT_MIN_LEVEL` (default: `error`)
- `ERROR_ALERT_COOLDOWN_SECONDS` (default: `300`)
- `ERROR_ALERT_SOURCE` (default: `hire-gnome-ats`)

Recommended:
- Use an incident channel webhook (PagerDuty/Opsgenie/Slack middleware).
- Keep cooldown at 2-5 minutes to avoid noise bursts.

## 5.1) Papertrail Shipping

Application logs are always written to process stdout/stderr in structured JSON.
Papertrail forwarding is optional and uses UDP syslog when configured.

Enable by setting:
- `PAPERTRAIL_HOST`
- `PAPERTRAIL_PORT`

Optional:
- `PAPERTRAIL_MIN_LEVEL` (`debug|info|warn|error`, default `info`)
- `PAPERTRAIL_APP_NAME` (default `hire-gnome-ats`)
- `PAPERTRAIL_FACILITY` (`0-23`, default `16` / `local0`)

If `PAPERTRAIL_HOST` or `PAPERTRAIL_PORT` is missing, shipping is disabled and logs remain local to stdout/stderr only.

## 6) Build-Time DB Behavior

By default the app skips System Settings DB reads during `next build` to keep SSG stable without DB access.

Env:
- `SKIP_SYSTEM_SETTINGS_DB_DURING_BUILD`:
	- `true` (default): uses safe defaults during build.
	- `false`: allows DB reads during build if DB is reachable.

## 7) Career Site Anti-Abuse Guard

Career-site quick-apply submissions use layered controls:
- IP/network mutation throttle (`CAREERS_APPLY_* rate-limit envs`)
- honeypot field check
- minimum form fill timing guard (`CAREERS_APPLY_MIN_FORM_FILL_SECONDS`, default `2`)

Set `CAREERS_APPLY_MIN_FORM_FILL_SECONDS=0` to disable timing checks.

## 8) Custom Field Export/Import Sanity Check

Use this after upgrades, environment migrations, or backup/restore tests.

1. In `Admin > Custom Fields`, confirm at least one custom field exists for each target module (`Candidates`, `Clients`, `Contacts`, `Job Orders`, `Submissions`, `Interviews`, `Placements`).
2. In `Admin > Data Export`, run a `ZIP` export and download the file.
3. Verify the export contains `data/customFieldDefinitions.json`.
4. In a test environment, go to `Admin > Data Import`, upload the export file, and run `Preview Import`.
5. Confirm preview counts include `Custom Fields` and expected entity totals.
6. Run `Apply Import`.
7. Re-open `Admin > Custom Fields` and confirm definitions are present and ordered correctly.
8. Open one record form per module and verify:
	- custom fields render,
	- required custom fields block save when empty,
	- saved values persist after refresh.

Import behavior notes:
- Custom field definitions are applied before entity upserts.
- Definitions are upserted by `recordId` first, then by `(moduleKey, fieldKey)`.
- Entity `customFields` payloads for clients, contacts, candidates, job orders, submissions, interviews, and placements are imported when present.

## 9) Postmark Inbound Email Webhook

Endpoint:
- `POST /api/inbound/postmark`

Authentication:
- Public route by default.
- If `POSTMARK_INBOUND_WEBHOOK_SECRET` is set, pass it either:
	- as query string: `/api/inbound/postmark?secret=...`
	- or header: `x-webhook-secret: ...`

Processing behavior:
- Extracts email addresses from inbound JSON payload fields.
- Matches against:
	- `Candidate.email`
	- `Contact.email`
- Creates an `Email` note on each matched candidate/contact.
- Saves supported attachments to matched candidates only.
- Does not save attachments to contacts.
- Dedupes by Postmark `MessageID`.

Attachment notes:
- Candidate attachments are only saved when the inbound payload includes actual attachment bytes, not metadata-only attachment objects.
- Common inline/signature image noise is skipped.
- Generic email MIME types like `application/octet-stream` are accepted when the file extension is allowed.

Validation and diagnostics:
- Recent inbound events are visible in `Admin Area > System Settings > System Diagnostics`.
- Diagnostics includes:
	- subject
	- sender
	- processing status
	- candidate/contact match counts
	- notes created
	- candidate files saved
	- attachment skip reasons when applicable

Recommended Postmark webhook URL:
```text
https://your-domain.example/api/inbound/postmark
```

Recommended secured URL when using a shared secret:
```text
https://your-domain.example/api/inbound/postmark?secret=YOUR_SECRET
```
