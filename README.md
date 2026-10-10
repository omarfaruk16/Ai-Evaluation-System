# AI Marking Service

A standalone service that drafts marking rubrics and marks written exam answers with an LLM,
for teachers to approve. It runs on its own server with its own PostgreSQL and Redis, and any
project connects to it over an authenticated HTTP API. The e-Exam system is the first client.

- **Model:** DeepSeek V4 Flash 0731 through OpenRouter, pinned to zero-data-retention fp8 hosts
  (DeepInfra, then Parasail), strict JSON output, reasoning off. All of it is configurable.
- **What it returns per answer:** marks per rubric criterion, a total, why-this-mark, strong and weak
  points, highlights positioned on the answer text, missing points, and student feedback.
- **The AI only suggests.** Clients store results as suggestions; a teacher's approval makes a mark.

API reference for client projects: [docs/API.md](docs/API.md). Build plan and status:
[CHECKLIST.md](CHECKLIST.md). The operator console (models, clients, pricing, billing) is at
`/console` — see [Operator console](#operator-console).

## How it works

```
client project ──HTTPS──▶ API (NestJS) ──▶ PostgreSQL   (questions, evaluations, usage ledger)
                              │
                              └──▶ Redis / BullMQ ──▶ worker(s) ──▶ OpenRouter ──▶ model host
                                                          │
client project ◀──signed webhook──────────────────────────┘
```

- `POST /v1/evaluations` stores answers and queues them. Small groups and the first answers of each
  question go to the **realtime** queue; the bulk of a large exam goes to the **deferred** queue,
  which drains at a steady rate so busy hours spread out.
- Workers call the model, validate the JSON, recompute marks server-side (clamped, rounded to the
  mark step), locate highlight quotes in the answer, save, and send an HMAC-signed webhook.
- Blank answers, too-long answers and answers identical to one already marked never reach the model.
- Every model call (failures included) is written to a usage ledger with tokens and cost. Each
  client project can have a monthly budget.

## Run locally

Needs Node 22+, pnpm and Docker.

```bash
docker compose up -d                     # Postgres on 5440, Redis on 6390
cp .env.example .env                     # LLM_PROVIDER=mock: no key, no cost
pnpm install
pnpm exec prisma migrate deploy
pnpm client:create --name local-dev      # prints an API key once (or create clients in the console)
pnpm admin:create --email you@example.com --name "You"   # console account; asks for a password
pnpm dev                                 # API on :4200, with embedded workers
pnpm console:install && pnpm console:dev # console on :5180/console (proxies /admin-api to :4200)
```

The mock model marks by keyword overlap. It's deterministic and free, for development and tests.
To use the real model locally, set `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY` in `.env`.

Try it:

```bash
curl -s localhost:4200/health
curl -s -X POST localhost:4200/v1/rubrics/draft \
  -H "Authorization: Bearer $AI_MARKING_API_KEY" -H 'Content-Type: application/json' \
  -d '{"question":"Explain TCP reliability.","modelAnswer":"Sequence numbers and ACKs; retransmission on timeout; checksum.","maxMarks":6}'
```

## Operator console

A web console for running the service as a business, served by the API at `/console`
(`pnpm console:build` puts the files in `console/dist`; the Docker image builds them). It has its
own admin accounts — separate from client API keys — created with `pnpm admin:create` (or
`node dist/cli/create-admin.js` in the image; `--generate` prints a random password once, `--reset`
changes one).

| Page | What you do there |
|---|---|
| **Overview** | Answers marked, AI cost, what you billed this month, teacher agreement (accepted vs adjusted), model response time and queue health. |
| **Projects** | One per customer system that uses the API. Create one to get its API key (shown once, masked, copy only), set its pricing plan, billing contact and AI cost cap, see whether it is connected (last API call, webhook), rotate keys, disable it. |
| **Statements** | Per client per month: answers, billable answers, rubric drafts, subtotal, tax, total, your AI cost and margin. CSV export. |
| **Invoices** | Freeze a statement into a numbered invoice (`AMS-2026-0001`), issue it, mark it paid or void, print / save as PDF. Invoices keep their prices, exchange rate and business details. |
| **Pricing plans** | *Per answer* (monthly fee + included answers + price per extra answer) or *AI cost + markup*; rubric-draft price; free or charged blank and reused answers; tax. Live example month with your margin. |
| **Quote calculator** | For a new client: students, exams, questions, answer length and language → your cost per answer (measured from real traffic once there are 50+ answers, otherwise estimated from model prices), what they pay per month and per student, margin, break-even, and a copy-ready quote. |
| **Models & providers** | Model profiles: OpenRouter (live host list with prices, quantization and uptime; pin hosts; ZDR), any other OpenAI-compatible API, or the mock. Assign a profile per task (marking, rubric drafts, feedback rewrites) — every process picks it up within 10 s, no restart. Test a profile on a sample answer; see OpenRouter key usage and credits. |
| **Playground** | Draft a rubric and mark an answer with any profile; see the highlighted result, tokens, cost, latency, the exact prompt and the raw output. |
| **Evaluations / Webhooks / System** | Every evaluation with its model calls and cost; re-run one. Webhook deliveries with retry. Queues with pause/resume, failed jobs, configuration. |
| **Settings** | Business details and payment instructions for invoices, exchange rates (USD → BDT …), billing time zone, console admins, your password and sessions. |

**Selling the API to a new customer.** Console → Projects → *New project* (pick their pricing
plan) → copy the API URL and key from the dialog and give them to the customer's administrator
privately. In the e-Exam system they open **AI Marking** (super admin), paste both and press
*Connect*: the exam system checks the key (`GET /v1/me`), registers its own webhook
(`PUT /v1/webhook`, which returns the signing secret) and tests it. The project page then shows
*Connected · last call …*. Other software follows the same three calls (docs/API.md). Customers
never see your AI cost: `/v1/usage` and `/v1/me` report answers and drafts only, and the cost cap
shows up as "usage limit reached".

**Secrets on screen.** Keys and secrets are only ever shown masked (first 4 characters, then `*`);
Copy buttons copy the full value, and if a browser blocks copying the value is revealed
pre-selected so it can be copied by hand.

**Model profiles and keys.** The `LLM_*`, `OPENROUTER_*` and `PRICE_*` variables only seed the
first profile on first start; after that the console is the source of truth. A profile never
stores a key: it names an environment variable ending in `_API_KEY` (e.g. `DEEPSEEK_API_KEY`) that
must exist on the server. **Costs** come from the provider when it reports them (OpenRouter does);
otherwise they are estimated from the profile's prices and marked as estimated. Playground and
profile tests are recorded as *console* spend and never billed to a client.

**Security.** Sign-in uses scrypt password hashes and an httpOnly, SameSite=Strict session cookie
scoped to `/admin-api` (Secure in production); every change also needs the `X-AMS-Console`
header, so other sites can't submit forms to it. Repeated failed sign-ins are locked out for 15
minutes. Request logs redact API keys and cookies. Put the console behind HTTPS and, ideally, an
IP allow-list (see `deploy/nginx.conf`).

## Tests

```bash
pnpm test:unit    # pure logic: marks, highlights (incl. Bangla), rubric checks, router, signatures,
                  # provider adapters, cost estimates, billing maths, billing months, passwords
pnpm test:e2e     # full stack with the mock model (client API + console API); uses ams_test and Redis DB 1
pnpm test         # both
```

Create the test database once: `docker exec ams_dev_postgres psql -U ams -d ams -c "CREATE DATABASE ams_test;"`.

## Deploy to its own VPS

1. Install Docker and nginx. Point a DNS name (for example `ai.example.edu`) at the server.
2. Copy this folder to the server, then `cp .env.production.example .env.production` and fill in
   `POSTGRES_PASSWORD` and `OPENROUTER_API_KEY`.
3. Start it. The API runs migrations on start.
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
4. Put nginx in front for TLS with [deploy/nginx.conf](deploy/nginx.conf). Restrict access to the
   client projects' server IPs with `allow`/`deny`.
5. Create your console account, then open `https://ai.example.edu/console`:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
     node dist/cli/create-admin.js --email you@example.com --name "Your Name" --generate
   ```
   In the console: fill in Settings (business details, exchange rate), check the model profile
   and its hosts, create a pricing plan, then create a project for each customer system and give
   them the API URL and key (see *Selling the API to a new customer*). (The CLI
   `node dist/cli/create-client.js --name … --webhook-url … --budget …` still works.)
6. Scale workers when queues grow: `… up -d --scale worker=3`. The rate limit is shared by all
   workers, so more workers don't exceed it.

Postgres and Redis are never published to the internet. Back up the `pgdata` volume like any database.

## Configuration

All settings are environment variables, validated at start-up (`src/config/env.ts`).

| Variable | Default | |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `openrouter` in production; `mock` is refused there |
| `OPENROUTER_MODEL` | `deepseek/deepseek-v4-flash-0731` | Any OpenRouter model id |
| `OPENROUTER_PROVIDERS` | `deepinfra,parasail` | Pinned hosts, comma-separated; empty = any |
| `OPENROUTER_QUANTIZATIONS` | `fp8` | Same weights for every student |
| `OPENROUTER_ZDR` | `true` | Zero-data-retention hosts only |
| `OPENROUTER_REASONING` | `off` | `off`, `low`, `medium` or `high` |
| `PRICE_INPUT_PER_MTOK` / `PRICE_CACHED_INPUT_PER_MTOK` / `PRICE_OUTPUT_PER_MTOK` | 0.06 / 0 / 0.18 | USD per 1M tokens for the first profile |
| `REALTIME_CONCURRENCY` / `REALTIME_RATE_MAX` | 20 / 30 per s | Realtime lane throughput |
| `DEFERRED_CONCURRENCY` / `DEFERRED_RATE_MAX` | 10 / 5 per s | Deferred lane throughput |
| `ROUTER_SMALL_GROUP_MAX` | 300 | Groups up to this size go realtime |
| `ROUTER_FIRST_N_REALTIME` | 20 | First answers per question that go realtime in big groups |
| `ROUTER_REALTIME_MAX_WAITING` | 1000 | Realtime backlog that pushes new work to deferred |
| `MAX_ANSWERS_PER_REQUEST` | 500 | |
| `MAX_ANSWER_CHARS` | 20000 | Longer answers fail with `too_long` |
| `MAX_HIGHLIGHTS` | 8 | |
| `WEBHOOK_MAX_ATTEMPTS` | 8 | Exponential backoff from 10 s |
| `RUN_EMBEDDED_WORKERS` | `false` | `true` runs the workers inside the API process |
| `PUBLIC_URL` | — | This service's public address, shown in the console |
| `CONSOLE_ENABLED` | `true` | `false` turns off `/console` and `/admin-api` |
| `ADMIN_SESSION_HOURS` | 12 | Console session length (extended while in use) |
| `ADMIN_COOKIE_SECURE` | production | Force the Secure cookie flag on or off |

The model, hosts, routing and prices above seed the first model profile only; change them later in
the console.

## Operations

- **Rotate a key, change a cost cap or webhook URL, disable a project:** console → Projects. (CLI:
  `pnpm client:rotate-key --name exam-system [--webhook-secret]`.)
- **Switch models or hosts:** console → Models & providers; test the profile, then assign it.
- **Pause marking** (e.g. provider outage): console → System → Pause on a queue. Clients keep
  submitting; work resumes where it stopped.
- **Usage and cost:** console Overview and Statements, `GET /v1/usage` per project, or the `LlmCall` table.
- **Monthly billing:** console → Statements → Create invoice → Issue → Mark paid.
- **Quality tracking:** reviews sent to `/review` store the teacher's final marks next to the
  suggestion, so agreement can be measured per prompt version, model and host.
- **Change a prompt:** edit `src/marking/prompts.ts` and bump its entry in `PROMPT_VERSIONS`.
