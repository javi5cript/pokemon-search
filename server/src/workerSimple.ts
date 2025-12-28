/**
 * Simplified Worker Process for Background Job Processing
 * Compatible with the simple in-memory queue system
 */

import logger from './lib/logger';
import prisma from './lib/db';
import { ebayService } from './services/ebay';
import { llmService } from './services/llm';
import { priceChartingService } from './services/pricecharting';
import { ListingScorer } from './services/scorer';
import type { EbaySearchCriteria } from './services/ebay';
import { searchQueue, parseQueue, gradeQueue, priceQueue, scoreQueue } from './queues';

// Register worker for eBay search/fetch
searchQueue.process('ebay-search', async (job) => {
  const { searchId, criteria } = job.data as { searchId: string; criteria: EbaySearchCriteria };
  logger.info({ searchId }, 'Starting eBay fetch');

  try {
    await prisma.search.update({
      where: { id: searchId },
      data: { status: 'PROCESSING' },
    });

    const listings = await ebayService.searchListings(criteria);
    logger.info({ searchId, count: listings.length }, 'eBay fetch complete');

    for (const listing of listings) {
      try {
        const created = await prisma.listing.create({
          data: {
            searchId,
            ebayItemId: listing.ebayItemId,
            url: listing.url,
            title: listing.title,
            price: listing.price,
            currency: listing.currency,
            shippingCost: listing.shippingCost,
            sellerUsername: listing.sellerUsername,
            sellerFeedbackScore: listing.sellerFeedbackScore,
            sellerFeedbackPercent: listing.sellerFeedbackPercent,
            location: listing.location,
            condition: listing.condition,
            endTime: listing.endTime,
            listingType: listing.listingType,
            images: JSON.stringify(listing.images),
            itemSpecifics: JSON.stringify(listing.itemSpecifics),
            description: listing.description,
            rawPayload: JSON.stringify(listing.rawPayload),
          },
        });

        await parseQueue.add('parse-card', { listingId: created.id });
      } catch (error: any) {
        if (error.code === 'P2002') {
          logger.warn({ ebayItemId: listing.ebayItemId }, 'Duplicate listing');
        } else {
          logger.error({ error }, 'Failed to store listing');
        }
      }
    }

    await prisma.search.update({
      where: { id: searchId },
      data: { totalListings: listings.length },
    });
  } catch (error: any) {
    logger.error({ error, searchId }, 'eBay fetch failed');
    await prisma.search.update({
      where: { id: searchId },
      data: { status: 'FAILED', error: error.message },
    });
    throw error;
  }
});

// Register worker for card parsing
parseQueue.process('parse-card', async (job) => {
  const { listingId } = job.data as { listingId: string };
  logger.info({ listingId }, 'Starting card parse');

  try {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) {
      logger.warn({ listingId }, 'Listing not found');
      return;
    }

    const parseResult = await llmService.parseCard(
      listing.title,
      listing.description || '',
      listing.itemSpecifics ? JSON.parse(listing.itemSpecifics) : {}
    );

    await prisma.evaluation.upsert({
      where: { listingId },
      create: {
        listingId,
        cardName: parseResult.cardName,
        cardSet: parseResult.cardSet,
        cardNumber: parseResult.cardNumber,
        year: parseResult.year,
        language: parseResult.language,
        isHolo: parseResult.isHolo ? 1 : 0,
        isFirstEdition: parseResult.isFirstEdition ? 1 : 0,
        parseConfidence: parseResult.confidence,
        rawParseData: JSON.stringify(parseResult),
      },
      update: {
        cardName: parseResult.cardName,
        cardSet: parseResult.cardSet,
        cardNumber: parseResult.cardNumber,
        year: parseResult.year,
        language: parseResult.language,
        isHolo: parseResult.isHolo ? 1 : 0,
        isFirstEdition: parseResult.isFirstEdition ? 1 : 0,
        parseConfidence: parseResult.confidence,
        rawParseData: JSON.stringify(parseResult),
      },
    });

    await gradeQueue.add('grade-card', { listingId });
    await priceQueue.add('price-lookup', { listingId });
  } catch (error: any) {
    logger.error({ error, listingId }, 'Card parse failed');
    throw error;
  }
});

// Register worker for card grading
gradeQueue.process('grade-card', async (job) => {
  const { listingId } = job.data as { listingId: string };
  logger.info({ listingId }, 'Starting card grade');

  try {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { evaluation: true },
    });

    if (!listing || !listing.evaluation) {
      logger.warn({ listingId }, 'Listing or evaluation not found');
      return;
    }

    const images = JSON.parse(listing.images) as string[];
    if (images.length === 0) {
      logger.warn({ listingId }, 'No images to grade');
      return;
    }

    const gradeResult = await llmService.gradeCard(
      images[0],
      listing.title,
      listing.description || ''
    );

    await prisma.evaluation.update({
      where: { listingId },
      data: {
        estimatedGrade: gradeResult.estimatedGrade,
        estimatedGradeMin: gradeResult.gradeRange.min,
        estimatedGradeMax: gradeResult.gradeRange.max,
        gradingConfidence: gradeResult.confidence,
        centeringScore: gradeResult.condition.centering,
        cornersScore: gradeResult.condition.corners,
        edgesScore: gradeResult.condition.edges,
        surfaceScore: gradeResult.condition.surface,
        damageFlags: JSON.stringify(gradeResult.damageFlags),
        rawGradeData: JSON.stringify(gradeResult),
      },
    });

    await checkAndQueueScoring(listingId);
  } catch (error: any) {
    logger.error({ error, listingId }, 'Card grade failed');
    throw error;
  }
});

// Register worker for price lookup
priceQueue.process('price-lookup', async (job) => {
  const { listingId } = job.data as { listingId: string };
  logger.info({ listingId }, 'Starting price lookup');

  try {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { evaluation: true },
    });

    if (!listing || !listing.evaluation) {
      logger.warn({ listingId }, 'Listing or evaluation not found');
      return;
    }

    const priceResult = await priceChartingService.lookupPrice({
      cardName: listing.evaluation.cardName || '',
      cardSet: listing.evaluation.cardSet || '',
      cardNumber: listing.evaluation.cardNumber || undefined,
      year: listing.evaluation.year || undefined,
    });

    if (!priceResult) {
      logger.warn({ listingId }, 'No pricing found');
      return;
    }

    await prisma.evaluation.update({
      where: { listingId },
      data: {
        marketPrice: priceResult.ungraded.price,
        marketPriceDate: priceResult.ungraded.date,
        marketPriceGraded7: priceResult.graded?.psa7?.price,
        marketPriceGraded8: priceResult.graded?.psa8?.price,
        marketPriceGraded9: priceResult.graded?.psa9?.price,
        marketPriceGraded10: priceResult.graded?.psa10?.price,
        rawPriceData: JSON.stringify(priceResult),
      },
    });

    await checkAndQueueScoring(listingId);
  } catch (error: any) {
    logger.error({ error, listingId }, 'Price lookup failed');
    throw error;
  }
});

// Register worker for scoring
scoreQueue.process('score-listing', async (job) => {
  const { listingId } = job.data as { listingId: string };
  logger.info({ listingId }, 'Starting scoring');

  try {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { evaluation: true },
    });

    if (!listing || !listing.evaluation) {
      logger.warn({ listingId }, 'Listing or evaluation not found');
      return;
    }

    const scorer = new ListingScorer();
    const result = await scorer.score(listing as any, listing.evaluation as any);

    await prisma.evaluation.update({
      where: { listingId },
      data: {
        isQualified: result.passed ? 1 : 0,
        dealScore: result.dealScore,
        expectedValue: result.expectedValue,
        failedFilters: result.failedFilters.length > 0 ? JSON.stringify(result.failedFilters) : null,
        scoreBreakdown: JSON.stringify(result.scoreBreakdown),
      },
    });

    await prisma.search.update({
      where: { id: listing.searchId },
      data: {
        processedListings: { increment: 1 },
        qualifiedListings: result.passed ? { increment: 1 } : undefined,
      },
    });

    const search = await prisma.search.findUnique({ where: { id: listing.searchId } });
    if (search && search.processedListings >= search.totalListings && search.totalListings > 0) {
      await prisma.search.update({
        where: { id: listing.searchId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      logger.info({ searchId: listing.searchId }, 'Search complete');
    }
  } catch (error: any) {
    logger.error({ error, listingId }, 'Scoring failed');
    throw error;
  }
});

// Helper function
async function checkAndQueueScoring(listingId: string) {
  const evaluation = await prisma.evaluation.findUnique({ where: { listingId } });
  if (!evaluation) return;

  const hasGrading = evaluation.estimatedGrade !== null;
  const hasPricing = evaluation.marketPrice !== null;

  if (hasGrading && hasPricing) {
    await scoreQueue.add('score-listing', { listingId });
  }
}

logger.info('✅ Workers initialized');

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
