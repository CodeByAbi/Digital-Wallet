# ⚡ PayFlow E-Wallet REST API

[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?logo=nodedotjs&logoColor=white&style=flat-square)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-v11.0-E0234E?logo=nestjs&logoColor=white&style=flat-square)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v16-4169E1?logo=postgresql&logoColor=white&style=flat-square)](https://www.postgresql.org/)
[![Prisma ORM](https://img.shields.io/badge/Prisma_ORM-v6.0-2D3748?logo=prisma&logoColor=white&style=flat-square)](https://www.prisma.io/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-v3.13-FF6600?logo=rabbitmq&logoColor=white&style=flat-square)](https://www.rabbitmq.com/)
[![Jest](https://img.shields.io/badge/Jest-Testing-C21325?logo=jest&logoColor=white&style=flat-square)](https://jestjs.io/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**PayFlow** is a highly secure, reliable, and scalable E-Wallet REST API built with **NestJS**, **PostgreSQL**, and **Prisma ORM**. To ensure high throughput and prevent database deadlocks, the core P2P transfer feature employs a **reserve-and-async architecture** powered by **RabbitMQ** to process transaction queue messages in a dedicated background worker process.

---

## 🚀 Key Features

*   **Secure Authentication**: Register and login using phone numbers and 6-digit PINs (hashed with bcrypt). Supports stateless JWT Access Tokens (15-minute expiry) and stateful, revocable JWT Refresh Tokens (7-day expiry) stored in the database.
*   **Account Safety**: Automatic lockout mechanism after 5 consecutive failed login attempts, freezing the account temporarily for 15 minutes.
*   **Profile Management**: Retrieve and update profile information while keeping phone numbers and PIN hashes read-only.
*   **Balance Top-Up**: Audited balance mutations with precise tracking of `balance_before` and `balance_after`. Enforces a minimum top-up of Rp10.000 and maximum of Rp50.000.000.
*   **Instant Payments**: Fast debit operations for purchasing items or paying bills, protected by client-supplied idempotency keys.
*   **Reserve-and-Async P2P Transfers**: 
    *   **Deadlock Prevention**: Debits the sender's balance and records a `PENDING` transfer in the database inside one transaction, then publishes a job to RabbitMQ.
    *   **Asynchronous Processing**: A separate background worker consumes messages from the queue, credits the recipient's balance, and updates the transfer status to `SUCCESS` in a separate transaction.
    *   **Resiliency & Automatic Refund**: Permanently failed transfer jobs (e.g., after maximum retries) trigger an automatic refund to the sender and flip the status to `FAILED`.
*   **Double-Mutation Protection**: Enforces mandatory `Idempotency-Key` headers on `/pay` and `/transfer` endpoints to guarantee safety against network retries or duplicate client submissions.
*   **Unified Ledger History**: A single, optimized `transactions` table acting as a unified ledger of top-ups, payments, and P2P transfers. This avoids expensive `UNION ALL` queries during paginated history lookups.

---

## 🛠️ Prerequisites

Make sure you have the following installed on your machine:

*   **Node.js** (v18.x or higher)
*   **npm** (v9.x or higher) or Yarn / pnpm
*   **Docker & Docker Compose** (for running PostgreSQL and RabbitMQ locally)
*   **Git** (for version control)

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory. You can copy the template from `.env.example`:

```bash
cp .env.example .env
```

Define the following environment variables in your `.env` file:

```env
# Application Configuration
PORT=3000
NODE_ENV=development

# Database Connection (PostgreSQL)
DATABASE_URL="postgresql://wallet:wallet@localhost:5432/wallet_db?schema=public"

# RabbitMQ Configuration
RABBITMQ_URL="amqp://guest:guest@localhost:5672"

# Security & JWT Configuration
JWT_SECRET="super-secure-jwt-secret-key-change-in-production"
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"

# Retry Backoff Settings (for Transfer Worker Queue)
# Configurable in milliseconds to support fast execution during integration testing
QUEUE_RETRY_BACKOFF_MS=2000
```

---

## 📥 Installation & Setup

Follow these steps to set up the project locally:

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/digital-wallet-api.git
cd digital-wallet-api
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Spin up Infrastructure (Database & Message Broker)
Start the PostgreSQL database and RabbitMQ container in the background using Docker Compose:
```bash
docker-compose up -d
```
*   **PostgreSQL** will be available at `localhost:5432`
*   **RabbitMQ** will be available at `localhost:5672` (Management Dashboard at `localhost:15672` with login `guest` / `guest`)

### 4. Run Database Migrations
Apply the Prisma schema structure to your PostgreSQL database:
```bash
npx prisma migrate dev --name init
```

### 5. Seed the Database (Optional)
Populate your database with mock users and wallet balances for testing:
```bash
npm run prisma db seed
```

---

## 🏃 Running the Application

The system is architected as two decoupled processes running on top of a single database. This allows the API server and queue consumer to scale independently.

### A. Run in Development Mode (Hot Reload)

In separate terminal windows, run the following:

#### 1. Main API Server
Exposes HTTP endpoints for client registration, authentication, deposits, and payments.
```bash
npm run start:api:dev
```
The API server starts on `http://localhost:3000`.

#### 2. Background Worker
Consumes RabbitMQ messages to complete P2P transfers asynchronously.
```bash
npm run start:worker:dev
```

---

### B. Run in Production Mode

#### 1. Build the project:
```bash
npm run build
```

#### 2. Start the API Server:
```bash
npm run start:prod
```

#### 3. Start the Background Worker:
```bash
node dist/worker.js
```

---

## 📍 API Endpoints Summary

All request and response bodies follow a standard envelope wrapper:
*   **Success**: `{"status": "SUCCESS", "result": { ... }}`
*   **Failure**: `{"status": "FAILED", "error": { "code": "ERROR_CODE", "message": "Descriptive message" }}`

Base URL: `/api/v1`

| Method | Endpoint | Description | Auth Required | Custom Headers / Query Params |
| :--- | :--- | :--- | :---: | :--- |
| **POST** | `/register` | Register a new user wallet | No | None |
| **POST** | `/login` | Authenticate user, receive JWTs | No | None |
| **POST** | `/refresh-token` | Obtain new Access Token using Refresh Token | No | None |
| **GET** | `/profile` | Retrieve user profile & current balance | **Yes** | None |
| **PATCH** | `/profile` | Update profile (first name, last name, address) | **Yes** | None |
| **POST** | `/topup` | Top up wallet balance (Min Rp10.000) | **Yes** | None |
| **POST** | `/pay` | Deduct balance for dynamic payments | **Yes** | `Idempotency-Key: <UUID>` *(Required)* |
| **POST** | `/transfer` | Init async P2P transfer by recipient phone number | **Yes** | `Idempotency-Key: <UUID>` *(Required)* |
| **GET** | `/transactions`| Get paginated, unified transaction ledger | **Yes** | Query: `page` (default 1), `limit` (default 20) |
| **GET** | `/health` | Verify health of DB, RabbitMQ, and API | No | None |

---

## 🧪 Testing

The project uses Jest for unit, integration, and concurrency testing.

### 1. Run Unit Tests (Mocked Dependencies)
Unit tests verify the isolated business logic inside controllers and services:
```bash
npm run test
```

### 2. Run Integration & E2E Tests (Real Database)
Integration tests require a separate test database to validate constraints and transactions accurately.
*   Spin up the test database container:
    ```bash
    docker-compose -f docker-compose.test.yml up -d
    ```
*   Run the E2E test suite:
    ```bash
    npm run test:e2e
    ```

### 3. Run Concurrency Tests
Validates the ledger behavior, row locks (`SELECT ... FOR UPDATE`), and RabbitMQ message processing under heavy load:
```bash
npm run test:concurrency
```

### 4. Check Code Coverage
Generates a code coverage report inside the `/coverage` directory:
```bash
npm run test:cov
```

---

## 📄 License & Author

*   **Author**: Senior Backend Developer Team
*   **License**: Licensed under the [MIT License](LICENSE)