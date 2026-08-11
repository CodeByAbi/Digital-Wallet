import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const pinHash = await bcrypt.hash('123456', 10);

  const alice = await prisma.user.upsert({
    where: { phoneNumber: '081200000001' },
    update: {},
    create: {
      firstName: 'Alice',
      lastName: 'Wonder',
      phoneNumber: '081200000001',
      address: 'Jl. Contoh No. 1, Jakarta',
      pinHash,
      balance: 1_000_000,
    },
  });

  const bob = await prisma.user.upsert({
    where: { phoneNumber: '081200000002' },
    update: {},
    create: {
      firstName: 'Bob',
      lastName: 'Builder',
      phoneNumber: '081200000002',
      address: 'Jl. Contoh No. 2, Jakarta',
      pinHash,
      balance: 500_000,
    },
  });

  console.log({ alice: alice.phoneNumber, bob: bob.phoneNumber });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
