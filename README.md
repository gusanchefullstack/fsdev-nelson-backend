# Nelson API

REST API for **Nelson**, a personal budget app that splits every planned income and expense into
date-bounded "buckets" and drops each real transaction into the right one — so you can see, per
paycheck and per bill, whether your plan is holding.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-Neon-4169E1?logo=postgresql&logoColor=white)

> Frontend: [fsdev-nelson-frontend](https://github.com/gusanchefullstack/fsdev-nelson-frontend) ·
> Specs: `nelson-app-v0.1` (spec-driven development with GitHub Spec Kit)

## Table of Contents

- [Why Nelson?](#why-nelson)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [How buckets work](#how-buckets-work)
- [Project Structure](#project-structure)
- [Tests](#tests)
- [Deployment](#deployment)
- [What I learned](#what-i-learned)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)
- [Author](#author)

## Why Nelson?

Most budget apps compare monthly totals, which hides *when* things go wrong: a late paycheck or a
double-charged subscription disappears in the sum. Nelson tracks each expected payment in its own
time window, keeps account balances in sync with every transaction, forecasts where the period
will land and raises alerts the moment an item drifts beyond the threshold you choose.

## Installation

**Prerequisites:** Node.js ≥ 24, npm, a [Neon](https://neon.tech) Postgres project (Postgres 15+
for `NULLS NOT DISTINCT`).

```bash
git clone git@github.com:gusanchefullstack/fsdev-nelson-backend.git
cd fsdev-nelson-backend
npm install                 # also generates the Prisma client
cp .env.example .env        # fill in the values below
npm run db:migrate          # applies the schema and the raw-SQL constraints
npm run dev                 # http://localhost:3000
```

For integration tests create a second Neon branch and put its connection strings in `.env.test`.

## Quick Start

Sign up (Better Auth), complete the profile, then create a budget and record a transaction:

```bash
# 1. Sign up — keeps the session cookie in cookies.txt
curl -c cookies.txt -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"Passw0rd!","name":"ana","username":"ana"}' \
  http://localhost:3000/api/auth/sign-up/email

# 2. Create a 2027 USD budget (an "Unplanned" income and expense category is added automatically)
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"name":"Household 2027","currency":"USD","startDate":"2027-01-01","endDate":"2027-12-31"}' \
  http://localhost:3000/api/v1/budgets
```

```json
{
  "id": "01a0f631-e7c5-7189-9771-177c20c59646",
  "name": "Household 2027",
  "currency": "USD",
  "startDate": "2027-01-01",
  "endDate": "2027-12-31",
  "alertThresholdPct": 10,
  "isActive": false,
  "totals": { "expectedIncomeToDate": "0.00", "actualIncomeToDate": "0.00", "expectedExpenseToDate": "0.00", "actualExpenseToDate": "0.00", "unbudgetedIncome": "0.00", "unbudgetedExpense": "0.00" },
  "categories": [{ "kind": "INCOME", "name": "Unplanned", "isSystem": true, "items": [ … ] }, …]
}
```

(Profile completion is required first — `PUT /api/v1/me/profile`; otherwise the API answers
`403 PROFILE_INCOMPLETE`.)

## Configuration

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | Neon **pooled** connection string used at runtime | Yes | — |
| `DIRECT_URL` | Neon **direct** connection string used by Prisma migrations | Yes (migrations) | — |
| `BETTER_AUTH_SECRET` | Session signing secret, ≥ 32 characters (`openssl rand -base64 32`) | Yes | — |
| `BETTER_AUTH_URL` | Public URL the browser uses to reach the API (the frontend origin in production, via rewrite) | Yes | — |
| `FRONTEND_ORIGIN` | Allowed browser origin | Yes | — |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for avatar uploads; without it, preset avatars still work | No | — |
| `LOG_LEVEL` | pino log level | No | `info` |
| `PORT` | Local port | No | `3000` |

## API Reference

The full contract is [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1). Highlights:

| Area | Endpoints |
|------|-----------|
| Auth (Better Auth) | `POST /api/auth/sign-up/email`, `/sign-in/email`, `/sign-in/username`, `/sign-out` |
| Profile | `GET /api/v1/me`, `PUT /me/profile`, `PUT /me/avatar`, `PATCH /me/preferences` |
| Money sources | `/financial-accounts`, `/payors`, `/vendors` (CRUD; in-use records can't be deleted) |
| Budgets | `/budgets` (Lite or full tree), `/budgets/:id`, `/budgets/:id/categories`, `/categories/:id/items`, `/items/:id`, `…/deletion-impact` |
| Transactions | `GET/POST /transactions`, `GET/PUT/DELETE /transactions/:id` (filters + keyset pagination) |
| Dashboard | `GET /dashboard` |
| Reports | `/budgets/:id/reports/forecast-vs-actual`, `/top`, `/projection`, `/insights` |
| Alerts | `GET /alerts`, `PATCH /alerts/:id`, `POST /alerts/read-all` |

### `POST /api/v1/transactions`

```json
{
  "kind": "EXPENSE",
  "amount": "5000.00",
  "currency": "USD",
  "occurredAt": "2027-03-18T10:00:00-05:00",
  "itemId": "01a0f631-…",
  "financialAccountId": "01a0f632-…",
  "vendorId": "01a0f633-…"
}
```

**201** — the transaction, the bucket it landed in, and any alerts it raised:

```json
{
  "transaction": { "localDate": "2027-03-18", "timeZone": "America/Bogota", "itemName": "Rent", "origin": { "name": "Main Checking", "type": "FINANCIAL_ACCOUNT" }, "destination": { "name": "Landlord", "type": "VENDOR" }, … },
  "bucket": { "startDate": "2027-03-05", "endDate": "2027-04-04", "estimatedAmount": "5000.00", "actualAmount": "5000.00", "status": "FUTURE", "over": false },
  "newAlerts": []
}
```

**Errors** always look like this — the message is safe to show to users:

```json
{ "error": { "code": "OUTSIDE_ITEM_RANGE", "message": "\"Rent\" runs from 2027-01-01 to 2027-12-31. Choose a date in that range, or adjust the item's dates.", "fields": { "occurredAt": "Outside the item dates" }, "requestId": "01a0f6…" } }
```

## How buckets work

Each budget item (amount, first expected date, frequency) is split into contiguous,
non-overlapping windows. Bucket *k* starts half a period before its expected date — so a monthly
rent due on the 20th gets buckets from the 5th to the 4th of the next month. Dates are computed
with the **Temporal API** (`PlainDate`), adding *k* × the period to the original date so the 31st
never drifts. A transaction is placed in the bucket containing its local date in the time zone
where it was recorded.

## Project Structure

```text
prisma/
├── schema.prisma          # Data model (all tables have createdAt/updatedAt)
└── migrations/            # Includes raw SQL: budget overlap exclusion, active-alert uniqueness
src/
├── app.ts                 # Express app (Better Auth mounted before express.json)
├── server.ts              # Local listener
├── config/env.ts          # Zod-validated environment
├── domain/                # Pure rules: buckets, allocation, totals, forecast, alerts
├── lib/                   # Prisma (Neon adapter), auth, Temporal and money helpers, logger
├── middleware/            # Session/profile guards, validation, error handler, request id
└── modules/               # One folder per resource: routes + schemas + service
tests/
├── unit/                  # Domain logic (bucket reference set, forecast, alerts)
└── integration/           # API against a Neon test branch
scripts/seed-perf.ts       # 50 items / 2,000 transactions performance check
docs/openapi.yaml          # API contract
```

## Tests

Vitest + Supertest.

```bash
npm test                    # unit tests (domain logic)
npm run test:integration    # API tests against the Neon `test` branch (.env.test)
npm run perf                # seeds 2,000 transactions and times dashboard/report endpoints
npm run lint && npm run typecheck
```

## Deployment

Deployed to **Vercel** as its own project (zero-config Express). The frontend's Vercel project
rewrites `/api/*` here, so session cookies stay first-party. Before the first deploy run
`npm run db:deploy` against the production Neon branch and set the variables above in Vercel.

## What I learned

- **Driver adapters change error shapes.** With `@prisma/adapter-neon`, unique-violation metadata
  is nested differently, so the error handler searches the whole metadata instead of
  `meta.target`.
- **Cascades + RESTRICT don't mix in one statement.** Transactions cascade from their item but
  restrict their bucket; deletes reverse balances and delete transactions explicitly first.
- **Partial unique indexes as a de-duplication tool.** `UNIQUE … NULLS NOT DISTINCT WHERE
  "clearedAt" IS NULL` plus `INSERT … ON CONFLICT DO NOTHING` keeps exactly one active alert per
  condition without aborting the surrounding transaction.
- **Batch work inside interactive transactions.** Evaluating alerts one bucket at a time blew the
  5 s transaction timeout on a cold start; a constant number of queries fixed it.
- **Temporal over Date** for plain dates and time zones: [TC39 Temporal docs](https://tc39.es/proposal-temporal/docs/).
- References: [Express 5](https://expressjs.com/en/guide/migrating-5.html) ·
  [Prisma 7 + Neon](https://www.prisma.io/docs/orm/overview/databases/neon) ·
  [Better Auth](https://www.better-auth.com/docs) ·
  [Postgres exclusion constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-EXCLUSION)

## Roadmap

- [x] Budgets, categories, recurring items and buckets
- [x] Accounts, payors, vendors and transactions with live balances
- [x] Dashboard, forecast vs actual, top N, projection and insights
- [x] Threshold alerts
- [ ] Receipt capture with AI field extraction
- [ ] Bank sync through an aggregator (e.g. Plaid)
- [ ] Smart Advisor
- [ ] Administrator role
- [ ] More currencies

## Contributing

1. Fork and create a branch: `feat/short-description` or `fix/short-description`.
2. Commit with [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` …).
3. Run `npm run lint && npm run typecheck && npm test && npm run test:integration`.
4. Open a pull request describing the change and the spec requirement it serves.

## License

Distributed under the MIT License. See [LICENSE](LICENSE).

## Credits

Built with [Express](https://expressjs.com), [Prisma](https://www.prisma.io),
[Neon](https://neon.tech), [Better Auth](https://www.better-auth.com), [Zod](https://zod.dev),
[temporal-polyfill](https://github.com/fullcalendar/temporal-polyfill) and
[pino](https://getpino.io). Specified with [GitHub Spec Kit](https://github.com/github/spec-kit).

## Author

**Gustavo Sanchez Galarza**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/gustavosanchezgalarza/)
[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/gusanchefullstack)
[![Hashnode](https://img.shields.io/badge/Hashnode-2962FF?logo=hashnode&logoColor=white)](https://hashnode.com/@gusanchedev)
[![X](https://img.shields.io/badge/X-000000?logo=x&logoColor=white)](https://x.com/gusanchedev)
[![Bluesky](https://img.shields.io/badge/Bluesky-0285FF?logo=bluesky&logoColor=white)](https://bsky.app/profile/gusanchedev.bsky.social)
[![freeCodeCamp](https://img.shields.io/badge/freeCodeCamp-0A0A23?logo=freecodecamp&logoColor=white)](https://www.freecodecamp.org/gusanchedev)
[![Frontend Mentor](https://img.shields.io/badge/Frontend%20Mentor-3F54A3?logo=frontendmentor&logoColor=white)](https://www.frontendmentor.io/profile/gusanchefullstack)
