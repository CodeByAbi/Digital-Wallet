# Product Requirements Document (PRD)
## Digital Wallet API — MVP

**Versi:** 1.0
**Status:** Draft — menunggu konfirmasi item di Section 6 & 11
**Dokumen terkait:** SRS.md, SYSTEM_DESIGN.md, TDD.md, ROADMAP.md (menyusul, satu per satu)

---

## 1. Overview

Backend REST API untuk digital wallet sederhana: register, login, top up, payment, transfer antar user, riwayat transaksi, dan update profil. Prioritas MVP adalah **backend + end-to-end API + database**. Frontend/UI adalah **out of scope**, nice-to-have kalau ada waktu sisa.

**Stack yang sudah diputuskan:**
| Layer | Pilihan |
|---|---|
| Backend runtime | Node.js |
| Framework | Express atau NestJS — belum final, diputuskan di SRS |
| Database | PostgreSQL |
| Background processing | Redis + BullMQ |
| API testing/dokumentasi | Postman collection |

---

## 2. Goals

- Menyediakan 7 endpoint inti yang berfungsi penuh end-to-end, teruji lewat Postman.
- Proses transfer uang berjalan reliable lewat background queue, dengan status dan audit trail yang jelas.
- Saldo user konsisten — tidak ada race condition yang menyebabkan double-spend atau saldo negatif.
- Struktur project rapi: ORM + migration, siap untuk unit test.

## 3. Non-Goals / Out of Scope (MVP)

- Frontend/UI (nice-to-have, bukan prioritas).
- Notifikasi (email/push) ke user saat transfer selesai/gagal.
- Multi-currency — asumsi semua transaksi dalam IDR, tanpa desimal (integer rupiah).
- KYC / verifikasi dokumen identitas.
- Role admin / dashboard untuk melihat transaksi user lain (dashboard yang dimaksud requirement adalah monitoring background job, bukan admin panel bisnis).

## 4. Actors

- **Registered User** — satu-satunya role di MVP ini. Tidak ada role admin/staff yang eksplisit diminta di requirement asli, jadi tidak dibuat kecuali dikonfirmasi diperlukan.

---

## 5. Assumptions & Decisions yang Ditandai (WAJIB DIREVIEW)

Ini business rules yang **tidak ada di spec asli** atau **mengubah spec asli**. Ditulis eksplisit di sini supaya gampang dikoreksi, bukan diam-diam ditanam di kode.

| # | Item | Keputusan/Asumsi | Kenapa |
|---|---|---|---|
| 1 | Identifikasi target transfer | `/transfer` request pakai `phone_number`, bukan `user_id` (UUID) mentah seperti di spec asli | User biasa tidak mungkin tahu UUID orang lain. Backend translate `phone_number` → `user_id` secara internal. |
| 2 | Idempotency key | `/transfer` dan `/payment` wajib terima header/field `idempotency_key` dari client | Melindungi dari double-transfer akibat network retry atau worker restart. Tidak ada di spec asli, ditambahkan karena risiko nyata untuk fitur uang. |
| 3 | Self-transfer | Transfer ke `phone_number` milik sendiri ditolak | Tidak disebut di spec asli, tapi logis untuk dicegah. |
| 4 | Minimum top up | Rp 10.000, tanpa maksimum | Placeholder — silakan ganti angkanya. |
| 5 | Format PIN | 6 digit numerik, disimpan hashed (bukan plaintext) | Response `/register` di spec asli sudah benar tidak mengembalikan PIN — konsisten dengan ini. |
| 6 | Rate limit login | Lockout sementara setelah 5x percobaan PIN salah berturut-turut | PIN 6 digit rentan brute force. Tidak ada di spec asli — direkomendasikan, bukan opsional. |
| 7 | Pagination `/transactions` | Default `page=1&limit=20`, urut `created_date` terbaru dulu | Spec asli tidak sebut pagination; tanpa ini response bisa berat kalau transaksi menumpuk. |
| 8 | Field yang bisa diupdate di `/profile` | Hanya `first_name`, `last_name`, `address`. `phone_number` dan PIN **tidak bisa** diubah lewat endpoint ini | Sudah dikonfirmasi. |
| 9 | Kegagalan background transfer | Retry otomatis (BullMQ, exponential backoff). Kalau tetap gagal setelah max retry → saldo pengirim di-refund otomatis, status transaksi jadi `FAILED` | Konsekuensi logis dari pilihan reserve-and-async — lihat Risiko di Section 9. |
| 10 | Alamat & nama | Semua field register wajib diisi (tidak ada field optional) | Placeholder — spec asli tidak eksplisit. |

**Kalau ada dari 10 item ini yang salah asumsi, koreksi sebelum lanjut ke SRS** — karena SRS akan menjabarkan validation rules & error codes berdasarkan tabel ini.

---

## 6. Feature Specifications

### 6.1 Register

**Deskripsi:** Mendaftarkan user baru. `user_id` format UUID, `phone_number` unique key.

**User flow:**
1. User submit `first_name`, `last_name`, `phone_number`, `address`, `pin`.
2. Sistem validasi format input & cek keunikan `phone_number`.
3. Sistem hash PIN (bcrypt/argon2 — detail di SRS), simpan user baru dengan `balance = 0`.
4. Sistem return profil user (tanpa PIN).

**Business rules:**
- `phone_number` harus unique di seluruh sistem.
- PIN tidak pernah dikembalikan di response manapun.
- Balance awal selalu 0, tidak bisa diset saat register.

**Acceptance Criteria:**
- ✅ Given `phone_number` belum terdaftar, When submit data valid, Then user dibuat dengan `user_id` UUID baru, response `SUCCESS` berisi profil tanpa PIN.
- ✅ Given `phone_number` sudah terdaftar, When register lagi, Then response gagal `"Phone Number already registered"`, tidak ada user baru dibuat.
- ✅ Given PIN bukan 6 digit numerik, When submit, Then validation error, user tidak dibuat.

---

### 6.2 Login

**Deskripsi:** Autentikasi user pakai `phone_number` + PIN, mengembalikan JWT.

**User flow:**
1. User submit `phone_number` + `pin`.
2. Sistem cari user by `phone_number`, verifikasi PIN hash.
3. Kalau cocok → generate `access_token` + `refresh_token`.
4. Kalau gagal 5x berturut-turut → akun terkunci sementara (lihat Assumption #6).

**Business rules:**
- `access_token` umur pendek (detail exp di SRS), `refresh_token` umur panjang.
- Lockout sementara setelah percobaan gagal berulang.

**Acceptance Criteria:**
- ✅ Given `phone_number` + PIN cocok, When login, Then dapat `access_token` & `refresh_token`.
- ✅ Given PIN salah, When login, Then response `"Phone number and pin doesn't match"`, percobaan gagal dicatat.
- ✅ Given percobaan gagal ≥ 5x, When login lagi (walau PIN benar), Then ditolak sementara dengan pesan lockout.

---

### 6.3 Top Up

**Deskripsi:** Menambah saldo user. `top_up_id` format UUID. Butuh autentikasi.

**Business rules:**
- Minimum nominal top up (Assumption #4).
- `balance_after = balance_before + amount`, dicatat sebagai transaksi tipe `CREDIT`.

**Acceptance Criteria:**
- ✅ Given user authenticated, When top up dengan `amount` valid, Then saldo bertambah, transaksi tercatat dengan `balance_before`/`balance_after`.
- ✅ Given tidak ada/invalid token, When top up, Then response `"Unauthenticated"`.
- ✅ Given `amount` di bawah minimum, When top up, Then validation error.

---

### 6.4 Payment

**Deskripsi:** Pembelian/pembayaran mengurangi saldo. `payment_id` format UUID.

**Business rules:**
- Saldo tidak boleh menjadi negatif — validasi `balance >= amount` sebelum debit.
- Dicatat sebagai transaksi tipe `DEBIT`.

**Acceptance Criteria:**
- ✅ Given saldo cukup, When payment, Then saldo berkurang, transaksi tercatat sukses.
- ✅ Given saldo tidak cukup, When payment, Then response `"Balance is not enough"`, saldo tidak berubah.
- ✅ Given tidak authenticated, When payment, Then response `"Unauthenticated"`.

---

### 6.5 Transfer

**Deskripsi:** Kirim saldo ke user lain. `transfer_id` format UUID. **Diproses reserve-and-async** (Section 5).

**User flow:**
1. User submit `phone_number` tujuan (lihat Assumption #1), `amount`, `remarks`, `idempotency_key` (Assumption #2).
2. Sistem validasi saldo cukup, target bukan diri sendiri (Assumption #3), `idempotency_key` belum pernah dipakai.
3. Sistem **langsung** debit saldo pengirim (reserve), catat transaksi `PENDING`→ response `SUCCESS` instan ke client dengan `balance_after` sudah ter-update di sisi pengirim.
4. Sistem enqueue job ke BullMQ untuk memproses kredit ke penerima.
5. Worker proses job: kredit saldo penerima, update status transaksi jadi `SUCCESS` penuh.
6. Kalau job gagal setelah max retry → refund otomatis ke pengirim, status `FAILED` (Assumption #9).

**Business rules:**
- Saldo pengirim tidak boleh negatif.
- Tidak bisa transfer ke diri sendiri.
- `idempotency_key` mencegah transfer terduplikasi dari retry client.

**Acceptance Criteria:**
- ✅ Given saldo cukup & target valid, When transfer, Then saldo pengirim langsung berkurang, response `SUCCESS` instan, job masuk queue.
- ✅ Given saldo tidak cukup, When transfer, Then response `"Balance is not enough"`, tidak ada job di-enqueue.
- ✅ Given target = diri sendiri, When transfer, Then ditolak dengan pesan spesifik.
- ✅ Given `idempotency_key` sudah pernah dipakai, When request diulang, Then return hasil transfer yang sama (bukan transfer baru).
- ✅ Given job kredit ke penerima gagal setelah max retry, When dicek, Then saldo pengirim di-refund, status transaksi `FAILED`. *(Detail teknis retry & refund dijabarkan penuh di System Design & diverifikasi di TDD.)*

**Risiko yang perlu diketahui:** karena response dianggap final di sisi client walau proses kredit ke penerima masih berjalan async, ada kemungkinan user melihat `SUCCESS` lalu transaksi berubah jadi `FAILED` + refund beberapa saat kemudian. Ini konsekuensi dari pilihan reserve-and-async yang sudah diputuskan — mitigasinya ada di status transisi transaksi yang jelas dan logging, dijabarkan di System Design.

---

### 6.6 Report Transactions

**Deskripsi:** Menampilkan seluruh transaksi (top up, payment, transfer) milik user yang login.

**Business rules:**
- Hanya menampilkan transaksi milik user yang authenticated.
- Pagination (Assumption #7), urut terbaru dulu.
- Response berisi union dari 3 tipe transaksi dengan field yang konsisten per tipe (skema detail di SRS).

**Acceptance Criteria:**
- ✅ Given user authenticated, When request `/transactions`, Then dapat list transaksi miliknya sendiri, diurutkan terbaru dulu, dipaginasi.
- ✅ Given tidak authenticated, When request, Then response `"Unauthenticated"`.
- ✅ Given user A request, When ada transaksi milik user B, Then transaksi user B tidak muncul di response user A.

---

### 6.7 Update Profile

**Deskripsi:** Update `first_name`, `last_name`, `address`. `phone_number` dan PIN **tidak bisa diubah** lewat endpoint ini (Assumption #8).

**Acceptance Criteria:**
- ✅ Given field valid, When update profile, Then data tersimpan, response berisi profil terbaru.
- ✅ Given request menyertakan `phone_number` atau `pin`, When update, Then field tersebut diabaikan/ditolak (bukan diproses diam-diam).
- ✅ Given tidak authenticated, When update, Then response `"Unauthenticated"`.

---

## 7. Definition of Done (MVP)

- 7 endpoint di atas berfungsi penuh sesuai acceptance criteria.
- Postman collection lengkap, bisa dijalankan end-to-end (termasuk skenario gagal).
- Transfer background job terbukti berjalan async lewat queue, bisa dimonitor lewat dashboard (Bull Board).
- Unit test untuk logic inti: perhitungan saldo, validasi transfer, idempotency.
- Migration script tersedia, database bisa di-setup dari nol lewat command.
- FE: tidak ada (out of scope MVP).

---
