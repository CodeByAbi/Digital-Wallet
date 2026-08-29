# Development Roadmap
## Digital Wallet API

**Referensi:** PRD.md, SRS.md, SYSTEM_DESIGN.md, TDD.md

Roadmap awal yang lo kasih di awal jadi basis, tapi ada 4 perubahan struktural dari hasil 4 dokumen sebelumnya — bukan kosmetik, ini mempengaruhi urutan kerja:

1. **Testing tidak lagi jadi satu phase di akhir** — TDD Section 13 sudah eksplisit bilang ini salah kalau ditumpuk di belakang: unit test ditulis paralel tiap phase, cuma gap-filling + concurrency suite yang jadi phase terpisah menjelang akhir.
2. **`docker-compose.test.yml` pindah ke Phase 1**, bukan nunggu Phase testing — supaya bisa mulai nulis test dari hari pertama.
3. **FE dipisah jadi phase paling akhir, eksplisit optional** — sesuai instruksi lo dari awal (backend + API + DB prioritas, FE nice-to-have).
4. Behavior PATCH /profile untuk field terlarang (phone_number/pin) diubah dari silent-ignore (sesuai draft awal SRS 3.4) menjadi explicit-reject. Alasan: silent-ignore berisiko bikin user tidak sadar requestnya sebagian di-drop tanpa notifikasi. Deviasi ini PERLU dicek ulang ke SRS.md Section 3.4 — kalau SRS masih menulis versi silent-ignore, update juga SRS.md supaya kedua dokumen konsisten, jangan biarkan ROADMAP dan SRS saling kontradiksi.

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
- [ ] `PATCH /profile` — whitelist field `first_name`/`last_name`/`address`; kalau `phone_number`/`pin` disisipkan di body, REJECT seluruh request dengan validation error (400) — bukan diabaikan diam-diam. Body kosong / tidak ada field valid juga direject, bukan no-op.
- [ ] Unit + E2E test paralel (E2E-PROFILE-01 s/d 03)

## Phase 5 — Top Up & Payment
- [x] `POST /topup` — validasi minimum, row lock saat update balance
- [x] `POST /pay` — validasi saldo cukup, `Idempotency-Key` handling
- [x] Insert ke tabel ledger `transactions` bersamaan dalam satu DB transaction
- [x] Unit + integration test paralel (UT-WALLET-01/02, IT-DB-01/02, E2E-TOPUP, E2E-PAY)

## Phase 6 — Transfer & Background Worker
- [x] Register `BullModule` + queue `transfer-queue` (SYSTEM_DESIGN 6.2)
- [x] `POST /transfer` — reserve-and-async: debit sender + insert `PENDING` dalam transaksi, enqueue job setelah commit
- [x] Worker/processor — idempotent (cek `status !== PENDING` sebelum proses), kredit recipient
- [x] Refund handler saat job gagal max retry
- [x] Reconciliation sweep (`@Cron`, tiap 5 menit, tangkap `PENDING` yang orphan)
- [x] Bull Board dashboard, **wajib basic auth** (SYSTEM_DESIGN 6.7 — jangan skip ini)
- [x] **Buat `attempts`/`backoff` configurable lewat env var** — supaya test env bisa pakai delay milidetik, bukan production 2s–32s (item outstanding dari TDD Q-03)
- [x] Unit + integration test paralel (Q-01 s/d Q-04, E2E-TRF-01 s/d 04)

## Phase 7 — Transaction Report
- [x] `GET /transactions` — pagination, urut terbaru dulu
- [x] Unit + E2E test paralel (UT-TXN, E2E-TXN-01 s/d 03)

## Phase 8 — Testing Consolidation
- [x] Isi gap unit/integration/E2E test yang belum tercover dari phase sebelumnya (auth.service register-duplicate + refreshToken paths, pay/transfer/register/login DTO validation edge cases)
- [x] `test:concurrency` suite (RC-01, RC-02, RC-03) — **baru bisa dijalankan penuh di phase ini** karena butuh Transfer + Worker (Phase 6) sudah selesai. Juga menambahkan IT-DB-03 (row lock dua koneksi paralel) dan concurrent-register (Section 10) di suite yang sama, karena sama-sama butuh Postgres real dan sama-sama tidak wajib jalan tiap commit.
- [x] Edge cases checklist (TDD Section 10) — lihat catatan di TDD.md Section 11 soal TR-01/TR-02 (fault-injection mid-transaction) yang didokumentasikan sebagai verified-by-review, bukan dipaksa jadi automated test
- [x] Cek coverage: service layer 80%+ (TDD Section 12) — enforced via `coverageThreshold` di package.json (auth/users/transactions/wallet `*.service.ts`, 80% stmt/line/func, 70% branch); semua service saat ini 100% statement coverage kecuali transfer.processor.ts (95%) dan transfer-reconciliation.service.ts (100% stmt, 78% branch)

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
