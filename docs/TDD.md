# Test Plan & Testing Design Document (TDD)
## Digital Wallet API

**Versi:** 1.0
**Referensi:** PRD.md (acceptance criteria), SRS.md (error codes & endpoint contract), SYSTEM_DESIGN.md (Section 11 — daftar skenario yang wajib ditest)

> Catatan penamaan: "TDD" di sini singkatan **Test Design Document**, bukan metodologi Test-Driven Development. Dokumen ini rencana testing, bukan aturan "nulis test dulu sebelum kode".

---

## 1. Test Strategy

Test pyramid untuk project ini:

```
        ▲  sedikit, mahal, lambat
        │   E2E / API test (Supertest, hit real endpoint + real test DB)
        │
        │   Integration test (Prisma + real Postgres test container,
        │   verifikasi lock & transaksi DB beneran jalan)
        │
        ▼  banyak, murah, cepat
           Unit test (business logic murni, dependency di-mock)
```

**Prinsip pembagian:** logic yang bisa diuji tanpa DB/Redis beneran (validasi, kalkulasi saldo, format error) → unit test, mock semua dependency. Logic yang correctness-nya **bergantung pada perilaku DB sungguhan** (row lock, unique constraint, atomicity transaksi) → wajib integration test dengan Postgres asli, bukan mock — karena mock tidak bisa mensimulasikan race condition atau constraint violation dengan akurat.

---

## 2. Tools & Environment

| Kebutuhan | Tool |
|---|---|
| Test runner | Jest (default NestJS) |
| API/E2E test | Supertest |
| Test database | PostgreSQL asli via `docker-compose.test.yml` (bukan SQLite/mock — lihat Section 1) |
| Test queue | Redis asli via container terpisah untuk test worker (Section 9) |
| Manual/demo testing | Postman collection |
| CI | GitHub Actions — jalankan `docker compose -f docker-compose.test.yml up` lalu `npm test` |

**Kenapa Postman bukan test suite utama:** Postman collection tetap dibuat (diminta di requirement), tapi isinya fokus ke **happy path + beberapa kegagalan kunci** untuk demo manual/dokumentasi API — bukan tempat menaruh seluruh skenario edge case. Skenario lengkap (race condition, idempotency, rollback) hidup di Jest karena itu yang bisa dijalankan otomatis di CI dan dihitung coverage-nya. Duplikasi seluruh test case ke dua tempat (Postman + Jest) buang waktu tanpa nambah manfaat.

---

## 3. Unit Test Plan

### 3.1 AuthService
| ID | Skenario | Expected |
|---|---|---|
| UT-AUTH-01 | Hash PIN saat register | `pin_hash` tidak sama dengan `pin` asli, `bcrypt.compare` balik true |
| UT-AUTH-02 | Verifikasi PIN saat login — cocok | return user object |
| UT-AUTH-03 | Verifikasi PIN saat login — tidak cocok | throw `INVALID_CREDENTIALS` |
| UT-AUTH-04 | Generate JWT | payload berisi `user_id` saja, `exp` sesuai 15m/7d |
| UT-AUTH-05 | Counter failed login bertambah tiap gagal | counter naik, reset ke 0 saat berhasil login |
| UT-AUTH-06 | Counter mencapai 5 | akun berstatus locked, `locked_until` terisi |

### 3.2 WalletService (topup/payment/transfer — logic murni, DB di-mock)
| ID | Skenario | Expected |
|---|---|---|
| UT-WALLET-01 | Top up amount di bawah minimum | throw `VALIDATION_ERROR` |
| UT-WALLET-02 | Payment amount > saldo | throw `INSUFFICIENT_BALANCE`, tidak panggil update balance |
| UT-WALLET-03 | Transfer ke `phone_number` sendiri | throw `SELF_TRANSFER_NOT_ALLOWED` sebelum query DB apa pun |
| UT-WALLET-04 | Transfer ke `phone_number` tidak terdaftar | throw `RECIPIENT_NOT_FOUND` |
| UT-WALLET-05 | Hitung `balance_after` | `balance_before - amount` tepat, tidak ada floating point error (pakai BigInt/integer) |

### 3.3 TransactionsService
| ID | Skenario | Expected |
|---|---|---|
| UT-TXN-01 | Query hanya transaksi milik `user_id` yang login | tidak bocor data user lain |
| UT-TXN-02 | Default pagination | `page=1, limit=20` kalau query param kosong |
| UT-TXN-03 | Urutan hasil | terbaru dulu (`created_at DESC`) |

---

## 4. Integration Test Plan (Postgres asli)

| ID | Skenario | Expected |
|---|---|---|
| IT-DB-01 | Insert user dengan `phone_number` duplikat | unique constraint violation ditangkap, jadi `PHONE_NUMBER_ALREADY_REGISTERED`, bukan 500 mentah |
| IT-DB-02 | Insert `payment`/`transfer` dengan `idempotency_key` yang sama | constraint violation, endpoint return record lama (bukan bikin baru) |
| IT-DB-03 | `SELECT ... FOR UPDATE` dalam transaksi | row benar-benar terkunci — request kedua yang coba update row sama harus **menunggu**, bukan langsung baca nilai lama (verifikasi pakai dua koneksi Prisma paralel) |
| IT-DB-04 | Rollback saat error di tengah transaksi | Section 5 |

---

## 5. Transaction & Rollback Test Plan

Simulasikan error **di tengah** transaksi DB (mis. constraint violation pada `INSERT transactions` setelah `UPDATE users.balance` sudah dieksekusi tapi belum commit) dan pastikan **semuanya di-rollback**, bukan cuma sebagian.

| ID | Skenario | Expected |
|---|---|---|
| TR-01 | Error di step terakhir transaksi payment (insert ledger gagal) | saldo user **tidak berubah** — dicek ulang dari DB setelah exception, bukan asumsi dari kode |
| TR-02 | Error di step terakhir transaksi transfer (debit sender) | saldo sender tidak berubah, tidak ada row `transfers` yang ke-insert setengah jadi |
| TR-03 | Worker error setelah kredit recipient tapi sebelum update status transfer | (lihat Section 9 — ini kasus khusus karena melibatkan job retry, bukan cuma DB rollback biasa) |

---

## 6. API / E2E Test Plan

Setiap baris di sini map langsung ke acceptance criteria PRD dan error code SRS — supaya kalau ada AC di PRD yang berubah, gampang ketauan test mana yang perlu diupdate.

### 6.1 Register (`POST /register`) → PRD 6.1
| ID | AC PRD | Expected |
|---|---|---|
| E2E-REG-01 | phone_number baru | 201, `user_id` UUID valid, response tidak mengandung `pin` |
| E2E-REG-02 | phone_number duplikat | 409, `PHONE_NUMBER_ALREADY_REGISTERED` |
| E2E-REG-03 | PIN bukan 6 digit | 400, `VALIDATION_ERROR` |

### 6.2 Login (`POST /login`) → PRD 6.2
| ID | Skenario | Expected |
|---|---|---|
| E2E-LOGIN-01 | Kredensial benar | 200, dapat `access_token` + `refresh_token` |
| E2E-LOGIN-02 | PIN salah | 401, `INVALID_CREDENTIALS`, counter naik |
| E2E-LOGIN-03 | PIN salah 5x berturut-turut, percobaan ke-6 | 429, `ACCOUNT_LOCKED` — walau PIN yang ke-6 ini benar |

### 6.3 Refresh Token → SRS 3.3
| ID | Skenario | Expected |
|---|---|---|
| E2E-REFRESH-01 | refresh_token valid | 200, access_token baru |
| E2E-REFRESH-02 | refresh_token revoked/expired | 401, `INVALID_REFRESH_TOKEN` |

### 6.4 Profile → PRD 6.7
| ID | Skenario | Expected |
|---|---|---|
| E2E-PROFILE-01 | Update nama & alamat | 200, data tersimpan |
| E2E-PROFILE-02 | Request menyertakan `phone_number` di body | field diabaikan, `phone_number` di DB tidak berubah |
| E2E-PROFILE-03 | Tanpa token | 401, `UNAUTHENTICATED` |

### 6.5 Top Up → PRD 6.3
| ID | Skenario | Expected |
|---|---|---|
| E2E-TOPUP-01 | amount valid | 201, `balance_after = balance_before + amount` |
| E2E-TOPUP-02 | amount di bawah minimum | 400 |
| E2E-TOPUP-03 | tanpa token | 401 |

### 6.6 Payment → PRD 6.4
| ID | Skenario | Expected |
|---|---|---|
| E2E-PAY-01 | saldo cukup | 201, saldo berkurang tepat |
| E2E-PAY-02 | saldo tidak cukup | 422, `INSUFFICIENT_BALANCE`, saldo tidak berubah |
| E2E-PAY-03 | Idempotency-Key sama, payload sama, request diulang | response identik dengan request pertama, tidak ada payment baru |
| E2E-PAY-04 | Idempotency-Key sama, payload beda | 409, `DUPLICATE_IDEMPOTENCY_KEY` |

### 6.7 Transfer → PRD 6.5
| ID | Skenario | Expected |
|---|---|---|
| E2E-TRF-01 | saldo cukup, recipient valid | 201, saldo sender berkurang instan, job masuk queue (assert via mock queue di E2E, atau cek Bull Board API di test integrasi worker) |
| E2E-TRF-02 | saldo tidak cukup | 422, `INSUFFICIENT_BALANCE` |
| E2E-TRF-03 | target = diri sendiri | 422, `SELF_TRANSFER_NOT_ALLOWED` |
| E2E-TRF-04 | target phone_number tidak terdaftar | 404, `RECIPIENT_NOT_FOUND` |

### 6.8 Report Transactions → PRD 6.6
| ID | Skenario | Expected |
|---|---|---|
| E2E-TXN-01 | User punya 3 jenis transaksi | ketiganya muncul dengan `transaction_type` benar |
| E2E-TXN-02 | Pagination `page=2&limit=1` | hasil sesuai offset |
| E2E-TXN-03 | User B tidak lihat transaksi User A | isolasi data terverifikasi |

---

## 7. Race Condition / Concurrency Test Plan

Ini bagian tersulit untuk diautomasi dengan reliable — dibahas jujur di Section 11.

| ID | Skenario | Cara test | Expected |
|---|---|---|---|
| RC-01 | Dua request `/payment` bersamaan, saldo cukup untuk salah satu tapi tidak untuk keduanya | `Promise.all([request1, request2])` ke API real dengan test DB Postgres real | Tepat satu yang sukses, satu lagi `INSUFFICIENT_BALANCE`. Saldo akhir konsisten (tidak jadi negatif). |
| RC-02 | Dua request `/transfer` bersamaan dari sender sama | sama seperti RC-01 | Sama — row lock `FOR UPDATE` mencegah keduanya baca saldo lama secara bersamaan |
| RC-03 | Dua request dengan `Idempotency-Key` sama, dikirim bersamaan (bukan berurutan) | `Promise.all` dua request identik | Cuma satu yang benar-benar insert; yang kedua kena unique constraint, sistem menangkapnya dan return hasil yang sama (bukan race jadi dua-duanya insert) |

**Cara run test ini secara reliable:** gunakan Postgres real (bukan mock), dan assert bukan cuma response HTTP tapi juga **nilai balance final di DB** setelah kedua request selesai — supaya kalaupun response-nya "kelihatan benar" tapi ada race condition di level DB, itu ketauan dari saldo yang salah.

---

## 8. Authentication Test Plan

Sudah tercakup di Section 6.2–6.3, ditambah:

| ID | Skenario | Expected |
|---|---|---|
| AUTH-EDGE-01 | access_token expired dipakai ke endpoint protected | 401, bukan crash |
| AUTH-EDGE-02 | access_token malformed/signature invalid | 401 |
| AUTH-EDGE-03 | Header `Authorization` tanpa `Bearer` prefix | 401, ditangani gracefully |

---

## 9. Queue & Background Worker Test Plan

| ID | Skenario | Cara test | Expected |
|---|---|---|---|
| Q-01 | Job diproses sukses sekali | Panggil `processor.process(fakeJob)` langsung dengan test DB, tanpa lewat Redis beneran | Recipient balance bertambah, status `SUCCESS` |
| Q-02 | Job yang sama diproses **dua kali** (simulasi retry setelah crash) | Panggil `process()` dua kali dengan `transferId` sama | Recipient balance **cuma nambah sekali** — idempotency check (SYSTEM_DESIGN 6.4) terbukti jalan |
| Q-03 | Job gagal terus sampai max attempts | Mock processor throw error, biarkan BullMQ retry habis (pakai Redis test container beneran) | Refund handler jalan, saldo sender kembali, status `FAILED` |
| Q-04 | Reconciliation sweep | Insert `transfers` status `PENDING` dengan `created_at` di masa lalu, panggil fungsi sweep manual | `queue.add()` terpanggil dengan `transferId` yang tepat |

**Catatan penting soal Q-03:** backoff production (`2s, 4s, 8s, 16s, 32s`) kalau dipakai apa adanya di test, total nunggu bisa >1 menit **per test case** — bikin CI lambat. Solusinya: buat konfigurasi `attempts`/`backoff` **injectable lewat env var**, override jadi delay milidetik (`10ms, 20ms, ...`) khusus di environment test. Ini keputusan desain kecil yang perlu ditambahkan balik ke `transfer.service.ts` di SYSTEM_DESIGN — bukan cuma soal testing, tapi supaya kode itu sendiri testable.

---

## 10. Edge Cases Checklist

- [ ] `amount` bertipe string di JSON request (`"amount": "100000"`) — harus ditolak validasi, bukan di-cast diam-diam.
- [ ] `amount` negatif atau nol.
- [ ] `amount` desimal (`100000.5`) — ditolak, karena saldo integer (SRS 7.1).
- [ ] Request body kosong / bukan JSON valid.
- [ ] `phone_number` format internasional (`+62...`) vs lokal (`0811...`) — konsisten diterima sesuai regex SRS 6.
- [ ] Transfer dengan `amount` yang pas sama dengan saldo (`balance_after = 0`) — harus sukses, bukan ketolak keliru.
- [ ] Concurrent request register dengan `phone_number` sama persis (mirip RC-03 tapi untuk register).

---

## 11. Keterbatasan Testability — Jujur soal Batasannya

Beberapa skenario di SYSTEM_DESIGN Section 10 (Risiko & Mitigasi) **tidak semuanya realistis diautomasi** dengan effort yang wajar untuk scope project ini:

- **"Redis mati persis di antara commit dan enqueue"** (SYSTEM_DESIGN 6.5) — mensimulasikan ini butuh fault injection (mis. kill koneksi Redis di tengah eksekusi kode), yang rapuh dan flaky kalau dipaksa jadi automated test. **Rekomendasi:** verifikasi logic reconciliation sweep-nya sendiri (Q-04 di atas, yang testable), tapi skenario "Redis mati di waktu X" cukup didokumentasikan sebagai known scenario yang ditangani, dicek lewat code review — bukan dipaksa jadi test case otomatis yang bakal sering false-fail di CI.
- **Row lock (`FOR UPDATE`) beneran nge-block** (IT-DB-03, RC-01/02) — testable, tapi butuh koneksi Postgres paralel yang sengaja didesain untuk race dengan timing presisi. Test ini valid tapi lebih lambat & lebih rentan flaky dibanding unit test biasa — taruh di suite terpisah (`test:concurrency`) yang tidak wajib jalan tiap commit, cukup di CI sebelum merge ke main.

Ini bukan alasan untuk skip — tapi supaya realistis: tidak semua baris di Section 10 SYSTEM_DESIGN akan punya automated test 1-banding-1. Sebagian besar iya, satu-dua butuh manual verification yang didokumentasikan.

- **TR-01/TR-02 (Section 5) — error di step terakhir transaksi (mis. insert ledger gagal setelah balance sudah di-update dalam memori tx)** — dicoba dicari cara fault-injection yang realistis dari luar (tanpa nambah test-only hook ke source code) saat Phase 8, dan tidak ketemu yang tidak fragile: satu-satunya trigger constraint violation asli di tengah transaksi payment/transfer (unique constraint `idempotency_key`) sudah otomatis jadi jalur RC-03/IT-DB-02, bukan skenario TR yang berdiri sendiri. Yang tervalidasi sebagai gantinya: (1) unit test bermock (`payment.service.spec.ts`, `transfer.service.spec.ts`) yang membuktikan saat `$transaction` reject, tidak ada panggilan balance-update/insert lain di luar callback itu; (2) RC-03 di `test:concurrency` yang membuktikan secara end-to-end di Postgres asli bahwa saat insert kedua gagal karena constraint, saldo cuma ke-debit sekali (bukti rollback beneran jalan, bukan cuma asumsi kode). Atomicity `$transaction` sendiri adalah jaminan Prisma/Postgres, bukan sesuatu yang bisa dirusak oleh logic aplikasi ini karena semua mutation (balance + ledger) memang satu callback yang sama.

---

## 12. Coverage Target

- Service layer (business logic): target 80%+.
- Controller/DTO (thin layer, banyak boilerplate): tidak dipaksa 80% — lebih penting E2E test-nya lolos daripada baris coverage controller.
- `test:concurrency` suite (Section 7, 11): dijalankan terpisah, tidak masuk hitungan coverage percentage (karena sifatnya integration test lambat), tapi wajib lolos sebelum merge.

## 13. Item untuk Roadmap (dokumen terakhir)

- Urutan implementasi: unit test bisa ditulis paralel dengan development tiap service (bukan menunggu semua fitur selesai).
- `test:concurrency` baru bisa jalan penuh setelah Transfer + Worker (Phase 5) selesai — jangan taruh di Phase 6 paling awal kalau dependency-nya belum ada.
- Setup `docker-compose.test.yml` (Postgres + Redis test) sebaiknya masuk Phase 1, bukan Phase 6 — supaya tim (atau diri sendiri) bisa nulis test dari awal, bukan nunggu akhir.
