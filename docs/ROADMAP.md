# Development Roadmap
## Digital Wallet API

**Referensi:** PRD.md, SRS.md, SYSTEM_DESIGN.md, TDD.md

Roadmap awal yang lo kasih di awal jadi basis, tapi ada 3 perubahan struktural dari hasil 4 dokumen sebelumnya — bukan kosmetik, ini mempengaruhi urutan kerja:

1. **Testing tidak lagi jadi satu phase di akhir** — TDD Section 13 sudah eksplisit bilang ini salah kalau ditumpuk di belakang: unit test ditulis paralel tiap phase, cuma gap-filling + concurrency suite yang jadi phase terpisah menjelang akhir.
2. **`docker-compose.test.yml` pindah ke Phase 1**, bukan nunggu Phase testing — supaya bisa mulai nulis test dari hari pertama.
3. **FE dipisah jadi phase paling akhir, eksplisit optional** — sesuai instruksi lo dari awal (backend + API + DB prioritas, FE nice-to-have).

Item yang masih outstanding dari sesi TDD kemarin (config backoff jadi env-configurable) sudah dimasukkan ke Phase 6 di bawah.

---

## Phase 1 — Project Setup & Infra
- [ ] Init NestJS project + git repo
- [ ] `.gitignore` (node_modules, .env, dist) + `.env.example`
- [ ] `docker-compose.yml` — Postgres + Redis (dev), dengan `--appendonly yes` untuk Redis (SYSTEM_DESIGN 6.1)
- [ ] `docker-compose.test.yml` — Postgres + Redis terpisah untuk test environment (TDD Section 13)
- [ ] Setup Prisma, koneksi ke DB
- [ ] Struktur folder module (SYSTEM_DESIGN Section 3): `auth/`, `users/`, `wallet/`, `transactions/`, `prisma/`, `common/`

## Phase 2 — Database Schema
- [ ] Prisma schema: `users`, `refresh_tokens`, `top_ups`, `payments`, `transfers`, `transactions` (ledger — SRS 7.2)
- [ ] Migration awal
- [ ] Index: `phone_number` unique, `idempotency_key` unique (payments & transfers), composite `(user_id, created_at)` di transactions (SRS 7.4)
- [ ] Seed script sederhana (opsional, memudahkan testing manual)

## Phase 3 — Authentication
- [ ] `POST /register` — validasi, hash PIN (bcrypt), unique phone_number
- [ ] `POST /login` — verifikasi PIN, generate access+refresh token
- [ ] Lockout mechanism (5x gagal → locked sementara)
- [ ] `POST /refresh-token` *(addition — SRS 3.3)*
- [ ] JWT Guard + middleware auth
- [ ] Unit test AuthService paralel di phase ini (UT-AUTH-01 s/d 06)
- [ ] E2E test register/login/refresh (E2E-REG, E2E-LOGIN, E2E-REFRESH)

## Phase 4 — Profile
- [ ] `GET /profile` *(addition — SRS 3.4)*
- [ ] `PATCH /profile` — whitelist field `first_name`/`last_name`/`address`, abaikan `phone_number`/`pin` kalau dikirim
- [ ] Unit + E2E test paralel (E2E-PROFILE-01 s/d 03)

## Phase 5 — Top Up & Payment
- [ ] `POST /topup` — validasi minimum, row lock saat update balance
- [ ] `POST /pay` — validasi saldo cukup, `Idempotency-Key` handling
- [ ] Insert ke tabel ledger `transactions` bersamaan dalam satu DB transaction
- [ ] Unit + integration test paralel (UT-WALLET-01/02, IT-DB-01/02, E2E-TOPUP, E2E-PAY)

## Phase 6 — Transfer & Background Worker
- [ ] Register `BullModule` + queue `transfer-queue` (SYSTEM_DESIGN 6.2)
- [ ] `POST /transfer` — reserve-and-async: debit sender + insert `PENDING` dalam transaksi, enqueue job setelah commit
- [ ] Worker/processor — idempotent (cek `status !== PENDING` sebelum proses), kredit recipient
- [ ] Refund handler saat job gagal max retry
- [ ] Reconciliation sweep (`@Cron`, tiap 5 menit, tangkap `PENDING` yang orphan)
- [ ] Bull Board dashboard, **wajib basic auth** (SYSTEM_DESIGN 6.7 — jangan skip ini)
- [ ] **Buat `attempts`/`backoff` configurable lewat env var** — supaya test env bisa pakai delay milidetik, bukan production 2s–32s (item outstanding dari TDD Q-03)
- [ ] Unit + integration test paralel (Q-01 s/d Q-04, E2E-TRF-01 s/d 04)

## Phase 7 — Transaction Report
- [ ] `GET /transactions` — pagination, urut terbaru dulu
- [ ] Unit + E2E test paralel (UT-TXN, E2E-TXN-01 s/d 03)

## Phase 8 — Testing Consolidation
- [ ] Isi gap unit/integration/E2E test yang belum tercover dari phase sebelumnya
- [ ] `test:concurrency` suite (RC-01, RC-02, RC-03) — **baru bisa dijalankan penuh di phase ini** karena butuh Transfer + Worker (Phase 6) sudah selesai
- [ ] Edge cases checklist (TDD Section 10)
- [ ] Cek coverage: service layer 80%+ (TDD Section 12)

## Phase 9 — Documentation & Postman
- [ ] Postman collection — happy path + kegagalan kunci tiap endpoint (bukan exhaustive, lihat TDD Section 2)
- [ ] README: cara setup, env vars, cara jalanin migration & seed
- [ ] API usage examples

## Phase 10 — Finalization
- [ ] Code cleanup
- [ ] Security review: rate limit login, Bull Board ada auth, `.env` tidak ke-commit, JWT secret bukan hardcoded
- [ ] Review error handling — semua endpoint pakai envelope konsisten (SRS 1.3), tidak ada 500 mentah bocor ke client
- [ ] Full test run + coverage check final
- [ ] Push versi final, commit history granular per phase (bukan satu commit besar — grading criteria "source control familiarity")

## Phase 11 — Frontend *(Optional, nice-to-have)*
- [ ] Hanya dikerjakan kalau Phase 1–10 sudah selesai dan masih ada waktu
- [ ] Scope minimal: form register/login, lihat saldo, riwayat transaksi — tidak perlu polish visual

---

## Catatan Prioritas

Kalau waktu terbatas, urutan yang **tidak boleh dikorbankan** (backend + end-to-end API + DB, sesuai instruksi awal): Phase 1–8. Phase 9 (Postman/docs) dan Phase 10 (finalization polish) boleh dipangkas kalau kepepet waktu — cukup pastikan README minimal ada cara setup. Phase 11 (FE) yang pertama kali dicoret kalau waktu habis.
