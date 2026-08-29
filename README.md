# ⚡ PayFlow E-Wallet REST API

[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?logo=nodedotjs&logoColor=white&style=flat-square)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-v11.0-E0234E?logo=nestjs&logoColor=white&style=flat-square)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v16-4169E1?logo=postgresql&logoColor=white&style=flat-square)](https://www.postgresql.org/)
[![Prisma ORM](https://img.shields.io/badge/Prisma_ORM-v6.0-2D3748?logo=prisma&logoColor=white&style=flat-square)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-v7-DC382D?logo=redis&logoColor=white&style=flat-square)](https://redis.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-Queue-red?style=flat-square)](https://docs.bullmq.io/)
[![Jest](https://img.shields.io/badge/Jest-Testing-C21325?logo=jest&logoColor=white&style=flat-square)](https://jestjs.io/)

**PayFlow** is a digital wallet REST API built with **NestJS**, **PostgreSQL**, and **Prisma ORM**. To avoid dual-account-lock deadlocks and keep the API responsive, P2P transfers use a **reserve-and-async architecture**: the request debits the sender and commits, then a **Redis + BullMQ** job asynchronously credits the recipient in a background worker process.

> Private take-home assessment project — not licensed for reuse (`package.json` marks it `UNLICENSED`).

---

## 🚀 Key Features

*   **Secure Authentication**: Register and login using phone numbers and 6-digit PINs (hashed with bcrypt, cost 10). Stateless JWT Access Tokens (15-minute expiry, payload carries only `user_id`) plus stateful, revocable JWT Refresh Tokens (7-day expiry, hash stored in `refresh_tokens` so a lost device can be invalidated).
*   **Account Safety**: Automatic lockout after 5 consecutive failed login attempts (`ACCOUNT_LOCKED`, 429, 15-minute cooldown).
*   **Profile Management**: Retrieve and update profile info; `phone_number`/`pin` are immutable via `PUT /profile` — inserting either rejects the **whole** request (400), it is never silently dropped.
*   **Balance Top-Up**: Audited balance mutations with `balance_before`/`balance_after` tracking. Enforces a minimum top-up of Rp10.000 and maximum of Rp50.000.000.
*   **Instant Payments**: Debit operations for purchases/bills, protected by a required `Idempotency-Key` header.
*   **Reserve-and-Async P2P Transfers**:
    *   **Deadlock Prevention**: Debits the sender and inserts a `PENDING` transfer in one DB transaction, commits, *then* enqueues a BullMQ job — debit and credit deliberately happen in separate transactions.
    *   **Asynchronous Processing**: A dedicated worker process consumes the job, credits the recipient, and flips the transfer to `SUCCESS` — idempotently (`status !== PENDING` guard prevents double-credit on retry).
    *   **Resiliency**: Permanently failed jobs (max retries exhausted) auto-refund the sender and flip the transfer to `FAILED`. A `@Cron` reconciliation sweep (every 5 minutes) re-enqueues any `PENDING` transfer older than 2 minutes, covering the gap if Redis dies between commit and enqueue.
    *   **Bull Board dashboard** at `/admin/queues` (outside `/api/v1`) for inspecting queue/job state — protected by HTTP Basic Auth (`BULL_BOARD_USER`/`BULL_BOARD_PASSWORD`), since job payloads include transfer details.
*   **Double-Mutation Protection**: Mandatory `Idempotency-Key` header on `/pay` and `/transfer`. Same key + same payload replays the original result; same key + different payload → `409 DUPLICATE_IDEMPOTENCY_KEY`.
*   **Unified Ledger History**: A single `transactions` table is the ledger for top-ups, payments, and transfers (`transaction_type` discriminator), so `GET /transactions` stays one indexed, paginated query instead of a `UNION ALL` across three tables.

---

## 🛠️ Prerequisites

*   **Node.js** (v18.x or higher)
*   **npm** (v9.x or higher) or Yarn / pnpm
*   **Docker & Docker Compose** (for running PostgreSQL and Redis locally)
*   **Git**
*   **Postman** (optional, for the collection under [`postman/`](postman/) — see [Manual Testing with Postman](#-manual-testing-with-postman))

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory by copying the template:

```bash
cp .env.example .env
```

`.env.example` defines:

```env
DATABASE_URL=postgresql://wallet:wallet@localhost:5432/wallet_db
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your_jwt_secret_key_here
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
PORT=3001

# Bull Board dashboard (/admin/queues) — basic auth, SYSTEM_DESIGN 6.7
BULL_BOARD_USER=admin
BULL_BOARD_PASSWORD=changeme

# Transfer job retry policy — override with millisecond delays in test envs
# (TDD Q-03) so BullMQ retries don't stall CI on production's 2s-32s backoff.
TRANSFER_JOB_ATTEMPTS=5
TRANSFER_JOB_BACKOFF_MS=2000
```

Change `JWT_SECRET` and `BULL_BOARD_PASSWORD` before deploying anywhere real. `docker-compose.test.yml` runs its own Postgres/Redis on ports `5433`/`6380` (see `.env.test`), independent of the dev containers above.

---

## 📥 Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/CodeByAbi/Digital-Wallet.git
cd Digital-Wallet
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Spin up Infrastructure (Postgres & Redis)
```bash
docker-compose up -d
```
*   **PostgreSQL** available at `localhost:5432` (user/pass/db: `wallet`/`wallet`/`wallet_db`)
*   **Redis** available at `localhost:6379` (append-only persistence enabled — BullMQ's backing store, nothing else)

### 4. Run Database Migrations
Applies the committed Prisma migrations (`prisma/migrations/`) to your database:
```bash
npx prisma migrate deploy
```
(Use `npx prisma migrate dev` instead only if you're evolving `schema.prisma` yourself and need a new migration generated.)

### 5. Seed the Database (Optional)
Creates two demo users — Alice (`081200000001`) with a Rp1.000.000 balance and Bob (`081200000002`) with Rp500.000 — both with PIN `123456`:
```bash
npx prisma db seed
```

---

## 🏃 Running the Application

The API server and the transfer worker are two separate processes sharing one database — this lets them scale independently.

### A. Development Mode (Hot Reload)

In separate terminals:

```bash
npm run start:api:dev     # API server → http://localhost:3001
npm run start:worker:dev  # BullMQ consumer — processes transfer jobs
```

### B. Production Mode

```bash
npm run build
npm run start:prod        # API server (dist/main.js)
node dist/worker.js        # Background worker (dist/worker.js)
```

---

## 📍 API Endpoints Summary

All responses share one envelope:
*   **Success**: `{"status": "SUCCESS", "result": { ... }}`
*   **Failure**: `{"status": "FAILED", "error": { "code": "ERROR_CODE", "message": "..." }}`

Base URL: `/api/v1`

| Method | Endpoint | Description | Auth | Notes |
| :--- | :--- | :--- | :---: | :--- |
| **POST** | `/register` | Register a new user wallet | No | |
| **POST** | `/login` | Authenticate, receive access + refresh JWTs | No | 5 failed attempts → `429 ACCOUNT_LOCKED` (15 min) |
| **POST** | `/refresh-token` | Exchange refresh token for a new access token | No | |
| **GET** | `/profile` | Retrieve profile & current balance | **Yes** | |
| **PUT** | `/profile` | Update `first_name`/`last_name`/`address` | **Yes** | `phone_number`/`pin` in body, or an empty/all-invalid body → `400 VALIDATION_ERROR` (whole request rejected) |
| **POST** | `/topup` | Top up wallet balance | **Yes** | Amount: Rp10.000–Rp50.000.000 |
| **POST** | `/pay` | Debit balance for a payment | **Yes** | `Idempotency-Key: <UUID>` *(required)* |
| **POST** | `/transfer` | P2P transfer by recipient phone number | **Yes** | `Idempotency-Key: <UUID>` *(required)*; response reflects the sender's debit, recipient credit is async |
| **GET** | `/transactions` | Paginated, unified transaction ledger | **Yes** | Query: `page` (default 1), `limit` (default 20, max 100) |

Additionally, `/admin/queues` (outside `/api/v1`, HTTP Basic Auth) serves the Bull Board dashboard for the transfer queue — it's an HTML admin UI, not a JSON API endpoint.

### 📝 API Usage Examples

#### 1. Register (`POST /register`)
```json
{
  "first_name": "Alice",
  "last_name": "Wonder",
  "phone_number": "081200000099",
  "address": "Jl. Contoh No. 1, Jakarta",
  "pin": "123456"
}
```
Success (`201`):
```json
{
  "status": "SUCCESS",
  "result": {
    "user_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "first_name": "Alice",
    "last_name": "Wonder",
    "phone_number": "081200000099",
    "address": "Jl. Contoh No. 1, Jakarta",
    "created_date": "2026-08-30T00:00:00.000Z"
  }
}
```
Same `phone_number` registered twice → `409 PHONE_NUMBER_ALREADY_REGISTERED`.

#### 2. Login (`POST /login`)
```json
{ "phone_number": "081200000099", "pin": "123456" }
```
Success (`200`):
```json
{
  "status": "SUCCESS",
  "result": {
    "access_token": "eyJhbGciOi...",
    "refresh_token": "eyJhbGciOi...",
    "expires_in": 900
  }
}
```
Wrong PIN → `401 INVALID_CREDENTIALS`; 5th consecutive failure → `429 ACCOUNT_LOCKED`.

#### 3. Refresh Token (`POST /refresh-token`)
```json
{ "refresh_token": "<refresh_token from login>" }
```
Success (`200`): `{ "status": "SUCCESS", "result": { "access_token": "...", "expires_in": 900 } }`. Invalid/expired/revoked token → `401 INVALID_REFRESH_TOKEN`.

#### 4. Get Profile (`GET /profile`) — `Authorization: Bearer <access_token>`
```json
{
  "status": "SUCCESS",
  "result": {
    "user_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "first_name": "Alice",
    "last_name": "Wonder",
    "phone_number": "081200000099",
    "address": "Jl. Contoh No. 1, Jakarta",
    "balance": 1000000,
    "updated_date": "2026-08-30T00:00:00.000Z"
  }
}
```

#### 5. Update Profile (`PUT /profile`)
```json
{ "first_name": "Alice", "address": "Jl. Baru No. 2" }
```
Success (`200`): same shape as `GET /profile` with the updated fields. Sending `phone_number` or `pin` (even `null`), or an empty body → `400 VALIDATION_ERROR`, nothing is partially applied.

#### 6. Top-up Balance (`POST /topup`)
```json
{ "amount": 50000 }
```
Success (`201`):
```json
{
  "status": "SUCCESS",
  "result": {
    "top_up_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "amount_top_up": 50000,
    "balance_before": 100000,
    "balance_after": 150000,
    "created_date": "2026-08-29T01:42:07.000Z"
  }
}
```

#### 7. Payment (`POST /pay`) — `Idempotency-Key: <UUID>` *(required)*
```json
{ "amount": 25000, "remarks": "Lunch payment" }
```
Success (`201`):
```json
{
  "status": "SUCCESS",
  "result": {
    "payment_id": "c3f8e58a-3bc1-4048-9da7-25e2e8312015",
    "amount": 25000,
    "remarks": "Lunch payment",
    "balance_before": 150000,
    "balance_after": 125000,
    "created_date": "2026-08-29T01:42:07.000Z"
  }
}
```
Not enough balance → `422 INSUFFICIENT_BALANCE`. Same key replayed with a different payload → `409 DUPLICATE_IDEMPOTENCY_KEY`; same key + same payload → returns the original result.

#### 8. Transfer (`POST /transfer`) — `Idempotency-Key: <UUID>` *(required)*
```json
{ "target_phone_number": "081200000002", "amount": 30000, "remarks": "Hadiah Ultah" }
```
Success (`201`):
```json
{
  "status": "SUCCESS",
  "result": {
    "transfer_id": "a7d39cf6-...",
    "status": "SUCCESS",
    "amount": 30000,
    "remarks": "Hadiah Ultah",
    "balance_before": 400000,
    "balance_after": 370000,
    "created_date": "2026-08-11T22:23:20Z"
  }
}
```
`status: "SUCCESS"` means **the sender's debit is final** — the recipient's credit is still processed asynchronously by the worker. Failure cases: `422 INSUFFICIENT_BALANCE`, `422 SELF_TRANSFER_NOT_ALLOWED`, `404 RECIPIENT_NOT_FOUND`, `409 DUPLICATE_IDEMPOTENCY_KEY`.

#### 9. Transaction History (`GET /transactions?page=1&limit=20`)
```json
{
  "status": "SUCCESS",
  "result": {
    "data": [
      {
        "transaction_id": "a7d39cf6-...",
        "transaction_type": "TRANSFER",
        "direction": "DEBIT",
        "status": "SUCCESS",
        "amount": 30000,
        "remarks": "Hadiah Ultah",
        "balance_before": 400000,
        "balance_after": 370000,
        "created_date": "2026-08-11T22:23:20Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 3, "total_pages": 1 }
  }
}
```

### ⚠️ Error Code Reference

| Code | HTTP Status | Where |
| :--- | :---: | :--- |
| `VALIDATION_ERROR` | 400 | Any endpoint — DTO validation, missing/invalid `Idempotency-Key`, forbidden profile fields, empty profile body |
| `UNAUTHENTICATED` | 401 | Any protected endpoint — missing/invalid/expired access token |
| `INVALID_CREDENTIALS` | 401 | `/login` — wrong phone_number/pin |
| `INVALID_REFRESH_TOKEN` | 401 | `/refresh-token` — invalid, expired, or revoked |
| `PHONE_NUMBER_ALREADY_REGISTERED` | 409 | `/register` |
| `ACCOUNT_LOCKED` | 429 | `/login` — 5 consecutive failed attempts |
| `INSUFFICIENT_BALANCE` | 422 | `/pay`, `/transfer` |
| `SELF_TRANSFER_NOT_ALLOWED` | 422 | `/transfer` — target is the caller's own phone number |
| `RECIPIENT_NOT_FOUND` | 404 | `/transfer` — target phone number not registered |
| `DUPLICATE_IDEMPOTENCY_KEY` | 409 | `/pay`, `/transfer` — same key, different payload |

---

## 📮 Manual Testing with Postman

A ready-to-import collection lives under [`postman/`](postman/):

*   [`Digital-Wallet-API.postman_collection.json`](postman/Digital-Wallet-API.postman_collection.json) — happy path + key failure cases per endpoint (not exhaustive — see `docs/TDD.md` Section 2).
*   [`Digital-Wallet-API-Local.postman_environment.json`](postman/Digital-Wallet-API-Local.postman_environment.json) — `base_url` pointed at `http://localhost:3001/api/v1`, plus empty `access_token`/`refresh_token` slots.

**To use it:**
1. In Postman: **Import** both files.
2. Select the **"Digital Wallet API - Local"** environment (top-right environment picker).
3. Run **Auth → Register**, then **Auth → Login** — Login's test script saves `access_token`/`refresh_token` into the environment automatically; every other request inherits the bearer token from the collection's auth settings.
4. For the Transfer requests, run **Auth → Register Recipient** first so `target_phone_number` resolves to a real user.
5. Requests suffixed with a status code (e.g. *"Pay - Insufficient Balance (422)"*) demonstrate the matching failure case from the [Error Code Reference](#️-error-code-reference) above.

---

## 🧪 Testing

### 1. Unit Tests (mocked dependencies)
```bash
npm run test
```

### 2. Integration & E2E Tests (real Postgres + Redis)
```bash
docker-compose -f docker-compose.test.yml up -d
npm run test:e2e
```

### 3. Concurrency Tests
Race-condition suite (concurrent `/payment`, `/transfer`, same-idempotency-key requests, row locks) — not required on every commit, but must pass before merging to `main`:
```bash
npm run test:concurrency
```

### 4. Coverage
```bash
npm run test:cov
```
`coverageThreshold` in `package.json` enforces the service layer (`auth`/`users`/`transactions`/`wallet` `*.service.ts`) at 80%+ statements/lines/functions and 70%+ branches (TDD.md Section 12).

---

## 📄 Author

Abi ([@CodeByAbi](https://github.com/CodeByAbi)) — private assessment project, `UNLICENSED`.
