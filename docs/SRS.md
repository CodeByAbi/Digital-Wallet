# Software Requirements Specification (SRS)
## Digital Wallet API

**Versi:** 1.0
**Status:** Draft — menunggu review Section 7 (skema database) & Section 9 (item baru)
**Referensi:** PRD.md
**Stack final:** NestJS, PostgreSQL, Prisma ORM, Redis + BullMQ, JWT (bcrypt untuk PIN)

---

## 1. Pendahuluan

### 1.1 Tujuan
Dokumen ini menjabarkan requirement teknis detail dari PRD.md: kontrak API presisi (request/response schema), aturan validasi, standar error handling, dan kebutuhan database. Arsitektur (ERD, flow diagram, concurrency handling) ada di SYSTEM_DESIGN.md — dokumen ini fokus ke **kontrak dan requirement**, bukan **cara implementasi**.

### 1.2 Referensi
- PRD.md — business rules & acceptance criteria per fitur
- Berikutnya: SYSTEM_DESIGN.md (arsitektur, ERD, transfer flow), TDD.md (test plan), ROADMAP.md

### 1.3 Konvensi Response

Semua response API pakai envelope berikut — **ini enhancement dari spec asli**, ditandai karena spec asli cuma punya `message` polos tanpa `code` yang bisa di-assert programmatically di test:

**Success:**
```json
{
  "status": "SUCCESS",
  "result": { }
}
```

**Failed:**
```json
{
  "status": "FAILED",
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Balance is not enough"
  }
}
```

`message` tetap sama persis dengan string yang ada di spec asli (biar tetap sesuai requirement), `code` ditambahkan supaya Postman test/TDD bisa assert by code, bukan parsing string message yang gampang berubah.

### 1.4 HTTP Status Code Mapping

| Situasi | HTTP Status |
|---|---|
| Sukses (create) | 201 |
| Sukses (read/update) | 200 |
| Field invalid/missing/format salah | 400 |
| Token tidak ada / invalid / expired | 401 |
| Rate limit / akun terkunci sementara | 429 |
| Resource tidak ditemukan (mis. target transfer) | 404 |
| Conflict (phone_number duplikat) | 409 |
| Business rule violation (saldo kurang, self-transfer) | 422 |
| Error tak terduga | 500 |

---

## 2. Functional Requirements

| ID | Requirement |
|---|---|
| FR-1 | Sistem harus bisa mendaftarkan user baru dengan `phone_number` unique dan `user_id` UUID. |
| FR-2 | Sistem harus autentikasi user via `phone_number` + PIN, mengembalikan JWT access & refresh token. |
| FR-3 | Sistem harus punya endpoint refresh token untuk memperpanjang sesi tanpa login ulang. *(Addition — lihat Section 9)* |
| FR-4 | Sistem harus bisa menambah saldo user (top up) dengan audit `balance_before`/`balance_after`. |
| FR-5 | Sistem harus bisa mengurangi saldo user (payment) dengan validasi saldo cukup. |
| FR-6 | Sistem harus bisa transfer saldo ke user lain by `phone_number`, diproses reserve-and-async lewat queue. |
| FR-7 | Sistem harus mencegah double-processing transfer/payment lewat idempotency key. |
| FR-8 | Sistem harus menampilkan riwayat transaksi milik user yang login, dipaginasi, terbaru dulu. |
| FR-9 | Sistem harus bisa update profil (`first_name`, `last_name`, `address`) — `phone_number` & PIN read-only lewat endpoint ini. |
| FR-10 | Sistem harus mengunci sementara akun setelah 5x percobaan login gagal berturut-turut. |
| FR-11 | Sistem harus otomatis refund saldo pengirim kalau job kredit transfer gagal permanen (max retry tercapai). |

---

## 3. API Specification

Base URL: `/api/v1`

### 3.1 `POST /register`

**Auth:** Tidak perlu

**Request:**
```json
{
  "first_name": "Guntur",
  "last_name": "Saputro",
  "phone_number": "0811255501",
  "address": "Jl. Kebon Sirih No. 1",
  "pin": "123456"
}
```

**Validasi:**
| Field | Rule |
|---|---|
| first_name, last_name | required, string, 1–50 karakter |
| phone_number | required, format Indonesia `^(\+62\|62\|0)8[1-9][0-9]{6,10}$`, unique |
| address | required, string, max 255 karakter |
| pin | required, exactly 6 digit numerik |

**Response SUCCESS (201):**
```json
{
  "status": "SUCCESS",
  "result": {
    "user_id": "bc1c823e-b0fb-4b20-88c0-dff25e283252",
    "first_name": "Guntur",
    "last_name": "Saputro",
    "phone_number": "0811255501",
    "address": "Jl. Kebon Sirih No. 1",
    "created_date": "2026-08-11T22:21:20Z"
  }
}
```

**Response FAILED:**
| Code | Status | Message |
|---|---|---|
| `PHONE_NUMBER_ALREADY_REGISTERED` | 409 | "Phone Number already registered" |
| `VALIDATION_ERROR` | 400 | detail per field |

---

### 3.2 `POST /login`

**Auth:** Tidak perlu

**Request:**
```json
{ "phone_number": "0811255501", "pin": "123456" }
```

**Response SUCCESS (200):**
```json
{
  "status": "SUCCESS",
  "result": {
    "access_token": "{jwt}",
    "refresh_token": "{jwt}",
    "expires_in": 900
  }
}
```

**Response FAILED:**
| Code | Status | Message |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | "Phone number and pin doesn't match" |
| `ACCOUNT_LOCKED` | 429 | "Too many failed attempts, try again in 15 minutes" |

---

### 3.3 `POST /refresh-token` *(Addition)*

**Auth:** Tidak perlu (pakai `refresh_token`, bukan `access_token`)

**Request:**
```json
{ "refresh_token": "{jwt}" }
```

**Response SUCCESS (200):** sama seperti `/login`, `access_token` baru diterbitkan.

**Response FAILED:**
| Code | Status | Message |
|---|---|---|
| `INVALID_REFRESH_TOKEN` | 401 | "Refresh token is invalid or expired" |

---

### 3.4 `GET /profile` *(Addition — perlu buat konsumsi sebelum update)*

**Auth:** Bearer access_token

**Response SUCCESS (200):**
```json
{
  "status": "SUCCESS",
  "result": {
    "user_id": "...", "first_name": "...", "last_name": "...",
    "phone_number": "...", "address": "...", "balance": 370000,
    "updated_date": "2026-08-30T00:00:00.000Z"
  }
}
```

---

### 3.5 `PUT /profile`

**Auth:** Bearer access_token

**Request:**
```json
{ "first_name": "Guntur", "last_name": "S.", "address": "Jl. Baru No. 2" }
```

**Validasi:** sama seperti register untuk field yang sama. Kalau request menyertakan `phone_number` atau `pin`, seluruh request **direject** dengan validation error (400) — bukan diabaikan diam-diam, supaya client sadar sebagian payload-nya invalid. Body kosong / tidak ada field valid juga direject, bukan no-op.

**Response SUCCESS (200):** profil terbaru, format sama seperti `GET /profile` (termasuk `updated_date`).

---

### 3.6 `POST /topup`

**Auth:** Bearer access_token

**Request:**
```json
{ "amount": 500000 }
```

**Validasi:** `amount` required, integer, `>= 10000` (minimum top up, PRD Assumption #4), `<= 50000000` per transaksi (batas atas — placeholder, konfirmasi kalau perlu diubah).

**Response SUCCESS (201):**
```json
{
  "status": "SUCCESS",
  "result": {
    "top_up_id": "201ddde1-f797-484b-b1a0-07d1190e790a",
    "amount_top_up": 500000,
    "balance_before": 0,
    "balance_after": 500000,
    "created_date": "2026-08-11T22:21:21Z"
  }
}
```

**Response FAILED:**
| Code | Status | Message |
|---|---|---|
| `UNAUTHENTICATED` | 401 | "Unauthenticated" |
| `VALIDATION_ERROR` | 400 | amount di luar batas |

---

### 3.7 `POST /pay`

**Auth:** Bearer access_token
**Headers tambahan:** `Idempotency-Key: <uuid>` (required)

**Request:**
```json
{ "amount": 100000, "remarks": "Pulsa Telkomsel 100k" }
```

**Response SUCCESS (201):**
```json
{
  "status": "SUCCESS",
  "result": {
    "payment_id": "13bcb11c-111e-4a65-9afd-90a86a01cd21",
    "amount": 100000,
    "remarks": "Pulsa Telkomsel 100k",
    "balance_before": 500000,
    "balance_after": 400000,
    "created_date": "2026-08-11T22:22:00Z"
  }
}
```

**Response FAILED:**
| Code | Status | Message |
|---|---|---|
| `INSUFFICIENT_BALANCE` | 422 | "Balance is not enough" |
| `UNAUTHENTICATED` | 401 | "Unauthenticated" |
| `DUPLICATE_IDEMPOTENCY_KEY` | 409 | key sudah dipakai dengan payload berbeda |

---

### 3.8 `POST /transfer`

**Auth:** Bearer access_token
**Headers tambahan:** `Idempotency-Key: <uuid>` (required)

**Request:**
```json
{
  "target_phone_number": "0811255502",
  "amount": 30000,
  "remarks": "Hadiah Ultah"
}
```
> Catatan: field diubah dari `target_user` (UUID) di spec asli menjadi `target_phone_number` — lihat PRD Assumption #1.

**Response SUCCESS (201):**
```json
{
  "status": "SUCCESS",
  "result": {
    "transfer_id": "a7d39cf6-44b6-41fc-b3e9-7b16df5321c5",
    "status": "SUCCESS",
    "amount": 30000,
    "remarks": "Hadiah Ultah",
    "balance_before": 400000,
    "balance_after": 370000,
    "created_date": "2026-08-11T22:23:20Z"
  }
}
```
> `status: "SUCCESS"` di sini berarti **saldo pengirim sudah final ter-debit**, bukan berarti penerima sudah menerima kredit — kredit ke penerima masih diproses async. Kalau job gagal permanen, transaksi ini nanti bertransisi ke `FAILED` dan saldo di-refund (lihat FR-11, detail state machine di SYSTEM_DESIGN.md).

**Response FAILED:**
| Code | Status | Message |
|---|---|---|
| `INSUFFICIENT_BALANCE` | 422 | "Balance is not enough" |
| `SELF_TRANSFER_NOT_ALLOWED` | 422 | "Cannot transfer to yourself" |
| `RECIPIENT_NOT_FOUND` | 404 | "Recipient phone number not registered" |
| `UNAUTHENTICATED` | 401 | "Unauthenticated" |
| `DUPLICATE_IDEMPOTENCY_KEY` | 409 | key sudah dipakai dengan payload berbeda |

---

### 3.9 `GET /transactions`

**Auth:** Bearer access_token

**Query params:** `page` (default 1), `limit` (default 20, max 100)

**Response SUCCESS (200):**
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
> Skema ini disatukan (bukan 3 skema beda per tipe transaksi seperti spec asli) — field `transaction_id` menggantikan `transfer_id`/`payment_id`/`top_up_id`, ditambah `transaction_type` sebagai diskriminator. Alasan teknis ada di Section 7.2.

**Response FAILED:**
| Code | Status | Message |
|---|---|---|
| `UNAUTHENTICATED` | 401 | "Unauthenticated" |

---

### 3.10 `GET /health` *(Addition, opsional)*

Endpoint tanpa auth buat cek service & koneksi DB/Redis hidup — berguna untuk deployment/monitoring, bukan requirement bisnis. Bisa di-skip kalau dianggap tidak perlu.

---

## 4. Authentication & Authorization

- Semua endpoint kecuali `/register`, `/login`, `/refresh-token`, `/health` wajib `Authorization: Bearer {access_token}`.
- `access_token`: JWT, expiry **15 menit**, payload berisi `user_id` saja (jangan simpan data sensitif di JWT payload karena bisa di-decode tanpa verifikasi oleh siapa pun).
- `refresh_token`: JWT, expiry **7 hari**, disimpan di DB (tabel terpisah) supaya bisa di-revoke — bukan cuma stateless, karena kalau device hilang, sistem harus bisa invalidate refresh token itu.
- PIN di-hash pakai **bcrypt** (cost factor 10) sebelum disimpan, tidak pernah disimpan/dikembalikan plaintext.
- NestJS Guard (`AuthGuard`) diterapkan di level controller untuk endpoint yang butuh auth.

## 5. Error Handling Standard

- Semua error pakai envelope Section 1.3 — konsisten di semua endpoint, tidak ada endpoint yang balikin raw string atau format beda.
- Validation error (400) mengembalikan detail per field:
```json
{
  "status": "FAILED",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "field": "pin", "message": "must be exactly 6 digits" }]
  }
}
```
- Error tak terduga (500) tidak boleh bocorkan stack trace ke response — dicatat di log server, response ke client cuma `{"code": "INTERNAL_ERROR", "message": "Something went wrong"}`.

## 6. Validation Rules Summary

| Field | Rule |
|---|---|
| `phone_number` | `^(\+62\|62\|0)8[1-9][0-9]{6,10}$`, unique |
| `pin` | exactly 6 digit numerik |
| `amount` (topup) | integer, 10.000 ≤ x ≤ 50.000.000 |
| `amount` (payment/transfer) | integer, > 0, ≤ saldo user |
| `remarks` | optional, max 100 karakter |
| `first_name`/`last_name` | required, 1–50 karakter |
| `address` | required, max 255 karakter |
| `Idempotency-Key` | required (payment, transfer), UUID format |

## 7. Database Requirements

*(Field list & constraint di sini. ERD relasional & diagram visual — SYSTEM_DESIGN.md.)*

### 7.1 Tipe data untuk uang
**Wajib pakai `BIGINT`, bukan `FLOAT`/`DECIMAL` mengambang, untuk `balance` dan `amount`.** IDR tidak punya sub-unit yang lazim dipakai, jadi disimpan sebagai integer rupiah penuh. Floating point untuk uang adalah bug klasik (rounding error) — ini bukan asumsi, ini hard requirement.

### 7.2 Keputusan skema: ledger terpadu

Karena `GET /transactions` butuh gabungan top up + payment + transfer terurut & dipaginasi dalam satu response, ada dua pilihan:
- **(a)** Query `UNION ALL` lintas 3 tabel tiap kali `/transactions` dipanggil — makin rumit dan lambat begitu data membesar, apalagi butuh `ORDER BY created_date` + `LIMIT/OFFSET` lintas union.
- **(b)** Tabel `transactions` terpadu sebagai ledger, ditulis bersamaan tiap kali top up/payment/transfer terjadi (dalam transaksi DB yang sama), dengan kolom `transaction_type` sebagai diskriminator.

**Rekomendasi: opsi (b).** Detail tabel & FK ke `top_ups`/`payments`/`transfers` dijabarkan di SYSTEM_DESIGN.md ERD — ini keputusan yang mempengaruhi ERD, jadi ditandai di sini supaya tidak muncul mendadak di dokumen berikutnya.

### 7.3 Entitas & field inti

**users**
`id (uuid, pk)`, `first_name`, `last_name`, `phone_number (unique, indexed)`, `address`, `pin_hash`, `balance (bigint, default 0)`, `failed_login_attempts (int, default 0)`, `locked_until (timestamp, nullable)`, `created_at`, `updated_at`

**top_ups**
`id (uuid, pk)`, `user_id (fk → users)`, `amount (bigint)`, `balance_before`, `balance_after`, `created_at`

**payments**
`id (uuid, pk)`, `user_id (fk → users)`, `amount (bigint)`, `remarks`, `balance_before`, `balance_after`, `idempotency_key (indexed)`, `created_at`

**transfers**
`id (uuid, pk)`, `sender_id (fk → users)`, `recipient_id (fk → users)`, `amount (bigint)`, `remarks`, `status (enum: PENDING, SUCCESS, FAILED)`, `balance_before`, `balance_after`, `idempotency_key (indexed)`, `retry_count (int, default 0)`, `created_at`, `updated_at`

**transactions** *(ledger, lihat 7.2)*
`id (uuid, pk)`, `user_id (fk → users)`, `transaction_type (enum: TOP_UP, PAYMENT, TRANSFER)`, `direction (enum: CREDIT, DEBIT)`, `reference_id (fk polymorphic ke top_ups/payments/transfers)`, `amount`, `balance_before`, `balance_after`, `status`, `created_at`

**refresh_tokens**
`id (uuid, pk)`, `user_id (fk → users)`, `token_hash`, `expires_at`, `revoked (boolean, default false)`, `created_at`

### 7.4 Index yang wajib ada
- `users.phone_number` — unique index (lookup login & transfer target).
- `payments.idempotency_key`, `transfers.idempotency_key` — unique index scoped per user.
- `transactions.user_id` + `created_at` — composite index untuk pagination `/transactions`.

---

## 8. Non-Functional Requirements

| Kategori | Requirement |
|---|---|
| Performance | Endpoint CRUD biasa p95 < 300ms (di luar proses queue background). |
| Security | PIN di-hash bcrypt; JWT secret via env var, tidak hardcoded; rate limit login. |
| Reliability | Idempotency di transfer & payment; retry + refund otomatis untuk job gagal. |
| Scalability | API layer stateless (JWT) → bisa horizontal scale; worker BullMQ scale terpisah dari API. |
| Observability | Structured logging tiap transaksi; dashboard monitoring queue (Bull Board). |
| Maintainability | Migration versioned via Prisma Migrate; struktur module NestJS per domain (auth, wallet, transaction). |

---

## 9. Item Baru di Luar Spec Asli (ringkasan)

Supaya tidak tercecer, semua penambahan di dokumen ini dikumpulkan di sini:
- `POST /refresh-token`, `GET /profile`, `GET /health` — endpoint tambahan.
- `Idempotency-Key` header di `/pay` dan `/transfer`.
- Response envelope dengan `error.code` terstruktur.
- Tabel `transactions` (ledger) dan `refresh_tokens` — tidak ada di spec asli.
- Rate limit login 5x percobaan.

Kalau ada yang dianggap over-engineering untuk scope take-home test ini, kabarin — bisa dipangkas sebelum ke System Design.
