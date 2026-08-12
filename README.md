# ⚡ PayFlow Digital Wallet API

API RESTful E-Wallet yang dibangun menggunakan **NestJS**, **Prisma ORM**, **PostgreSQL**, **Redis**, dan **JWT**. Project ini dirancang untuk menangani manajemen identitas pengguna, autentikasi berbasis token JWT, profil pengguna, dan saldo dompet digital secara aman. Semua response disajikan menggunakan struktur standar envelope (`status: "SUCCESS"` / `"FAILED"`).

> ⚠️ **Catatan Status Project**: Dokumentasi ini mencerminkan **state aktual** dari basis kode saat ini. Beberapa fitur transaksi (Top Up, Payment, Transfer P2P, dan Transaction History) yang terdapat pada [ROADMAP.md](docs/ROADMAP.md) saat ini **belum diimplementasikan** (masih berupa folder modul/stub).

---

## 🛠️ Prerequisites

Sebelum menjalankan aplikasi, pastikan environment Anda telah memiliki:

- **Node.js**: `v18.x` atau `v20.x` ke atas (sesuai dengan NestJS v11 & Prisma v6)
- **Package Manager**: `npm` (disarankan, menggunakan `package-lock.json`)
- **Docker & Docker Compose**: Untuk menjalankan service PostgreSQL & Redis secara lokal
- **Git**: Untuk pengelolaan versi kode

---

## ⚙️ Environment Variables

Salin file `.env.example` ke `.env` sebelum menjalankan aplikasi:

```bash
cp .env.example .env
```

Berikut adalah daftar variabel lingkungan yang **WAJIB** diisi sesuai isi aktual `.env.example`:

| Variabel | Deskripsi | Nilai Default / Contoh |
| :--- | :--- | :--- |
| `DATABASE_URL` | String koneksi database PostgreSQL | `postgresql://wallet:wallet@localhost:5432/wallet_db` |
| `RABBITMQ_URL` | String koneksi RabbitMQ (persiapan worker) | `amqp://guest:guest@localhost:5672` |
| `JWT_SECRET` | Secret key untuk enkripsi & verifikasi token JWT | `your_jwt_secret_key_here` |
| `JWT_ACCESS_EXPIRY` | Masa berlaku Access Token JWT | `15m` |
| `JWT_REFRESH_EXPIRY` | Masa berlaku Refresh Token JWT | `7d` |
| `PORT` | Port HTTP server NestJS | `3000` |

---

## 🚀 Setup — Step by Step

### 1. Clone Repository & Install Dependencies

```bash
git clone <repository-url>
cd Digital-Wallet-App
npm install
```

### 2. Konfigurasi Environment Variables

Buat file `.env` berdasarkan `.env.example`:

```bash
cp .env.example .env
```

### 3. Jalankan Service Infrastructure (PostgreSQL & Redis)

Jalankan container PostgreSQL dan Redis menggunakan Docker Compose:

```bash
docker compose up -d
```

Service yang berjalan:
- **PostgreSQL**: Port `5432` (`POSTGRES_USER=wallet`, `POSTGRES_PASSWORD=wallet`, `POSTGRES_DB=wallet_db`)
- **Redis**: Port `6379` (`redis-server --appendonly yes`)

### 4. Jalankan Migration Prisma

Eksekusi migration Prisma untuk membuat tabel database (`users`, `refresh_tokens`, `top_ups`, `payments`, `transfers`, `transactions`):

```bash
npx prisma migrate dev
```

### 5. Jalankan Seed Script (Opsional)

Project ini menyediakan seed script aktual di `prisma/seed.ts` yang mengisi data awal dua pengguna dummy (`Alice` dan `Bob`):

```bash
npx prisma db seed
```

*Data pengguna bawaan seed:*
- **Alice**: Nomor `081200000001`, PIN `123456`, Saldo `Rp1.000.000`
- **Bob**: Nomor `081200000002`, PIN `123456`, Saldo `Rp500.000`

### 6. Jalankan Server Development

Jalankan server NestJS dalam mode development (watch mode):

```bash
npm run start:dev
```

Server API akan berjalan di `http://localhost:3000/api/v1`.

> 💡 **PENTING: Penanganan Bentrok Port (`PORT`)**
> 
> Jika port default `3000` sudah digunakan oleh proses lain di mesin Anda (misalnya proses NestJS atau web server lain yang sedang berjalan), Anda akan mengalami error `EADDRINUSE`. Untuk mengatasinya:
> 1. Ubah variabel `PORT` pada file `.env` ke port lain, contohnya: `PORT=3001`
> 2. Atau jalankan perintah secara langsung dengan variabel PORT override:
>    ```bash
>    PORT=3001 npm run start:dev
>    ```

---

## 🧪 Testing

Project ini dilengkapi dengan unit test dan E2E test yang sudah terverifikasi lulus 100%.

### 1. Unit Tests

Perintah untuk menjalankan seluruh unit test (`auth.service`, `users.service`, guards, controller):

```bash
npm test
```

Perintah turunan yang tersedia di `package.json`:
- `npm run test:watch` — Jalankan unit test dalam watch mode
- `npm run test:cov` — Jalankan unit test dan buat laporan coverage code

### 2. Integration / E2E Tests

Project menyediakan environment database terpisah untuk E2E test menggunakan `docker-compose.test.yml` dan `.env.test`.

#### Step E2E Testing:
1. Jalankan container database & redis test:
   ```bash
   docker compose -f docker-compose.test.yml up -d
   ```
   *(PostgreSQL Test di port `5433`, Redis Test di port `6380`)*

2. Jalankan pengujian E2E:
   ```bash
   npm run test:e2e
   ```

---

## 📌 API Endpoints yang TERSEDIA SAAT INI

Semua endpoint API diprefiks dengan `/api/v1` dan mengembalikan response ber-envelope:
- **Response Sukses**: `{"status": "SUCCESS", "result": { ... }}`
- **Response Gagal**: `{"status": "FAILED", "error": { "code": "...", "message": "..." }}`

Berikut adalah daftar **endpoint yang sudah benar-benar diimplementasikan & lulus verifikasi**:

---

### 1. Welcome / Health Check
- **Method**: `GET`
- **Path**: `/api/v1`
- **Auth Required**: Tidak
- **Deskripsi**: Verifikasi bahwa server API berjalan dengan baik.
- **Request Body**: *None*
- **Response Sukses (200 OK)**:
  ```json
  {
    "status": "SUCCESS",
    "result": "Hello World!"
  }
  ```

---

### 2. Register User
- **Method**: `POST`
- **Path**: `/api/v1/register`
- **Auth Required**: Tidak
- **Deskripsi**: Mendaftarkan pengguna baru dengan nomor HP dan 6 digit PIN (di-hash dengan bcrypt).
- **Request Body**:
  ```json
  {
    "first_name": "John",
    "last_name": "Doe",
    "phone_number": "081234567890",
    "address": "Jl. Sudirman No. 1, Jakarta",
    "pin": "123456"
  }
  ```
- **Response Sukses (201 Created)**:
  ```json
  {
    "status": "SUCCESS",
    "result": {
      "user_id": "c1234567-89ab-cd01-ef01-234567890abc",
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "081234567890",
      "address": "Jl. Sudirman No. 1, Jakarta",
      "created_date": "2026-08-12T18:00:00.000Z"
    }
  }
  ```
- **Response Gagal (409 Conflict)**:
  ```json
  {
    "status": "FAILED",
    "error": {
      "code": "PHONE_NUMBER_ALREADY_REGISTERED",
      "message": "Phone Number already registered"
    }
  }
  ```
- **Response Gagal (400 Bad Request - Validation Error)**:
  ```json
  {
    "status": "FAILED",
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Validation failed",
      "details": [
        { "message": "pin must be exactly 6 numeric digits" }
      ]
    }
  }
  ```

---

### 3. User Login
- **Method**: `POST`
- **Path**: `/api/v1/login`
- **Auth Required**: Tidak
- **Deskripsi**: Autentikasi menggunakan nomor telepon dan PIN 6-digit. Mendukung proteksi lockout (setelah 5x percobaan gagal, akun terkunci otomatis selama 15 menit).
- **Request Body**:
  ```json
  {
    "phone_number": "081234567890",
    "pin": "123456"
  }
  ```
- **Response Sukses (200 OK)**:
  ```json
  {
    "status": "SUCCESS",
    "result": {
      "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expires_in": 900
    }
  }
  ```
- **Response Gagal (401 Unauthorized)**:
  ```json
  {
    "status": "FAILED",
    "error": {
      "code": "INVALID_CREDENTIALS",
      "message": "Phone number or PIN is incorrect"
    }
  }
  ```
- **Response Gagal (423 Locked - Lockout 15 Menit)**:
  ```json
  {
    "status": "FAILED",
    "error": {
      "code": "ACCOUNT_LOCKED",
      "message": "Account locked due to 5 consecutive failed login attempts. Try again in 15 minutes."
    }
  }
  ```

---

### 4. Refresh Token
- **Method**: `POST`
- **Path**: `/api/v1/refresh-token`
- **Auth Required**: Tidak
- **Deskripsi**: Menukar refresh token yang valid untuk mendapatkan Access Token baru. Token lama akan di-revoke.
- **Request Body**:
  ```json
  {
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Response Sukses (200 OK)**:
  ```json
  {
    "status": "SUCCESS",
    "result": {
      "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expires_in": 900
    }
  }
  ```
- **Response Gagal (401 Unauthorized)**:
  ```json
  {
    "status": "FAILED",
    "error": {
      "code": "INVALID_REFRESH_TOKEN",
      "message": "Refresh token invalid, expired, or revoked"
    }
  }
  ```

---

### 5. Get User Profile
- **Method**: `GET`
- **Path**: `/api/v1/profile`
- **Auth Required**: Ya (`Authorization: Bearer <access_token>`)
- **Deskripsi**: Mengambil data profil dan saldo pengguna yang sedang login.
- **Request Body**: *None*
- **Response Sukses (200 OK)**:
  ```json
  {
    "status": "SUCCESS",
    "result": {
      "user_id": "c1234567-89ab-cd01-ef01-234567890abc",
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "081234567890",
      "address": "Jl. Sudirman No. 1, Jakarta",
      "balance": 1000000
    }
  }
  ```
- **Response Gagal (401 Unauthorized)**:
  ```json
  {
    "status": "FAILED",
    "error": {
      "code": "HTTP_ERROR",
      "message": "Unauthorized"
    }
  }
  ```

---

### 6. Update User Profile
- **Method**: `PATCH`
- **Path**: `/api/v1/profile`
- **Auth Required**: Ya (`Authorization: Bearer <access_token>`)
- **Deskripsi**: Memperbarui informasi profil (`first_name`, `last_name`, `address`). Mengubah `phone_number` atau `pin` secara eksplisit ditolak dengan `400 VALIDATION_ERROR`.
- **Request Body**:
  ```json
  {
    "first_name": "Johnny",
    "last_name": "Doe",
    "address": "Jl. Baru No. 123, Jakarta"
  }
  ```
- **Response Sukses (200 OK)**:
  ```json
  {
    "status": "SUCCESS",
    "result": {
      "user_id": "c1234567-89ab-cd01-ef01-234567890abc",
      "first_name": "Johnny",
      "last_name": "Doe",
      "phone_number": "081234567890",
      "address": "Jl. Baru No. 123, Jakarta",
      "balance": 1000000
    }
  }
  ```
- **Response Gagal (400 Bad Request - Field Immutable Disisipkan)**:
  ```json
  {
    "status": "FAILED",
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Updating phone_number or pin via PATCH /profile is strictly forbidden"
    }
  }
  ```

---

### ⏳ Endpoint Belum Diimplementasi (Coming Soon / Planned)

Endpoint berikut terdapat pada spesifikasi [ROADMAP.md](docs/ROADMAP.md) / [SRS.md](docs/SRS.md), namun **belum diimplementasikan** pada controller/service di basis kode aktual:

- **`POST /api/v1/topup`**: Top Up Saldo Dompet (Planned Phase 5)
- **`POST /api/v1/pay`**: Pembayaran Merchant / Tagihan dengan Idempotency Key (Planned Phase 5)
- **`POST /api/v1/transfer`**: Transfer P2P Async via RabbitMQ dengan Idempotency Key (Planned Phase 6)
- **`GET /api/v1/transactions`**: Riwayat Transaksi Ledger Terpadu dengan Pagination (Planned Phase 7)

---

## 📬 Postman Collection

- Pada folder `postman/collections/New Collection/` terdapat file definisi request dalam format YAML untuk request manual (`Login.request.yaml`, `Register.request.yaml`, `Refresh Token.request.yaml`).
- 📝 **TODO**: Export Postman Collection lengkap versi `.json` (termasuk environment variables dan test scripts) belum diexport ke file fisik tunggal `.json` di repositori ini.

---

## 📁 Project Structure

Berikut adalah struktur direktori `src/` aktual dari aplikasi:

```text
src/
├── app.controller.spec.ts         # Unit test untuk AppController
├── app.controller.ts              # Controller utama (GET /api/v1)
├── app.module.ts                  # Root NestJS Module
├── app.service.ts                 # Service utama
├── main.ts                        # Entry point aplikasi (ValidationPipe, Global Prefix, Interceptor, Filter)
├── auth/                          # Modul Autentikasi
│   ├── auth.controller.ts         # Endpoint /register, /login, /refresh-token
│   ├── auth.module.ts             # Registrasi AuthModule & JwtModule
│   ├── auth.service.spec.ts       # Unit test AuthService
│   ├── auth.service.ts            # Logic register, login, refresh token, lockout
│   ├── decorators/
│   │   └── current-user-id.decorator.ts # Decorator mengekstrak userId dari JWT
│   ├── dto/                       # Data Transfer Objects
│   │   ├── login.dto.ts
│   │   ├── refresh-token.dto.ts
│   │   └── register.dto.ts
│   └── guards/
│       ├── jwt-auth.guard.spec.ts # Unit test JwtAuthGuard
│       └── jwt-auth.guard.ts      # Guard penjelajah JWT token
├── common/                        # Shared Utilities & Envelopes
│   ├── exceptions/
│   │   └── app.exception.ts       # Custom AppException class
│   ├── filters/
│   │   └── http-exception.filter.ts # Exception filter (SRS 1.3 FAILED envelope)
│   └── interceptors/
│       └── response.interceptor.ts  # Response interceptor (SRS 1.3 SUCCESS envelope)
├── prisma/                        # Modul Database Prisma
│   ├── prisma.module.ts
│   └── prisma.service.ts          # Extension PrismaClient lifecycle
├── users/                         # Modul Profil Pengguna
│   ├── users.controller.ts        # Endpoint GET /profile, PATCH /profile
│   ├── users.module.ts
│   ├── users.service.spec.ts      # Unit test UsersService
│   ├── users.service.ts           # Logic getProfile, updateProfile
│   ├── dto/
│   │   └── update-profile.dto.ts  # DTO update profile
│   └── guards/
│       ├── reject-immutable-profile-fields.guard.spec.ts
│       └── reject-immutable-profile-fields.guard.ts # Guard penolakan phone_number & pin
├── transactions/                  # (Stub / Belum diimplementasikan - berisi .gitkeep)
└── wallet/                        # (Stub / Belum diimplementasikan)
    ├── payment/                   # (Berisi .gitkeep)
    ├── topup/                     # (Berisi .gitkeep)
    └── transfer/                  # (Berisi .gitkeep)
```