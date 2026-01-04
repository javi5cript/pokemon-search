import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPricing() {
  const evals = await prisma.evaluation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 3,
    select: {
      id: true,
      cardName: true,
      cardSet: true,
      cardNumber: true,
      pricingSource: true,
      marketPriceUngraded: true,
      marketPricePsa7: true,
      marketPricePsa8: true,
      marketPricePsa9: true,
      marketPricePsa10: true,
      updatedAt: true,
      listing: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });

  console.log('Recent evaluations:');
  console.log(JSON.stringify(evals, null, 2));
}

checkPricing()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
