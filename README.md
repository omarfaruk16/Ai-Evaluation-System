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
[CHECKLIST.md](CHECKLIST.md).

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
pnpm client:create --name local-dev      # prints an API key once
pnpm dev                                 # API on :4200, with embedded workers
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

## Tests

```bash
pnpm test:unit    # pure logic: marks, highlights (incl. Bangla), rubric checks, router, signatures, OpenRouter client
pnpm test:e2e     # full stack with the mock model; uses the ams_test database and Redis DB 1
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
5. Register each client project. The key and webhook secret are printed once; put them in that
   project's environment.
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
     node dist/cli/create-client.js --name exam-system \
     --webhook-url https://e-exam.example.edu/api/ai-marking/webhook --budget 50
   ```
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
| `OPENROUTER_REASONING` | `off` | `off`, `low` or `high` |
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

## Operations

- **Rotate a key:** `pnpm client:rotate-key --name exam-system [--webhook-secret]`, or on the
  server `… exec api node dist/cli/rotate-key.js --name exam-system`.
- **Change budget or webhook URL:** update the `Client` row (`monthlyBudgetUsd`, `webhookUrl`).
- **Usage and cost:** `GET /v1/usage` per project, or query the `LlmCall` table.
- **Quality tracking:** reviews sent to `/review` store the teacher's final marks next to the
  suggestion, so agreement can be measured per prompt version, model and host.
- **Change a prompt:** edit `src/marking/prompts.ts` and bump its entry in `PROMPT_VERSIONS`.
