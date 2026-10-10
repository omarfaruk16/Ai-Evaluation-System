# AI Marking Service — build checklist

A standalone service that drafts marking rubrics and marks written answers with an LLM
(DeepSeek V4 Flash 0731 through OpenRouter). It runs on its own VPS with its own database and
Redis, and any project connects to it over an authenticated HTTP API. The e-Exam system is the
first client.

Legend: `[x]` done · `[ ]` to do · `[~]` partly done

## Phase 0 — Foundations
- [x] 0.1 Project scaffold: NestJS 11, TypeScript strict, Prisma 6, BullMQ 5, zod, vitest
- [x] 0.2 Environment validation (zod) and `.env.example`
- [x] 0.3 Dev `docker-compose.yml`: PostgreSQL 17 (port 5440) and Redis 7 (port 6390)
- [x] 0.4 Database schema and first migration: clients, question contexts, evaluations, LLM call log, webhook deliveries

## Phase 1 — LLM core
- [x] 1.1 `LlmClient` interface, one place to swap models or providers
- [x] 1.2 OpenRouter adapter: pinned hosts, fp8, zero data retention, strict JSON schema, reasoning off, usage and cost capture, typed errors
- [x] 1.3 Mock adapter for development and tests (no API key, no cost)
- [x] 1.4 Prompts v1 (versioned): marking, rubric draft, student-feedback rewrite
- [x] 1.5 JSON schemas and zod validation for all three outputs
- [x] 1.6 Post-processing: clamp and sum marks, round to the mark step, locate highlight quotes (Unicode NFC, Bangla-safe), merge overlaps, cap highlights
- [x] 1.7 Rubric validation: marks add up, 0.5 steps, every criterion traces to the model answer

## Phase 2 — Public API (v1)
- [x] 2.1 API-key auth per client project (keys stored hashed) and a CLI to create clients and keys
- [x] 2.2 `POST /v1/rubrics/draft` — synchronous rubric draft
- [x] 2.3 `POST /v1/evaluations` — submit one question with many answers (idempotent per answer)
- [x] 2.4 `GET /v1/evaluations/:id` and `GET /v1/evaluations` (filters, keyset paging, `updatedSince` for sync)
- [x] 2.5 `GET /v1/groups/:groupId/progress`
- [x] 2.6 `POST /v1/evaluations/:id/rerun`
- [x] 2.7 `POST /v1/evaluations/:id/review` — teacher decision; rewrites student feedback when marks were adjusted
- [x] 2.8 `GET /v1/usage` — tokens and cost per client
- [x] 2.9 `GET /health` — database and Redis
- [x] 2.10 Request validation with clear error codes

## Phase 3 — Processing pipeline
- [x] 3.1 Two queues: `marking-realtime` (high priority) and `marking-deferred` (steady, low priority)
- [x] 3.2 Lane router: small groups and the first answers per question go realtime, the bulk goes deferred, back-pressure moves work to deferred
- [x] 3.3 Skip blank answers (0 marks, `blank` flag, no LLM call)
- [x] 3.4 Reuse results for identical answers to the same question and rubric
- [x] 3.5 Worker entrypoint as a separate process, with rate limits and retries
- [x] 3.6 Webhooks: HMAC-signed `evaluation.completed` / `evaluation.failed`, retried with backoff
- [x] 3.7 Usage log for every LLM call and a monthly budget cap per client

## Phase 4 — Quality, docs and deployment
- [x] 4.1 Unit tests: marks, highlights (English, Bangla, LaTeX), rubric validation, lane router, webhook signatures
- [x] 4.2 End-to-end test with the mock adapter (API → queue → worker → result → webhook)
- [x] 4.3 `docs/API.md` for client projects, with webhook verification code
- [~] 4.4 Dockerfile and `docker-compose.prod.yml` (api, worker, postgres, redis) — image build being verified
- [x] 4.5 README: local run, deploy to a separate VPS behind nginx with TLS
- [ ] 4.6 Smoke test against the real model (needs an OpenRouter key and your approval to spend)

## Phase 5 — Connect the e-Exam system (after the service is verified)
- [ ] 5.1 Rubric data: `Question.rubric`, status and source; Rubric sheet in the Excel template; snapshot at publish
- [ ] 5.2 AI client module in the exam API: calls this service, receives webhooks, stores suggestions
- [ ] 5.3 Question Bank: rubric draft review (approve, edit, draft again)
- [ ] 5.4 Grading workspace: highlighted answer, why-this-mark, strong and weak points, per-criterion marks, tick
- [ ] 5.5 Student result page: approved explanation and highlights
- [ ] 5.6 Pilot check on past teacher-graded answers (agreement with teachers, Bangla subset)

## Later improvements
- [ ] OpenRouter Batch API for the deferred lane once a host serves this model in batch
- [ ] Calibration examples from teacher approvals
- [ ] OpenAPI spec generated from the zod schemas
- [ ] Prometheus metrics endpoint and dashboard
