import { PrismaClient } from '@prisma/client';

/**
 * IT-DB-03 (TDD Section 4) — verifies `SELECT ... FOR UPDATE` genuinely
 * blocks a second connection, rather than letting it read the stale balance
 * concurrently. Uses two independent Prisma connections (two real Postgres
 * sessions), per TDD's explicit instruction ("verifikasi pakai dua koneksi
 * Prisma paralel").
 *
 * Flagged in TDD Section 11 as testable-but-timing-sensitive — lives in
 * test:concurrency (not the default `npm test`/`test:e2e` runs) for that
 * reason.
 */
describe('IT-DB-03: SELECT ... FOR UPDATE blocks a concurrent lock attempt', () => {
  const clientA = new PrismaClient();
  const clientB = new PrismaClient();
  let userId: string;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    await clientA.$connect();
    await clientB.$connect();

    const user = await clientA.user.create({
      data: {
        firstName: 'RowLock',
        lastName: 'Tester',
        phoneNumber: `0825${String(Math.floor(Math.random() * 900000) + 100000)}`,
        address: 'Jl. Row Lock No. 1',
        pinHash: 'not-a-real-hash',
        balance: BigInt(100000),
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await clientA.user.delete({ where: { id: userId } }).catch(() => undefined);
    await clientA.$disconnect();
    await clientB.$disconnect();
  });

  it('a second FOR UPDATE on the same row waits for the first transaction to finish', async () => {
    const events: string[] = [];
    const HOLD_MS = 500;

    const txA = clientA.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE`;
      events.push('A-acquired');
      await sleep(HOLD_MS);
      events.push('A-released');
    });

    // Give A a head start to acquire the lock before B attempts it.
    await sleep(100);

    const txB = clientB.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE`;
      events.push('B-acquired');
    });

    await Promise.all([txA, txB]);

    // B must not have acquired the lock before A released it — proves the
    // second connection genuinely blocked on the row lock instead of
    // reading straight through.
    expect(events.indexOf('B-acquired')).toBeGreaterThan(
      events.indexOf('A-released'),
    );
    expect(events).toEqual(['A-acquired', 'A-released', 'B-acquired']);
  });

  it("unrelated rows are NOT blocked by another row's lock", async () => {
    const otherUser = await clientA.user.create({
      data: {
        firstName: 'RowLock',
        lastName: 'Unrelated',
        phoneNumber: `0825${String(Math.floor(Math.random() * 900000) + 100000)}`,
        address: 'Jl. Row Lock No. 2',
        pinHash: 'not-a-real-hash',
        balance: BigInt(0),
      },
    });

    try {
      const events: string[] = [];

      const txA = clientA.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id, balance FROM users WHERE id = ${userId} FOR UPDATE`;
        events.push('A-acquired');
        await sleep(500);
        events.push('A-released');
      });

      await sleep(100);

      const txB = clientB.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id, balance FROM users WHERE id = ${otherUser.id} FOR UPDATE`;
        events.push('B-acquired-different-row');
      });

      await Promise.all([txA, txB]);

      // Locking a DIFFERENT row must not wait on A's lock.
      expect(events.indexOf('B-acquired-different-row')).toBeLessThan(
        events.indexOf('A-released'),
      );
    } finally {
      await clientA.user
        .delete({ where: { id: otherUser.id } })
        .catch(() => undefined);
    }
  });
});
