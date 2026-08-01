# Hire Gnome ATS

![Hire Gnome](https://hiregnome.com/gnome_banner.png?v=2)

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Node](https://img.shields.io/badge/Node-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io/)
[![MySQL](https://img.shields.io/badge/MySQL-8+-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)

Open-source Applicant Tracking System designed for small recruiting teams that want a simple, self-hostable alternative to complex enterprise ATS platforms.

Hire Gnome focuses on practical hiring workflows — candidate pipelines, structured evaluation, and lightweight reporting — while remaining easy to deploy, customize, and extend.

Built for teams that want full control of their hiring stack without the cost or complexity of traditional recruiting software.

## Live Demo
Try the public demo environment: [https://demo.hiregnome.com](https://demo.hiregnome.com)

When demo mode is enabled, authenticated demo users see a one-time welcome modal with quick guidance. Forwarding a message to `demo@hiregnome.com` triggers the Postmark inbound workflow in the demo environment, but the forwarded message must include an email address that matches an existing candidate or contact record for processing to occur.

## Table Of Contents
- [Features](#features)
- [Changelog](#changelog)
- [User Documentation](#user-documentation)
- [Quick Start](#quick-start)
- [Hosted Docker Deployment](#hosted-docker-deployment)
- [Onboarding And First Login](#onboarding-and-first-login)
- [Configuration Model](#configuration-model)
- [Environment Reference](#environment-reference)
- [Scripts](#scripts)
- [Operations](#operations)
- [Production Checklist](#production-checklist)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Security](#security)

## Features
- Authentication with first-run onboarding
- Role and division access model (`Administrator`, `Director`, `Recruiter`)
- Core modules: Candidates, Clients, Contacts, Job Orders, Submissions, Interviews, Placements
- Action-oriented dashboard with KPI drill-through, 7-day activity strip, smart needs-attention alerts, upcoming interviews, recent candidates, recent job orders, and fixed-height section paging
- Operational Reporting module with scoped KPIs, pipeline totals, drill-through detail, daily trend, owner performance, and Excel export with summary + entity tabs that mirror report-modal detail
- List + Kanban pipeline views for Candidates and Job Orders with drag-and-drop status updates
- Admin-defined custom fields for Candidates, Clients, Contacts, Job Orders, Submissions, Interviews, and Placements
- AI-assisted resume parsing with fallback parsing if AI is unavailable
- AI candidate summaries opened from a dedicated sparkles button on candidate detail, with first-run auto-generation from profile, resume, history, skills, and recent notes
- Candidate detail snapshot card with title, location, status, top skills, AI summary snippet, last activity, and profile-completeness guidance
- Candidate list profile-completeness chips plus soft submission warnings when recruiters try to submit thin profiles
- AI-generated submission write-ups for polished client-facing candidate introductions
- AI-generated interview question sets stored on the interview record and refreshable on demand
- AI match explanations on candidate/job-order match lists with cached, refreshable fit analysis that auto-generates on first open
- AI email drafting from candidate and contact actions menus with purpose/tone controls and copy-to-clipboard
- AI editor actions use the shared sparkles icon pattern for consistency across candidate and job-order detail views
- AI-specific controls stay visible but are disabled with an inline hint when no OpenAI key is configured in system settings
- Job-order submission workspaces support recruiter priority ordering with persisted drag-and-drop ranking
- Client review portal with persistent magic links per job-order contact, allowing external review of submitted candidates without a login
- Career-site web responses stay differentiated from recruiter-curated submissions and remain hidden from the client portal until a recruiter promotes them
- Candidate file attachments with object storage (`s3`) and local fallback
- Candidate file workspace supports explicit resume labeling so internal users and the client portal can identify the primary resume document
- Public career site (toggleable in Admin settings) with quick apply + resume upload
- Candidate and job-order match workspaces (top matches, sortable/paged)
- Administrator-only audit trails on records plus admin diagnostics
- Admin diagnostics includes recent inbound email webhook visibility
- Admin data export module with `JSON`, `NDJSON`, and `ZIP (per-entity)` Hire Gnome output + a Bullhorn API batch ZIP exporter for bounded migration samples
- Admin data import module:
	- Hire Gnome export re-import (`JSON`, `NDJSON`, `ZIP`)
	- Generic CSV migration batches with per-column field mapping (`Clients`, `Contacts`, `Candidates`, `Job Orders`, `Submissions`, `Interviews`, `Placements`)
	- Restores `customFieldDefinitions` from Hire Gnome exports before importing dependent records
	- Bullhorn CSV migration batches (`Custom Fields`, `Clients`, `Contacts`, `Candidates`, `Job Orders`, `Submissions`, `Interviews`, `Placements`)
	- Zoho Recruit CSV migration batches (`Clients`, `Contacts`, `Candidates`, `Job Orders`, `Submissions`, `Interviews`, `Placements`)
	- Built-in CSV template downloads per profile plus auto-mapping suggestions for generic CSV headers
	- Generic CSV, Bullhorn CSV, and Zoho Recruit CSV batches run in dependency order so related records can be linked during migration
- Global search with cross-entity results
- In-app notifications, unsaved-change navigation guard, archive/restore flows
- Per-list column chooser with per-user persisted visibility/order preferences, hidden-by-default optional columns, drag-and-drop ordering, and cross-device continuity
- Per-list saved views with named filter/sort/column layouts and personal defaults that persist per user across devices
- Mobile-aware list/detail layouts

## User Documentation
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- End-user guide: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- Module guides: [`docs/modules`](docs/modules)
- Operations runbook: [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- In-app help route: `/help` and `/help/[module]`
- Reports access rules:
	- `Administrator`: all data
	- `Director`: division-scoped data
	- `Recruiter`: own data only

## Changelog
- See [`CHANGELOG.md`](CHANGELOG.md) for dated release notes and daily change summaries.

## Quick Start

### Prerequisites
- Node.js `20.x` (see `.nvmrc`)
- npm `10+`
- MySQL `8+` (local install or Docker)

### 1) Clone And Install
```bash
git clone <your-repo-url> hire-gnome-ats
cd hire-gnome-ats
nvm use || true
npm install
cp .env.example .env
```

### 2) Configure `.env` Minimums
```env
DATABASE_URL="mysql://root:password@localhost:3306/ats"
AUTH_SESSION_SECRET="replace-with-a-long-random-secret"
AUTH_APP_BASE_URL="http://localhost:3000"
```

### 3) Start MySQL
Local MySQL:
```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS ats;"
```

Docker MySQL:
```bash
npm run db:up
```
Then set:
```env
DATABASE_URL="mysql://ats:ats@localhost:3307/ats"
```

### 4) Bootstrap And Run
```bash
npm run bootstrap
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).  
On a fresh DB you are redirected to `/setup`.

If you are upgrading an existing DB, apply migrations first:
```bash
npx prisma migrate deploy
```

## Hosted Docker Deployment

The hosted Compose stack runs one isolated Hire Gnome instance with:
- the application,
- MySQL 8.4,
- Caddy with automatic HTTPS,
- daily database backups with retention pruning,
- persistent volumes for MySQL, local attachments, generated exports, backups, and Caddy state.

Prerequisites:
- a Linux host with Docker Engine and Docker Compose,
- ports `80` and `443` open,
- a DNS `A`/`AAAA` record for the customer hostname pointing to the host.

Copy the example and edit the customer's single private configuration file:
```bash
cp hosted-instance.example.json hosted-instance.json
chmod 600 hosted-instance.json
```

Set the domain, database passwords, runtime secrets, administrator, users, SMTP, S3, OpenAI, Stripe, and operational values directly in `hosted-instance.json`. Replace every applicable `CHANGE_ME_...` value. This JSON file is the customer instance's source of truth.

Start the instance by feeding that JSON file to the hosted launcher:
```bash
npm run hosted:up -- --config hosted-instance.json
```

The launcher validates the JSON, generates Docker Compose's private runtime environment, mounts the original JSON into the application container, and starts the stack. You do not manually create or edit `.env.hosted`.

Verify it:
```bash
npm run hosted:status -- --config hosted-instance.json
curl -fsS https://ats.customer.example/api/health
```

The application container waits for MySQL, deploys Prisma migrations, reconciles the hosted JSON, and then starts Next.js. The JSON can configure branding, first-run users, SMTP, S3-compatible storage, OpenAI, Google Maps, billing runtime values, monitoring hooks, and operational settings.

Configuration reconciliation rules:
- A missing section or property leaves the current database-backed setting unchanged.
- A newly supplied or changed integration property is applied the next time `hosted:up` is run with the JSON.
- An explicit `null` clears a nullable integration property.
- A new user email is created.
- An existing user email is never overwritten.
- A named missing division is created; an existing division is reused.
- Stripe customer/subscription objects are never created or cancelled by reconciliation; the supplied identifiers tell Hire Gnome which existing Stripe resources to use.

For example, Stripe can be omitted initially with `"billing": { "enabled": false }`. After creating the Stripe customer and subscription, add their identifiers to `hosted-instance.json`, then run:
```bash
npm run hosted:up -- --config hosted-instance.json
```

Run one manual synchronization from the Admin Billing screen after first enabling billing so the subscription seat quantity matches the already-provisioned users.

After the first verified login:
1. Change the administrator password from `Account Settings`.
2. Have every additional user change their initial password.
3. Remove the provisioned entries from the `users` array in `hosted-instance.json`.
4. Set `admin.provisioningEnabled` to `false` and remove `admin.password` from `hosted-instance.json`.
5. Run `npm run hosted:up -- --config hosted-instance.json` again.

The generated `.env.hosted` is an internal artifact. Edit `hosted-instance.json`, not `.env.hosted`.

Common operations:
```bash
npm run hosted:logs -- --config hosted-instance.json
npm run hosted:backup -- --config hosted-instance.json
npm run hosted:down -- --config hosted-instance.json
```

To update a customer instance, set `instance.image` in `hosted-instance.json` to a pinned published image tag and run:
```bash
npm run hosted:pull -- --config hosted-instance.json
npm run hosted:up -- --config hosted-instance.json
```

Important:
- Keep `hosted-instance.json` private and backed up in a secure secret store.
- Keep `operations.emailTestMode` set to `true` until outbound email has been verified.
- The included backup volume protects against application/container replacement, but copy backups off-host to protect against server loss.
- Local attachment storage is durable in the included volume. Configure S3-compatible object storage in Admin settings when off-host file durability is required.
- The default `hosted:up` flow assumes one customer stack per host because Caddy owns ports `80` and `443`.
- To run multiple stacks on one host, use unique Compose project names and `APP_PORT` values, leave the `proxy` profile disabled, and route the customer domains through one shared host-level reverse proxy.

## Onboarding And First Login
- There is no hardcoded seeded default admin user.
- Optional bootstrap provisioning can create a default admin from `.env` when DB has zero users.
- First user is created in onboarding (`/setup`) and becomes `Administrator`.
- Onboarding sets initial branding and theme.

Quick smoke test after first login:
1. Open `Admin Area > System Settings > System Diagnostics` and run diagnostics.
2. Create a Client.
3. Create a Contact linked to that Client.
4. Create a Job Order linked to that Client/Contact.
5. Create a Candidate.
6. Create a Submission for Candidate + Job Order.

## Configuration Model

### Admin UI Configuration (Database-backed)
Use `Admin Area > System Settings` for:
- Site name, logo, theme
- Public careers hero headline/body copy
- Career site enabled/disabled
- Client review portal enabled/disabled
- Google Maps API key
- OpenAI API key
- Bullhorn API credentials for background export jobs
- SMTP settings
- Object storage settings (`s3` or local mode)
- API error log retention days
- Operational-data purge with typed confirmation in the `Diagnostics` tab

When `DEMO_MODE` is enabled:
- administrators can still save the full branding card
- integrations, SMTP, and object storage settings remain read-only
- authenticated visitors see a workspace-request CTA; after 8 active minutes across 3 main sections, a conversion prompt offers a Formspark-backed private-workspace request form

System settings are split into:
- `Branding`
- `Platform Settings`

Use `Admin Area > Custom Fields` for:
- Module-scoped custom fields on Candidates, Clients, Contacts, Job Orders, Submissions, Interviews, and Placements
- Field-level validation (`text`, `long text`, `number`, `date`, `yes/no`, `select`)
- Required field enforcement on create/update forms

Use `Admin Area > Data Export` for:
- Export format selection (`JSON`, `NDJSON`, `ZIP`)
- Optional inclusion of audit trail and API error logs
- Incremental date-range exports using `updatedAt` (fallback `createdAt`)
- Export payload includes `customFieldDefinitions` so custom schema can be moved across instances
- Bullhorn API batch ZIP export for custom field definitions, clients, contacts, contact notes, candidates (including structured candidate skills), candidate notes, candidate education, candidate work history, candidate files/resumes, job orders, submissions, interviews, and placements
- Bullhorn export filters by created/updated date range and expands upstream dependencies so the exported batch stays importable
- Bullhorn export now also supports a preflight window estimate so administrators can see changed core-row counts by entity before starting a background job
- Bullhorn export keeps the run sample-sized with a per-entity changed-row limit before dependency expansion
- Bullhorn exports now run as background jobs in the admin UI, notify the requesting user when ready, and can be downloaded or opened in the import preview flow from the completed job
- Saved Bullhorn credentials can be managed in `Admin Area > System Settings > Platform Settings` so administrators do not have to re-enter them for each export
- Completed, cancelled, or failed Bullhorn export jobs can be deleted from the exports screen after confirmation

Submission workflows include a print-friendly `Submission Packet` from submission detail for internal review or browser PDF export. The packet compiles the recruiter write-up, primary resume link, candidate snapshot, cached match explanation, and recent interview prep/questions.

Use `Admin Area > Data Import` for:
- Source selection:
	- Hire Gnome export (`JSON`, `NDJSON`, `ZIP`)
	- Generic CSV migration batch with field mapping
	- Bullhorn CSV migration batch
	- Zoho Recruit CSV batch
- Hire Gnome import applies `customFieldDefinitions` first, then entity records
- Entity profile selection for CSV imports
- Generic CSV batch upload with per-file entity selection, auto-suggested field matches, and ordered apply
- Bullhorn batch upload with per-file entity review and ordered apply
- Bullhorn import/export preserves Bullhorn custom field definitions and record-level custom field values when the source includes them
- Bullhorn import/export now also carries candidate notes, candidate education, candidate work history, contact notes, and structured candidate skills inside the batch flow
- Bullhorn export/import now also carries candidate attachment files, including resumes, inside the ZIP batch when Bullhorn exposes downloadable candidate files
- Zoho Recruit batch upload with per-file entity review and ordered apply
- Generic CSV preview now acts as a safety check with per-entity create/update/skip counts, relationship warnings, row-level actions, match-reason visibility, and tabbed inspection before apply
- Every import source type now includes an in-app sample download link, including ZIP-ready sample batches for Generic CSV, Bullhorn, Zoho Recruit, and Hire Gnome export testing
- `docs/import-samples/bullhorn-batch/` contains a clean Bullhorn-style sample batch with `customFieldDefinitions`, the core entity CSVs, note/education/work-history metadata CSVs, and a candidate resume/file payload for ZIP/manual importer demos
- `docs/import-samples/zoho-recruit-batch/` contains a clean seven-file Zoho Recruit-style sample batch for ZIP/manual importer demos
- Import preview before apply
- Profile template CSV download from the UI

### `.env` Configuration
Use `.env` for:
- Core runtime (`DATABASE_URL`, auth/session settings)
- Rate limits and security throttles
- Email safety routing (`EMAIL_TEST_MODE`, `EMAIL_TEST_RECIPIENT`)
- Ops and diagnostics knobs (backup/logging/alerts/preflight)

### Important Notes
- If object storage settings are missing or invalid, file upload falls back to local storage.
- `EMAIL_TEST_MODE=true` routes outgoing emails to `EMAIL_TEST_RECIPIENT`.
- For socket-based MySQL, include socket in `DATABASE_URL`, for example:
	- `mysql://root:password@localhost:3306/ats?socket=/tmp/mysql.sock`

## Environment Reference

### Required Variables
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Prisma/MySQL connection string. |
| `AUTH_SESSION_SECRET` | Yes | Secret used to sign auth session cookies/tokens. Use a strong random value. |
| `AUTH_APP_BASE_URL` | Yes | Absolute app URL used for auth/reset links. |

### Optional Variables

#### Build And Runtime Behavior
| Variable | Default | Purpose |
|---|---|---|
| `SKIP_SYSTEM_SETTINGS_DB_DURING_BUILD` | `true` | Skips DB reads for system settings during production build to avoid SSG build-time DB coupling. |
| `LOG_LEVEL` | `info` | App log level (`debug`, `info`, `warn`, `error`). |
| `API_ERROR_LOG_RETENTION_DAYS` | `90` | Baseline retention window for API error logs. Admin UI can override in DB. |

#### Auth And Session Controls
| Variable | Default | Purpose |
|---|---|---|
| `AUTH_DEFAULT_PASSWORD` | `Welcome123!` | Temporary default password marker for change-password enforcement flows. |
| `AUTH_SESSION_MAX_AGE_SECONDS` | `43200` | Session lifetime in seconds (12 hours by default). |
| `AUTH_LOGIN_MAX_ATTEMPTS` | `5` | Max failed login attempts before lockout. |
| `AUTH_LOGIN_LOCKOUT_MINUTES` | `15` | Lockout duration after failed login threshold. |
| `AUTH_LOGIN_RATE_LIMIT_MAX_REQUESTS` | `20` | Login endpoint requests allowed in window. |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `900` | Login endpoint rate-limit window size. |
| `AUTH_PASSWORD_RESET_TOKEN_TTL_MINUTES` | `60` | Password reset token expiration window. |
| `AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX_REQUESTS` | `6` | Forgot-password requests allowed in window. |
| `AUTH_FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS` | `900` | Forgot-password rate-limit window size. |
| `AUTH_RESET_PASSWORD_RATE_LIMIT_MAX_REQUESTS` | `10` | Reset-password submission attempts allowed in window. |
| `AUTH_RESET_PASSWORD_RATE_LIMIT_WINDOW_SECONDS` | `900` | Reset-password rate-limit window size. |
| `CLIENT_PORTAL_SECRET` | falls back to `AUTH_SESSION_SECRET` | Optional dedicated secret for client-review portal magic links. |

#### Rate Limit And Abuse Controls
| Variable | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_SECRET` | falls back to `AUTH_SESSION_SECRET` | Secret salt for hashing requester IPs in throttle tables. |
| `CAREERS_APPLY_RATE_LIMIT_MAX_REQUESTS` | `6` | Public career apply requests allowed per window. |
| `CAREERS_APPLY_RATE_LIMIT_WINDOW_SECONDS` | `900` | Career apply rate-limit window size. |
| `CAREERS_APPLY_MIN_FORM_FILL_SECONDS` | `2` | Minimum client-side form fill time accepted for public apply (anti-bot guard). |
| `LOOKUP_RATE_LIMIT_MAX_REQUESTS` | `80` | Max lookup/typeahead requests per window. |
| `LOOKUP_RATE_LIMIT_WINDOW_SECONDS` | `60` | Lookup/typeahead rate-limit window size. |
| `GLOBAL_SEARCH_RATE_LIMIT_MAX_REQUESTS` | `30` | Max global search requests per window. |
| `GLOBAL_SEARCH_RATE_LIMIT_WINDOW_SECONDS` | `60` | Global search rate-limit window size. |
| `CANDIDATE_MATCH_RATE_LIMIT_MAX_REQUESTS` | `20` | Candidate-match endpoint max requests per window. |
| `CANDIDATE_MATCH_RATE_LIMIT_WINDOW_SECONDS` | `60` | Candidate-match rate-limit window size. |
| `JOB_ORDER_MATCH_RATE_LIMIT_MAX_REQUESTS` | `20` | Job-order-match endpoint max requests per window. |
| `JOB_ORDER_MATCH_RATE_LIMIT_WINDOW_SECONDS` | `60` | Job-order-match rate-limit window size. |
| `MUTATION_RATE_LIMIT_MAX_REQUESTS` | `120` | Max mutation (create/update/delete-like) requests per window. |
| `MUTATION_RATE_LIMIT_WINDOW_SECONDS` | `60` | Mutation rate-limit window size. |
| `RESUME_PARSE_RATE_LIMIT_MAX_REQUESTS` | `30` | Resume parsing requests allowed per window. |
| `RESUME_PARSE_RATE_LIMIT_WINDOW_SECONDS` | `600` | Resume parsing rate-limit window size. |
| `REQUEST_THROTTLE_GLOBAL_CLEANUP_INTERVAL_SECONDS` | `300` | Frequency for global throttle cleanup sweeps. |
| `REQUEST_THROTTLE_GLOBAL_CLEANUP_SECONDS` | `3600` | Minimum age threshold for throttle-event cleanup candidates. |

#### Email Safety Routing
| Variable | Default | Purpose |
|---|---|---|
| `EMAIL_TEST_MODE` | `true` | If `true`, all outbound emails are redirected to test recipient. |
| `EMAIL_TEST_RECIPIENT` | empty | Address that receives all emails when test mode is on. |

#### AI And Parsing
| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_RESUME_MODEL` | `gpt-4o-mini` | Model used for resume parsing/enrichment calls when OpenAI key exists in system settings. |

#### File Storage
| Variable | Default | Purpose |
|---|---|---|
| `LOCAL_STORAGE_ROOT` | `.local-storage` under project root | Local fallback storage path when object storage is not configured/available. |

#### Backups, Health, And Alerting
| Variable | Default | Purpose |
|---|---|---|
| `DB_BACKUP_DIR` | `.backups` | Directory used by backup scripts and diagnostics checks. |
| `DB_BACKUP_RETENTION_DAYS` | `14` | Retention policy for scheduled backup cleanup. |
| `POSTMARK_INBOUND_WEBHOOK_SECRET` | empty | Optional shared secret for `/api/inbound/postmark` via query string or header. |
| `ERROR_ALERT_WEBHOOK_URL` | empty | Webhook endpoint for runtime/API error alerts. |
| `ERROR_ALERT_MIN_LEVEL` | `error` | Minimum log severity that triggers error webhook alert. |
| `ERROR_ALERT_COOLDOWN_SECONDS` | `300` | Alert cooldown period to suppress webhook spam. |
| `ERROR_ALERT_SOURCE` | `hire-gnome-ats` | Source label included in error alert payloads. |
| `HEALTH_ALERT_WEBHOOK_URL` | empty | Webhook endpoint for health-check failures. |
| `HEALTH_ALERT_SOURCE` | `hire-gnome-ats` | Source label included in health alert payloads. |

#### Papertrail Logging (Optional)
| Variable | Default | Purpose |
|---|---|---|
| `PAPERTRAIL_HOST` | empty | Papertrail syslog host. When empty, Papertrail shipping is disabled. |
| `PAPERTRAIL_PORT` | empty | Papertrail UDP syslog port. Required with `PAPERTRAIL_HOST` to enable shipping. |
| `PAPERTRAIL_MIN_LEVEL` | `info` | Minimum log level forwarded to Papertrail (`debug`, `info`, `warn`, `error`). |
| `PAPERTRAIL_APP_NAME` | `hire-gnome-ats` | App name tag in Papertrail log lines. |
| `PAPERTRAIL_FACILITY` | `16` | Syslog facility code (`0-23`), defaults to `local0` (`16`). |

#### CI/Preflight Controls
| Variable | Default | Purpose |
|---|---|---|
| `PREFLIGHT_SKIP_DB_CONNECTIVITY` | `false` | Skips DB connectivity test in `npm run ci:preflight` when true. |
| `PREFLIGHT_DB_RETRIES` | `1` | Number of retries for DB connectivity check in preflight. |
| `PREFLIGHT_DB_RETRY_DELAY_MS` | `2500` | Delay between DB connectivity retries in preflight. |

#### Demo Reset Scheduler
| Variable | Default | Purpose |
|---|---|---|
| `DEMO_MODE` | `false` | Enables demo UI behavior (system settings read-only + demo credentials shown on login). |
| `DEMO_WORKSPACE_FORMSPARK_URL` | empty | Server-only Formspark action URL used by the demo workspace-request form. |
| `DEMO_ADMIN_EMAIL` | `admin@demoats.com` | Demo admin email shown on login when demo mode is enabled. |
| `DEMO_RECRUITER_EMAIL` | `recruiter@demoats.com` | Demo recruiter email shown on login when demo mode is enabled. |
| `DEMO_LOGIN_PASSWORD` | `Welcome123!` | Demo login password shown on login when demo mode is enabled. |
| `DEMO_RESET_INTERVAL_MINUTES` | `360` | Interval used by `npm run demo:reset:loop`. |
| `DEMO_RESET_RUN_ON_START` | `true` | If true, the loop script runs one reset immediately on boot. |
| `DEMO_RESET_MODE` | `seed` | Mode used by `demo:reset:loop` (`seed` recommended, `full` is heavier and can show onboarding during reset). |

#### Bootstrap Default Admin
| Variable | Default | Purpose |
|---|---|---|
| `BOOTSTRAP_ADMIN_ENABLED` | `false` | If true, bootstrap creates a default admin when user count is zero. |
| `BOOTSTRAP_ADMIN_FIRST_NAME` | `System` | First name for bootstrap-provisioned admin. |
| `BOOTSTRAP_ADMIN_LAST_NAME` | `Administrator` | Last name for bootstrap-provisioned admin. |
| `BOOTSTRAP_ADMIN_EMAIL` | empty | Email for bootstrap-provisioned admin (required when enabled). |
| `BOOTSTRAP_ADMIN_PASSWORD` | empty | Password for bootstrap-provisioned admin (required when enabled, min 8 chars). |
| `BOOTSTRAP_SITE_NAME` | `Hire Gnome ATS` | Initial site name created with a bootstrap-provisioned administrator. |
| `BOOTSTRAP_THEME_KEY` | `classic_blue` | Initial theme created with a bootstrap-provisioned administrator. |
| `HOSTED_CONFIG_FILE` | empty | Optional versioned hosted-instance JSON reconciled during container startup. |
| `HOSTED_MANAGED_INTEGRATIONS` | `false` | Hides provider-owned SMTP, OpenAI, Google Maps, and object-storage configuration from tenant administrators and blocks API updates. Generated hosted environments set this to `true`. |

#### Hosted Billing (Base + Seats)
| Variable | Default | Purpose |
|---|---|---|
| `BILLING_ENABLED` | `false` | Enables hosted billing seat synchronization. |
| `BILLING_PROVIDER` | `stripe` | Billing provider (`stripe` currently supported). |
| `BILLING_STRIPE_SECRET_KEY` | empty | Stripe API secret key used for billing sync. |
| `BILLING_STRIPE_CUSTOMER_ID` | empty | Stripe customer id (`cus_...`). |
| `BILLING_STRIPE_SUBSCRIPTION_ID` | empty | Stripe subscription id (`sub_...`) containing base + seat items. |
| `BILLING_BASE_PRICE_ID` | empty | Stripe base recurring price id (`price_...`). |
| `BILLING_SEAT_PRICE_ID` | empty | Stripe per-seat recurring price id (`price_...`). |
| `BILLING_STRIPE_SEAT_SUBSCRIPTION_ITEM_ID` | empty | Optional explicit seat subscription item id (`si_...`) for quantity updates. |
| `BILLING_STRIPE_BASE_SUBSCRIPTION_ITEM_ID` | empty | Optional explicit base subscription item id (`si_...`). |
| `BILLING_STRIPE_PRORATION_BEHAVIOR` | `create_prorations` | Seat-change proration behavior (`create_prorations`, `always_invoice`, `none`). |
| `BILLING_CURRENCY` | `usd` | Fallback currency display when Stripe pricing data is unavailable. |

#### External ATS Operations
| Variable | Default | Purpose |
|---|---|---|
| `BULLHORN_OPERATIONS_ENABLED` | `true` | Enables Bullhorn import/export operations in both admin UI and APIs. |
| `ZOHO_RECRUIT_OPERATIONS_ENABLED` | `true` | Enables Zoho Recruit import operations in both admin UI and APIs. |

### Legacy URL Fallbacks (Optional)
These are not in `.env.example` and are only used as fallback link sources:
- `APP_BASE_URL`
- `NEXT_PUBLIC_APP_URL`

`AUTH_APP_BASE_URL` remains the primary setting.

## Scripts

All Node operational scripts in `scripts/` auto-load `.env` (and `.env.local` if present), so manual `source .env` is not required.

| Script | Purpose |
|---|---|
| `npm run dev` | Run Next.js in development mode |
| `npm run build` | Production app build only |
| `npm run build:deploy` | Apply production migrations, then build the app |
| `npm run start` | Start production server |
| `npm run bootstrap` | Validate environment + migration status + deploy migrations |
| `npm run bootstrap:admin` | Provision default admin from bootstrap env vars (only when no users exist) |
| `npm run prisma:migrate` | Create/apply dev migration |
| `npm run db:up` | Start Docker MySQL (`docker-compose.dev.yml`) |
| `npm run db:down` | Stop Docker MySQL |
| `npm run db:logs` | Stream Docker MySQL logs |
| `npm run db:reset` | Stop + remove Docker MySQL volume |
| `npm run db:backup` | One-off DB backup |
| `npm run db:backup:scheduled` | Backup + retention cleanup |
| `npm run db:restore -- --input <file> --drop-first` | Restore SQL backup |
| `npm run demo:seed` | Seed realistic linked demo data (non-destructive to unrelated records) |
| `npm run demo:reset` | Full DB reset + migration + realistic demo reseed |
| `npm run demo:reset:seed-only` | Reseed demo data without full DB reset |
| `npm run demo:reset:loop` | Run automatic periodic demo resets |
| `npm run db:clear:operational` | Clear operational ATS data while preserving users, settings, skills, custom fields, and zip codes |
| `npm run ci:preflight` | Env/DB/backup-path checks |
| `npm run ci:build` | Build wrapper for CI |
| `npm run ci:smoke` | Permission/API smoke checks |
| `npm run ci:test` | Preflight + build composite |
| `npm run health` | Run health-check script |
| `npm run hosted:up -- --config <file>` | Validate one hosted JSON file, then build and start its Docker stack |
| `npm run hosted:status -- --config <file>` | Show the hosted stack status |
| `npm run hosted:pull -- --config <file>` | Pull the configured hosted image |
| `npm run hosted:down -- --config <file>` | Stop the hosted stack without deleting persistent volumes |
| `npm run hosted:logs -- --config <file>` | Follow hosted application logs |
| `npm run hosted:backup -- --config <file>` | Run an immediate hosted database backup |
| `npm run hosted:init -- --domain ... --admin-email ...` | Optional helper that generates the JSON instead of editing the example manually |
| `npm run hosted:user -- --first-name ...` | Optional helper that adds a user to the JSON |

## Operations
- Runbook: [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- Health endpoint: `GET /api/health`
- Admin diagnostics: `Admin Area > System Settings > System Diagnostics`
- Data export: `Admin Area > Data Export` (or `GET /api/admin/data-export` for Hire Gnome snapshots, `POST /api/admin/bullhorn-export-jobs` to queue a Bullhorn export job, `GET /api/admin/bullhorn-export-jobs` to poll job status, `PATCH /api/admin/bullhorn-export-jobs/[recordId]` to cancel a queued/running Bullhorn export job, `DELETE /api/admin/bullhorn-export-jobs/[recordId]` to remove a completed, cancelled, or failed Bullhorn export job)
- Data import: `Admin Area > Data Import` (or `POST /api/admin/data-import`)
- Client review portal management: `Job Order Detail > Actions > Client Review Portal`

Data export query options:
- `format`: `json` | `ndjson` | `zip`
- `includeAuditLogs`: `true`/`false`
- `includeApiErrorLogs`: `true`/`false`
- `dateFrom`: ISO datetime (optional)
- `dateTo`: ISO datetime (optional)

Data import form fields:
- `mode`: `preview` | `apply`
- `sourceType`: `hire_gnome_export` | `generic_csv` | `generic_csv_manual` | `generic_csv_zip` | `bullhorn_csv` | `bullhorn_csv_manual` | `bullhorn_csv_zip` | `zoho_recruit_csv` | `zoho_recruit_manual` | `zoho_recruit_zip`
- `file`: upload file (`.json`, `.ndjson`, `.zip`, or `.csv` based on source)
- `genericBatch`: JSON array of CSV-batch entries containing `entity`, `mapping`, and file field keys (preferred when `sourceType=generic_csv`)
- `genericEntity`: legacy single-file generic entity selector (still accepted when `genericBatch` is not provided)
- `genericMapping`: legacy single-file generic mapping object (still accepted when `genericBatch` is not provided)
- `bullhornEntity`: `customFieldDefinitions` | `clients` | `contacts` | `candidates` | `jobOrders` | `submissions` | `interviews` | `placements` (required when `sourceType=bullhorn_csv`)
- `zohoEntity`: `clients` | `contacts` | `candidates` | `jobOrders` | `submissions` | `interviews` | `placements` (required when `sourceType=zoho_recruit_csv`)

Sample generic migration batch:
- `docs/import-samples/generic-migration-batch/`
- Includes a clean seven-file CSV set in dependency order for demos and importer testing.
- `docs/import-samples/generic-migration-batch-messy/`
- Includes a second seven-file batch with messier legacy column names for mapping demos.

Kanban status update endpoints:
- `PATCH /api/candidates/[id]/status` with `{ "status": "...", "reason": "..." }`
- `PATCH /api/job-orders/[id]/status` with `{ "status": "open|on_hold|closed" }`

Hire Gnome export/import coverage:
- Export includes `customFieldDefinitions`, core entities, and related child records.
- Import upserts `customFieldDefinitions` by `recordId` or `(moduleKey, fieldKey)` before entity rows.
- Import applies `customFields` payload values on supported entities, including Submissions, Interviews, and Placements.

Archive behavior:
- Archive is soft-delete and reversible through the Archive module.
- Certain archive actions can optionally cascade to related records via UI selections during archive flow.

Demo instance reset behavior:
- `demo:reset` preserves `System Settings` (branding/theme/integration keys) by default.
- If no `System Settings` row exists, demo seeding creates one with default branding and enables the public career site.
- Seed creates realistic linked records across all core modules.
- Seeded public job postings include richer, role-aligned career-site descriptions.
- Seed avoids duplicate human-readable names across seeded users, contacts, and candidates.
- Seed-mode reset clears all `customFieldDefinitions` so custom fields do not persist between demo reset cycles.
- Default seeded login users use `AUTH_DEFAULT_PASSWORD`.
- For interval resets, either:
	- run `npm run demo:reset:loop` (uses `DEMO_RESET_INTERVAL_MINUTES`), or
	- schedule `npm run demo:reset` with cron/systemd (for example every 6 hours).

Inbound email webhook:
- Postmark inbound webhook endpoint: `/api/inbound/postmark`
- The route extracts email addresses from the payload, matches `Candidate.email` and `Contact.email`, creates cleaned `Email` notes on matches, and saves supported attachments to matched candidates only.
- Contact matches receive notes only. Attachments are not saved to contacts.
- Duplicate inbound processing is suppressed by Postmark `MessageID`.
- Matching is based on any email addresses found in the inbound JSON payload, including common reply/forward content.
- Candidate attachments are saved only when the inbound payload includes attachment bytes, not just metadata.
- Recent inbound events and attachment skip reasons are visible in `Admin Area > System Settings > System Diagnostics`.

Client review portal:
- The client portal can be disabled globally from `Admin Area > System Settings`.
- Internal users can issue a persistent magic link from `Job Order Detail > Actions > Client Review Portal`.
- Portal access is scoped to the job order's assigned client contact and remains valid for the life of the job unless revoked.
- Internal users can copy, open, email, revoke, or restore the portal link from the job-order modal.
- Portal email sends use a branded HTML invite that follows the selected admin theme, with a direct CTA, job title context, and a plain-text fallback.
- Portal management shows lifecycle analytics for sent, opened, last viewed, acted on, and total client actions logged on job order detail and in the modal.
- Clients can review submitted candidates, read the recruiter write-up, download only the candidate's labeled primary resume, complete a simple scorecard (`Communication`, `Technical Fit`, `Culture Fit`, `Overall Recommendation`), leave comments, request interviews, or pass.
- Client responses are written back to `Submission Detail > Client Feedback` with the structured scorecard and generate in-app plus email notifications for users who keep `Client Feedback Notifications` enabled in `Account Settings`.
- If `POSTMARK_INBOUND_WEBHOOK_SECRET` is set, include it either as `?secret=...` on the webhook URL or as the `x-webhook-secret` header.

## Production Checklist
- Set strong unique values for:
	- `AUTH_SESSION_SECRET`
	- `DATABASE_URL`
	- `AUTH_APP_BASE_URL`
- Set `EMAIL_TEST_MODE=true` during staging/testing.
- Set `EMAIL_TEST_MODE=false` only after SMTP and recipient routing are validated.
- Configure system integrations in Admin settings:
	- SMTP
	- Object storage
	- Google/OpenAI keys as needed
- Run:
	- `npm run ci:preflight`
	- `npm run build:deploy`
- Validate backup and restore before go-live:
	- `npm run db:backup`
	- `npm run db:restore -- --input <backup-file> --drop-first`

## Troubleshooting

### `Unexpected token .` from Prisma CLI
You are running an old Node version. Use Node `20.x`, reinstall dependencies, rerun command.

### `migration ... was modified after it was applied`
Your local migration history drifted. For local development only:
```bash
npx prisma migrate reset
```

### `Unknown argument ...` from Prisma
Schema and database are out of sync. Apply latest migrations:
```bash
npx prisma migrate deploy
```

### Build logs DB socket warnings during SSG
Ensure `SKIP_SYSTEM_SETTINGS_DB_DURING_BUILD=true` (default) so system settings are not read during static build phases.

### Existing browser session loops between `/login` and `/` after deploy
This is usually stale auth cookies after a deploy or secret/session changes.
- Refresh once and retry login.
- If needed, clear site cookies for the app domain (`ats-session`, `ats-acting-user-id`) or open `/api/session/logout`.
- New private/incognito windows are typically unaffected because no stale cookies exist.

### Cannot connect to MySQL
Verify:
- MySQL is running
- `DATABASE_URL` is correct
- database `ats` exists
- socket path is set when using local socket-based MySQL

## Contributing
- Read [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Use issue templates for bugs and feature work
- Use PR template and include migration notes

## Security
- Read [`SECURITY.md`](SECURITY.md)
- Do not open public issues for vulnerabilities

## License
This project is licensed under the GNU Affero General Public License v3.0 (`AGPL-3.0-only`).

- Full text: [`LICENSE`](LICENSE)
- SPDX identifier: `AGPL-3.0-only`
