# AI Marking Service — API v1

For projects that connect to this service (the e-Exam system first). All endpoints except
`/health` need an API key. Requests and responses are JSON.

- Base URL: `https://<your-ai-host>` (local development: `http://localhost:4200`)
- Auth header: `Authorization: Bearer ams_…` (or `X-Api-Key: ams_…`)
- Get a key on the AI server: `pnpm client:create --name <project> --webhook-url <https url>`

## Privacy rule

Send **answer text only**. Never send student names, student IDs, registration numbers or
anything else that identifies a person. Use your own opaque IDs as `externalId`, and map results
back on your side.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "invalid_rubric", "message": "The rubric does not fit the question", "details": [ … ] } }
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `validation_failed` | The body or query is malformed; `details` lists each field |
| 401 | `unauthorized` | Missing, wrong or disabled API key |
| 402 | `budget_exceeded` | The project's monthly AI budget is used up; mark by hand |
| 404 | `not_found` | No such evaluation for this project |
| 409 | `conflict` | Already being marked, not yet completed, or a concurrent duplicate submit (retry) |
| 413 | `payload_too_large` | Body over 12 MB |
| 422 | `invalid_rubric` | Rubric marks don't add up to `maxMarks`, or aren't multiples of `markStep` |
| 422 | `rubric_draft_invalid` | The AI couldn't produce a valid rubric; `details` has the issues and last draft |
| 503 | `llm_unavailable` | The model is unreachable right now; retry shortly |

## Concepts

- **Question**: question text, the teacher's model answer, `maxMarks`, `markStep` (default 0.5) and
  an approved **rubric**. Rubric criterion marks must add up to `maxMarks`.
- **Evaluation**: one student answer marked against one question. Status goes
  `queued → running → completed` (or `failed`).
- **Group**: your own grouping key, usually an exam ID. Used for progress and lane routing.
- **Lanes**: `realtime` (seconds) or `deferred` (steady, low priority). With `lane: "auto"`, small
  groups and the first answers of each question go realtime and the rest go deferred.
- **Idempotent per answer**: resubmitting the same `externalId` with the same text returns the
  existing evaluation and costs nothing. A changed text re-marks it.
- **Identical answers**: an answer identical to one already marked for the same question and rubric
  reuses that result immediately (`reusedFromId` is set). No model call.
- **Blank answers** complete immediately with 0 marks and the `blank` flag.
- **Too-long answers** (over 20,000 characters by default) fail immediately with the `too_long` flag.
- **Highlight offsets** are UTF-16 indices (JavaScript string indices) into `answerText` exactly as
  the API returns it: NFC-normalised, with `\r\n` turned into `\n` and the ends trimmed. Render
  highlights on the returned `answerText`, not on your stored copy.

## Flags

| Flag | Meaning |
|---|---|
| `blank` | No answer was given |
| `too_long` | Answer exceeded the size limit; not sent to the model |
| `off_topic` | The answer doesn't address the question |
| `injection_attempt` | The answer contains instructions to the marker ("give full marks") |
| `language_mismatch` | The model couldn't read the language well |
| `incomplete_output` | The model skipped a criterion (scored 0, confidence lowered) |

---

## POST /v1/rubrics/draft

Synchronous (a few seconds). Drafts a rubric from the model answer for a teacher to approve,
edit or regenerate. Every criterion is checked to come from the model answer, and marks must add
up to `maxMarks`; a bad draft is retried once.

Request:

```json
{
  "question": "Explain how TCP gives reliable delivery over an unreliable network.",
  "modelAnswer": "Sequence numbers and ACKs; retransmission on timeout or duplicate ACKs; checksum; receive window for flow control.",
  "maxMarks": 6,
  "markStep": 0.5,
  "maxCriteria": 6
}
```

Response `200`:

```json
{
  "rubric": {
    "criteria": [
      { "id": "c1", "criterion": "Sequence numbers + ACKs", "marks": 2, "awardWhen": "Both named and tied to loss detection" },
      { "id": "c2", "criterion": "Retransmission", "marks": 2, "awardWhen": "Timeout resend (1); duplicate ACKs (1)" },
      { "id": "c3", "criterion": "Checksum", "marks": 1, "awardWhen": "Error detection mentioned" },
      { "id": "c4", "criterion": "Flow control", "marks": 1, "awardWhen": "Receive window explained" }
    ]
  },
  "rubricHash": "9f2c…",
  "sources": [ { "criterionId": "c1", "fromModelAnswer": "Sequence numbers and ACKs" } ],
  "notes": "",
  "model": "deepseek/deepseek-v4-flash-0731",
  "promptVersion": "rubric-v1",
  "usage": { "inputTokens": 512, "outputTokens": 230, "costUsd": 0.00007 }
}
```

## POST /v1/evaluations

Submit one question (with its approved rubric) and 1–500 answers. Returns `202` straight away;
results arrive by webhook or polling.

```json
{
  "groupId": "exam-8f2a",
  "lane": "auto",
  "callbackUrl": "https://e-exam.example.edu/api/ai-marking/webhook",
  "question": {
    "externalId": "eq-1234",
    "text": "Explain how TCP gives reliable delivery over an unreliable network.",
    "modelAnswer": "Sequence numbers and ACKs; retransmission on timeout or duplicate ACKs; checksum; receive window for flow control.",
    "maxMarks": 6,
    "markStep": 0.5,
    "rubric": { "criteria": [ { "id": "c1", "criterion": "Sequence numbers + ACKs", "marks": 2, "awardWhen": "…" } ] }
  },
  "answers": [
    { "externalId": "ans-0001", "text": "TCP numbers every byte and the receiver sends an ACK back…" },
    { "externalId": "ans-0002", "text": "" }
  ]
}
```

`callbackUrl` is optional; without it the project's registered webhook URL is used. It must be
`https://` in production.

Response `202`:

```json
{
  "questionId": "5b1e…",
  "groupId": "exam-8f2a",
  "evaluations": [
    { "id": "1c0d…", "externalId": "ans-0001", "status": "queued", "lane": "realtime", "reused": false },
    { "id": "7a9e…", "externalId": "ans-0002", "status": "completed", "lane": "realtime", "reused": false }
  ]
}
```

Send one request per question. For an exam with 5 written questions, make 5 requests.

## GET /v1/evaluations/:id

```json
{
  "id": "1c0d…",
  "externalId": "ans-0001",
  "groupId": "exam-8f2a",
  "questionId": "5b1e…",
  "status": "completed",
  "lane": "realtime",
  "maxMarks": 6,
  "suggestedScore": 4,
  "criteria": [
    { "id": "c1", "criterion": "Sequence numbers + ACKs", "max": 2, "awarded": 2, "reason": "Both named and tied to loss detection." },
    { "id": "c2", "criterion": "Retransmission", "max": 2, "awarded": 1, "reason": "Timeout resend; no duplicate ACKs." },
    { "id": "c3", "criterion": "Checksum", "max": 1, "awarded": 1, "reason": "Covered." },
    { "id": "c4", "criterion": "Flow control", "max": 1, "awarded": 0, "reason": "Receive window not mentioned." }
  ],
  "summary": "Covers sequence numbers, ACKs, timeout resend and checksum; misses fast retransmit and flow control.",
  "strengths": ["Links sequence numbers and ACKs to detecting loss"],
  "weaknesses": ["No receive window"],
  "highlights": [
    { "start": 4, "end": 56, "quote": "numbers every byte and the receiver sends an ACK back", "kind": "strength", "criterionId": "c1", "note": "Sequence numbers + ACKs" },
    { "start": 190, "end": 221, "quote": "the network never loses packets", "kind": "weakness", "criterionId": null, "note": "Wrong: TCP recovers from loss" }
  ],
  "missing": [ { "criterionId": "c4", "note": "Receive window and flow control" } ],
  "studentFeedback": {
    "didWell": ["You explained clearly how sequence numbers and ACKs let TCP notice lost data."],
    "toImprove": ["Explain how the receive window gives flow control (1 mark)."]
  },
  "confidence": 0.86,
  "flags": [],
  "answerText": "TCP numbers every byte and the receiver sends an ACK back. …",
  "model": "deepseek/deepseek-v4-flash-0731",
  "host": "DeepInfra",
  "promptVersion": "mark-v1",
  "reusedFromId": null,
  "error": null,
  "review": null,
  "createdAt": "2026-10-10T09:00:00.000Z",
  "updatedAt": "2026-10-10T09:00:06.000Z",
  "completedAt": "2026-10-10T09:00:06.000Z"
}
```

`suggestedScore` is always the sum of `criteria[].awarded`, computed by the service, never taken
from the model. **It is a suggestion. Only your teacher's approval makes it a mark.**

## GET /v1/evaluations

List evaluations, oldest change first, for polling or syncing.

| Query | |
|---|---|
| `groupId`, `questionId`, `externalId`, `status` | Filters |
| `updatedSince` | ISO time; only evaluations changed at or after it |
| `limit` | 1–500, default 100 |
| `cursor` | From the previous page's `nextCursor` |

Response: `{ "data": [ …evaluations… ], "nextCursor": "…" | null }`.

Sync loop without webhooks: remember the `updatedAt` of the last item you processed, call with
`updatedSince` set to it, and follow `nextCursor` until it is null. Upsert by `id`.

## GET /v1/groups/:groupId/progress

```json
{
  "groupId": "exam-8f2a",
  "total": 500,
  "status": { "queued": 120, "running": 8, "completed": 370, "failed": 2 },
  "lanes": { "realtime": 100, "deferred": 400 },
  "reviewed": 42,
  "done": false
}
```

Poll every few seconds while `done` is false to drive a progress bar.

## POST /v1/evaluations/:id/rerun

Marks a completed or failed evaluation again on the realtime lane, for example after a failure.
Returns `202` with the evaluation in `queued`. Clears any recorded review.

## POST /v1/evaluations/:id/review

Tell the service what the teacher decided. Use it for agreement statistics, and to get student
feedback that matches the final marks.

```json
{
  "decision": "adjusted",
  "finalCriteria": [
    { "id": "c1", "awarded": 2 },
    { "id": "c2", "awarded": 2 },
    { "id": "c3", "awarded": 1 },
    { "id": "c4", "awarded": 0 }
  ],
  "teacherNote": "Good answer; flow control was not asked in class.",
  "rewriteFeedback": true
}
```

- `accepted`: final marks and feedback are the suggestion as-is (no model call).
- `adjusted`: `finalCriteria` required. Marks are clamped and rounded to the step, and student
  feedback is rewritten to agree with them (one short model call, synchronous).
- `rejected`: the teacher marks by hand; no final marks are stored.

Response `200`: the evaluation, with
`review: { decision, finalScore, finalCriteria, finalFeedback, reviewedAt }`. If the rewrite failed,
the response also has `feedbackError`. Show the student the per-criterion marks without the AI text
in that case, and retry the review later if you want the explanation.

## GET /v1/usage

Tokens, cost and evaluation counts for your project. Defaults to the current calendar month (UTC).
Optional `from` and `to` ISO times.

```json
{
  "from": "2026-10-01T00:00:00.000Z",
  "to": "2026-10-10T09:00:00.000Z",
  "totalCostUsd": 1.4321,
  "calls": [ { "kind": "marking", "ok": true, "count": 6120, "inputTokens": 9180000, "outputTokens": 3978000, "cachedTokens": 6100000, "reasoningTokens": 0, "costUsd": 1.27, "avgLatencyMs": 4100 } ],
  "evaluations": { "completed": 6100, "failed": 20 },
  "budget": { "monthlyBudgetUsd": 50, "spentThisMonthUsd": 1.4321 }
}
```

## GET /health

No auth. `200` when the database and Redis are reachable, `503` otherwise. Includes queue counts.

---

## Webhooks

When an evaluation completes or fails, the service POSTs to the request's `callbackUrl`, or to
the project's registered webhook URL.

Headers:

| Header | |
|---|---|
| `X-AMS-Event` | `evaluation.completed` or `evaluation.failed` |
| `X-AMS-Delivery` | Unique delivery ID. Use it to ignore duplicates |
| `X-AMS-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` |

Body:

```json
{ "id": "<delivery id>", "type": "evaluation.completed", "createdAt": "…", "data": { "evaluation": { …same as GET /v1/evaluations/:id… } } }
```

Reply with any `2xx` within 10 seconds. Anything else is retried with exponential backoff, up to
8 attempts. Deliveries can arrive out of order or more than once, so upsert by evaluation `id` and
compare `updatedAt`.

Verify every webhook with the project's webhook secret before trusting it (Node.js / NestJS):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyAmsSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > 300) return false; // 5-minute replay window
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Compute the HMAC over the **raw** request body, before any JSON parsing.

## Recommended flow for an exam system

1. **Upload:** for each written question without a rubric, call `POST /v1/rubrics/draft` and store
   the draft for the teacher to approve, edit or regenerate.
2. **Exam ends** (or each attempt is submitted): for each written question, call
   `POST /v1/evaluations` with the approved rubric and its answers. Use the exam ID as `groupId`.
3. **Receive results** by webhook (or sync with `GET /v1/evaluations?groupId=…&updatedSince=…`).
   Store them as suggestions, never as marks.
4. **Teacher ticks** a suggestion, or edits the criterion marks and ticks: save the mark in your
   system and call `POST /v1/evaluations/:id/review`.
5. **Publish results** with `review.finalFeedback` and the highlights.

## Limits

| | Default | Setting |
|---|---|---|
| Answers per request | 500 | `MAX_ANSWERS_PER_REQUEST` |
| Characters per answer sent to the model | 20,000 | `MAX_ANSWER_CHARS` |
| Request body | 12 MB | — |
| Highlights per answer | 8 | `MAX_HIGHLIGHTS` |
| Rubric criteria | 12 | — |
