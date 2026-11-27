# Contributing

Thanks for contributing to Hire Gnome ATS.

## Prerequisites
- Node.js `20.x` (see `.nvmrc`)
- npm `10+`
- MySQL `8+` (local) or Docker (`docker-compose.dev.yml`)

## Local Setup
1. Fork and clone your fork.
2. Install dependencies:
	```bash
	npm install
	```
3. Copy environment file:
	```bash
	cp .env.example .env
	```
4. Start database (choose one):
	- Local MySQL and create `ats` DB
	- Docker:
		```bash
		npm run db:up
		```
5. Bootstrap migrations:
	```bash
	npm run bootstrap
	```
6. Start app:
	```bash
	npm run dev
	```

## Branch + PR Rules
- Keep PRs focused and small.
- Use clear commit messages.
- Include screenshots for UI changes.
- Mention DB schema/migration impact clearly.

## Checks Before PR
```bash
npm run ci:preflight
npm run build
```

## Run the API integration test locally

This test checks the [public API v1](docs/integration-api-v1.md).


Apply the migrations to a disposable local MySQL database named
`hg_api_qa_<suffix>`. Start a local Hire Gnome instance using that database,
then set `HIRE_GNOME_API_TEST_DATABASE_URL` to its database URL and
`HIRE_GNOME_API_TEST_URL` to its HTTP address. Run
`node --test tests/integration-api-v1.test.cjs` from the repository root. The test
creates fixture records and credentials in that database.

## Coding Style
- Use tabs for indentation.
- Preserve existing architecture patterns.
- Avoid unrelated refactors in feature PRs.

## Migrations
- If you change Prisma schema, include a migration.
- Never edit already-applied migration files.
- For local drift in development only:
	```bash
	npx prisma migrate reset
	```
