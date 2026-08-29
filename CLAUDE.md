# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repository currently contains **planning documents only** (`docs/`) — no source code, `package.json`, or project scaffold exists yet. Before writing code, check whether Phase 1 setup (see ROADMAP.md) has been done; if `src/` doesn't exist, you're starting from scratch per SYSTEM_DESIGN.md Section 3.

Docs are written in Indonesian. Read them in this order to understand the project:

1. `docs/PRD.md` — product requirements, business rules, and 10 explicit assumptions that deviate from/extend the original take-home spec (Section 5) — e.g. transfer uses `phone_number` not raw `user_id`, idempotency keys required, self-transfer blocked.
2. `docs/SRS.md` — exact API contracts (request/response schemas, validation rules, error codes, HTTP status mapping), DB entity field list.
3. `docs/SYSTEM_DESIGN.md` — architecture, ERD, sequence diagrams, the reserve-and-async transfer flow, Redis/BullMQ setup, concurrency/locking strategy.
4. `docs/TDD.md` — test plan (unit/integration/E2E/concurrency), what's realistically automatable vs. documented-only.
5. `docs/ROADMAP.md` — phased build order (11 phases); testing is written in parallel with each phase, not bolted on at the end.

## Intended stack (decided, not yet scaffolded)

Node.js + NestJS, PostgreSQL via Prisma ORM, Redis + BullMQ for the transfer background queue, JWT auth (bcrypt for PIN hashing), Postman collection for manual/demo API testing. Jest + Supertest for automated tests.

## Architecture (once built)

**Planned module layout** (SYSTEM_DESIGN.md Section 3):
```
src/
├── auth/          # register, login, refresh-token, JWT guard
├── users/         # GET/PUT /profile
├── wallet/
│   ├── topup/
│   ├── payment/
│   └── transfer/
│       ├── transfer.controller.ts
│       ├── transfer.service.ts     # producer — enqueues job
│       └── transfer.processor.ts   # consumer — processes job
├── transactions/  # GET /transactions
├── prisma/        # PrismaService, single shared connection
├── common/
│   ├── filters/        # exception filter → error envelope
│   └── interceptors/   # response envelope for success
├── main.ts        # API bootstrap
└── worker.ts       # optional separate worker entrypoint (Section 6.6)
```
Layering: Controller (DTO validation) → Service (business logic) → Prisma (data access). JWT Guard applied at controller level for protected routes.

**Core design decisions that must not be reinvented differently:**

- **Money is always `BIGINT`, never float/decimal.** IDR has no sub-unit; balances/amounts are whole-rupiah integers (SRS 7.1).
- **Transfer is reserve-and-async, not two-phase-locked.** The API request debits the sender and inserts a `PENDING` transfer inside one DB transaction, commits, *then* enqueues a BullMQ job. A separate worker transaction later credits the recipient and flips status to `SUCCESS`. Debit and credit deliberately happen in **different DB transactions** (one in the request, one in the worker) — this is what avoids classic dual-account-lock deadlocks, not an oversight (SYSTEM_DESIGN.md Section 5).
- **Worker idempotency is load-bearing**: `if (transfer.status !== 'PENDING') return;` before crediting — this is the only thing preventing double-credit on job retry after a crash between `COMMIT` and BullMQ ack (SYSTEM_DESIGN.md Section 6.4).
- **Reconciliation sweep** (`@Cron`, every 5 min) re-enqueues `PENDING` transfers older than 2 minutes, covering the gap where Redis dies between commit and enqueue (SYSTEM_DESIGN.md Section 6.5).
- **Failed transfer jobs (max retries exhausted) auto-refund the sender** and flip transfer status to `FAILED` (PRD Assumption #9, SYSTEM_DESIGN.md Section 5).
- **Locking**: every balance mutation (topup, payment, transfer debit/credit) must happen inside `SELECT ... FOR UPDATE` wrapped in a DB transaction. Pessimistic locking is the deliberate choice over optimistic (`version` column) given expected low volume (SYSTEM_DESIGN.md Section 7).
- **Ledger table** (`transactions`) is a unified table written alongside every topup/payment/transfer in the same DB transaction, with `transaction_type` as discriminator — chosen over `UNION ALL` across three tables so `/transactions` pagination stays a single indexed query (SRS 7.2).
- **Idempotency-Key header** required on `/pay` and `/transfer`; duplicate key + different payload → `409 DUPLICATE_IDEMPOTENCY_KEY`; duplicate key + same payload → return the original result.
- **Response envelope** is consistent across all endpoints: `{"status": "SUCCESS", "result": {...}}` or `{"status": "FAILED", "error": {"code", "message", "details"?}}` (SRS 1.3) — implement via a global exception filter + interceptor, not per-endpoint.
- **Redis is used for exactly one thing**: BullMQ's backing store. Not session, not cache, not rate-limiting — keep it that way (SYSTEM_DESIGN.md Section 1).
- **Bull Board dashboard must be behind basic auth** at `/admin/queues` — it exposes transfer payloads (SYSTEM_DESIGN.md Section 6.7). Don't skip this.
- **JWT**: access token 15 min expiry, payload contains only `user_id` (no sensitive data — JWTs are decodable without verification). Refresh token 7 days, stored as a hash in `refresh_tokens` table (revocable, unlike stateless access tokens).
- **PIN**: 6 numeric digits, bcrypt-hashed (cost 10), never returned in any response.
- **Login lockout**: 5 consecutive failed attempts → temporary lock (`ACCOUNT_LOCKED`, 429).

## Test strategy (TDD.md)

- Unit tests (Jest, mocked deps) run in parallel with each phase — not saved for a final testing phase.
- Integration tests need **real Postgres** (via `docker-compose.test.yml`, planned for Phase 1) — mocks can't simulate row locks or constraint violations accurately.
- `test:concurrency` suite (race conditions: concurrent `/payment`, concurrent `/transfer`, concurrent same-idempotency-key requests) is a separate suite, not required on every commit, but must pass before merge to main. It only becomes fully runnable once Transfer + Worker (Phase 6) exist.
- BullMQ retry backoff must be **env-var configurable** so tests can use millisecond delays instead of production's 2s–32s exponential backoff (TDD.md Section 9, Q-03) — build this in from the start in `transfer.service.ts`, not as an afterthought.
- Coverage target: service layer 80%+; controllers/DTOs not held to that bar.

## Commit conventions

Grading criteria explicitly includes "source control familiarity" — commit granularly per feature/phase, not as one large final commit (SYSTEM_DESIGN.md Section 9, ROADMAP.md Phase 10). `.gitignore` must cover `node_modules/`, `.env`, `dist/`; commit `.env.example`, never the real `.env`.
