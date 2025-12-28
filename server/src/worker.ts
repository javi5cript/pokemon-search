/**
 * Worker Process for Background Job Processing
 * 
 * Runs workers to handle:
 * - eBay fetching
 * - Card parsing
 * - Image grading
 * - Pricing lookups
 * - Scoring and ranking
 */

import logger from './lib/logger';
import prisma from './lib/db';
import { ebayService } from './services/ebay';
import { llmService } from './services/llm';
import { priceChartingService } from './services/pricecharting';
import { ListingScorer, FilterCriteria, DEFAULT_WEIGHTS } from './services/scorer';
import type { EbaySearchCriteria } from './services/ebay';
import { searchQueue, ebayFetchQueue, parseQueue, gradeQueue, priceQueue, scoreQueue } from './queues';
import { Worker, Job } from 'bullmq';
import redis from './lib/redis';

// Redis connection options for BullMQ workers
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// ============================================================================
// Job Data Interfaces
// ============================================================================

interface EbayFetchJobData {
  searchId: string;
  criteria: EbaySearchCriteria;
}

interface ParseJobData {
  listingId: string;
}

interface GradeJobData {
  listingId: string;
}

interface PriceJobData {
  listingId: string;
}

interface ScoreJobData {
  listingId: string;
  searchId: string;
}

// ============================================================================
// Worker: eBay Fetch
// ============================================================================

searchQueue.process('ebay-search', async (job) => {
  const { searchId, criteria } = job.data as EbayFetchJobData;
  
  logger.info({ searchId }, 'Starting eBay fetch job');
    
    try {
      // Update search status
      await prisma.search.update({
        where: { id: searchId },
        data: { status: 'PROCESSING' },
      });

      // Fetch listings from eBay
      const listings = await ebayService.searchListings(criteria);
      
      logger.info({ searchId, count: listings.length }, 'eBay fetch complete');

      // Store listings in database
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

          // Queue parse job for this listing
          await parseQueue.add('parse-card', {
            listingId: created.id,
          });

        } catch (error: any) {
          // Handle duplicate ebayItemId
          if (error.code === 'P2002') {
            logger.warn({ ebayItemId: listing.ebayItemId }, 'Duplicate listing, skipping');
          } else {
            logger.error({ error, ebayItemId: listing.ebayItemId }, 'Failed to store listing');
          }
        }
      }

      // Update search with totals
      await prisma.search.update({
        where: { id: searchId },
        data: {
          totalListings: listings.length,
        },
      });

      logger.info({ searchId }, 'eBay fetch job complete');

    } catch (error: any) {
      logger.error({ error, searchId }, 'eBay fetch job failed');
      
      await prisma.search.update({
        where: { id: searchId },
        data: {
          status: 'FAILED',
          error: error.message,
        },
      });

      throw error;
    }
  });

// ============================================================================
// Worker: Card Parser
// ============================================================================

parseQueue.process('parse-card', async (job) => {
  const { listingId } = job.data as ParseJobData;
    
    logger.info({ listingId }, 'Starting parse job');

    try {
      // Get listing
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
      });

      if (!listing) {
        throw new Error('Listing not found');
      }

      // Parse item specifics
      const itemSpecifics = listing.itemSpecifics 
        ? JSON.parse(listing.itemSpecifics) 
        : {};

      // Parse card using LLM
      const parseResult = await llmService.parseCard(
        listing.title,
        listing.description || '',
        itemSpecifics
      );

      // Create or update evaluation
      const evaluation = await prisma.evaluation.upsert({
        where: { listingId },
        create: {
          listingId,
          cardName: parseResult.cardName,
          cardSet: parseResult.set,
          cardNumber: parseResult.cardNumber,
          year: parseResult.year === 'unknown' ? null : parseResult.year,
          language: parseResult.language,
          isHolo: parseResult.isHolo === 'unknown' ? null : (parseResult.isHolo ? 1 : 0),
          isFirstEdition: parseResult.isFirstEdition === 'unknown' ? null : (parseResult.isFirstEdition ? 1 : 0),
          isShadowless: parseResult.isShadowless === 'unknown' ? null : (parseResult.isShadowless ? 1 : 0),
          rarity: parseResult.rarity,
          parseConfidence: parseResult.confidence,
        },
        update: {
          cardName: parseResult.cardName,
          cardSet: parseResult.set,
          cardNumber: parseResult.cardNumber,
          year: parseResult.year === 'unknown' ? null : parseResult.year,
          language: parseResult.language,
          isHolo: parseResult.isHolo === 'unknown' ? null : (parseResult.isHolo ? 1 : 0),
          isFirstEdition: parseResult.isFirstEdition === 'unknown' ? null : (parseResult.isFirstEdition ? 1 : 0),
          isShadowless: parseResult.isShadowless === 'unknown' ? null : (parseResult.isShadowless ? 1 : 0),
          rarity: parseResult.rarity,
          parseConfidence: parseResult.confidence,
        },
      });

      // Queue grading and pricing jobs
      await Promise.all([
        gradeQueue.add('grade-card', { listingId }),
        priceQueue.add('lookup-price', { listingId }),
      ]);

      logger.info({ listingId, confidence: parseResult.confidence }, 'Parse job complete');

  } catch (error: any) {
    logger.error({ error, listingId }, 'Parse job failed');
    throw error;
  }
});

// ============================================================================
// Worker: Image Grader
// ============================================================================

const gradeWorker = new Worker(
  'grade',
  async (job: Job<GradeJobData>) => {
    const { listingId } = job.data;
    
    logger.info({ listingId }, 'Starting grade job');

    try {
      // Get listing and evaluation
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        include: { evaluation: true },
      });

      if (!listing || !listing.evaluation) {
        throw new Error('Listing or evaluation not found');
      }

      // Parse images
      const images = JSON.parse(listing.images);

      // Grade card using LLM vision
      const gradeResult = await llmService.gradeCard(
        images,
        listing.evaluation.cardName || 'unknown',
        listing.evaluation.cardSet || 'unknown',
        listing.evaluation.year || 'unknown'
      );

      // Update evaluation with grading results
      await prisma.evaluation.update({
        where: { id: listing.evaluation.id },
        data: {
          predictedGradeMin: gradeResult.predictedGradeMin,
          predictedGradeMax: gradeResult.predictedGradeMax,
          gradeConfidence: gradeResult.confidence,
          gradeReasoning: gradeResult.gradingReasoning,
          defectFlags: JSON.stringify(gradeResult.defectFlags),
          
          // Centering
          centeringFrontH: gradeResult.centering.frontHorizontal,
          centeringFrontV: gradeResult.centering.frontVertical,
          centeringBackH: gradeResult.centering.backHorizontal,
          centeringBackV: gradeResult.centering.backVertical,
          centeringAssessment: gradeResult.centering.assessment,
          
          // Corners
          cornerTL: gradeResult.corners.topLeft,
          cornerTR: gradeResult.corners.topRight,
          cornerBL: gradeResult.corners.bottomLeft,
          cornerBR: gradeResult.corners.bottomRight,
          cornersAssessment: gradeResult.corners.assessment,
          
          // Edges
          edgeTop: gradeResult.edges.top,
          edgeRight: gradeResult.edges.right,
          edgeBottom: gradeResult.edges.bottom,
          edgeLeft: gradeResult.edges.left,
          edgesAssessment: gradeResult.edges.assessment,
          
          // Surface
          surfaceFront: gradeResult.surface.frontCondition,
          surfaceBack: gradeResult.surface.backCondition,
          surfaceDefects: JSON.stringify(gradeResult.surface.defects),
          surfaceAssessment: gradeResult.surface.assessment,
          
          // Image quality
          imageAdequate: gradeResult.imageQuality.adequateForGrading ? 1 : 0,
          imageMissingViews: JSON.stringify(gradeResult.imageQuality.missingViews),
          imageQualityIssues: JSON.stringify(gradeResult.imageQuality.photoQualityIssues),
          
          overallCondition: gradeResult.overallCondition,
        },
      });

      // Check if both grading and pricing are complete
      await checkAndQueueScoring(listingId, listing.searchId);

      logger.info(
        {
          listingId,
          gradeRange: `${gradeResult.predictedGradeMin}-${gradeResult.predictedGradeMax}`,
        },
        'Grade job complete'
      );

      return { success: true };

    } catch (error: any) {
      logger.error({ error, listingId }, 'Grade job failed');
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5, // Vision API calls are more expensive
  }
);

// ============================================================================
// Worker: Price Lookup
// ============================================================================

const priceWorker = new Worker(
  'price',
  async (job: Job<PriceJobData>) => {
    const { listingId } = job.data;
    
    logger.info({ listingId }, 'Starting price job');

    try {
      // Get listing and evaluation
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        include: { evaluation: true },
      });

      if (!listing || !listing.evaluation) {
        throw new Error('Listing or evaluation not found');
      }

      const eval_ = listing.evaluation;

      // Lookup price
      const priceResult = await priceChartingService.lookupPrice(
        eval_.cardName || 'unknown',
        eval_.cardSet || 'unknown',
        eval_.cardNumber || 'unknown',
        eval_.language || 'English',
        eval_.variant || undefined
      );

      // Update evaluation with pricing
      await prisma.evaluation.update({
        where: { id: eval_.id },
        data: {
          priceFound: priceResult.found ? 1 : 0,
          priceConfidence: priceResult.confidence,
          priceReasoning: priceResult.reasoning,
          marketPriceUngraded: priceResult.priceData?.marketPrice,
          marketPricePSA7: priceResult.priceData?.gradedPrices.psa7,
          marketPricePSA8: priceResult.priceData?.gradedPrices.psa8,
          marketPricePSA9: priceResult.priceData?.gradedPrices.psa9,
          marketPricePSA10: priceResult.priceData?.gradedPrices.psa10,
        },
      });

      // Check if both grading and pricing are complete
      await checkAndQueueScoring(listingId, listing.searchId);

      logger.info({ listingId, found: priceResult.found }, 'Price job complete');

      return { success: true };

    } catch (error: any) {
      logger.error({ error, listingId }, 'Price job failed');
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

// ============================================================================
// Worker: Scoring
// ============================================================================

const scoreWorker = new Worker(
  'score',
  async (job: Job<ScoreJobData>) => {
    const { searchId } = job.data;
    
    logger.info({ searchId }, 'Starting score job');

    try {
      // Get all listings with evaluations for this search
      const listings = await prisma.listing.findMany({
        where: { searchId },
        include: { evaluation: true },
      });

      let processed = 0;
      let qualified = 0;

      // Score each listing
      for (const listing of listings) {
        if (!listing.evaluation) continue;

        // Skip if evaluation is not complete
        if (
          listing.evaluation.gradeConfidence === null ||
          listing.evaluation.priceFound === null
        ) {
          continue;
        }

        processed++;

        // Calculate scores
        const filterCriteria: FilterCriteria = {
          requirePhotos: true,
          minSellerFeedbackScore: 100,
          minSellerFeedbackPercent: 97.0,
          minGradeConfidence: 0.3,
        };

        const scoreResult = ListingScorer.score(
          listing,
          listing.evaluation,
          filterCriteria,
          DEFAULT_WEIGHTS
        );

        // Calculate expected value
        const expectedValue = calculateExpectedValue(listing, listing.evaluation);

        // Update evaluation with scores
        await prisma.evaluation.update({
          where: { id: listing.evaluation.id },
          data: {
            isQualified: scoreResult.qualified ? 1 : 0,
            dealScore: scoreResult.dealScore,
            scorePhotoQuality: scoreResult.scoringResult.componentScores.photoQuality,
            scoreSeller: scoreResult.scoringResult.componentScores.sellerReputation,
            scoreCardId: scoreResult.scoringResult.componentScores.cardIdentification,
            scoreGradeConf: scoreResult.scoringResult.componentScores.gradingConfidence,
            scoreDealMargin: scoreResult.scoringResult.componentScores.dealMargin,
            scoreCompleteness: scoreResult.scoringResult.componentScores.listingCompleteness,
            expectedValue,
            dealMargin: expectedValue - (listing.price + listing.shippingCost),
          },
        });

        if (scoreResult.qualified) {
          qualified++;
        }
      }

      // Update search status
      await prisma.search.update({
        where: { id: searchId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          processedListings: processed,
          qualifiedListings: qualified,
        },
      });

      logger.info(
        { searchId, processed, qualified },
        'Score job complete'
      );

      return { success: true, processed, qualified };

    } catch (error: any) {
      logger.error({ error, searchId }, 'Score job failed');
      
      await prisma.search.update({
        where: { id: searchId },
        data: {
          status: 'FAILED',
          error: error.message,
        },
      });

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if both grading and pricing are complete, then queue scoring
 */
async function checkAndQueueScoring(listingId: string, searchId: string): Promise<void> {
  const evaluation = await prisma.evaluation.findUnique({
    where: { listingId },
  });

  if (!evaluation) return;

  // Check if both grading and pricing are complete
  const hasGrading = evaluation.gradeConfidence !== null;
  const hasPricing = evaluation.priceFound !== null;

  if (hasGrading && hasPricing) {
    // Increment processed count
    await prisma.search.update({
      where: { id: searchId },
      data: {
        processedListings: {
          increment: 1,
        },
      },
    });

    // Check if all listings are processed
    const search = await prisma.search.findUnique({
      where: { id: searchId },
      select: {
        totalListings: true,
        processedListings: true,
      },
    });

    if (search && search.processedListings >= search.totalListings) {
      // Queue final scoring job
      await scoreQueue.add('score-search', { searchId });
    }
  }
}

/**
 * Calculate expected value for a listing
 */
function calculateExpectedValue(
  listing: any,
  evaluation: any
): number {
  const gradeMin = evaluation.predictedGradeMin || 5;
  const confidence = evaluation.gradeConfidence || 0;

  // Map conservative grade to price
  const conservativeGrade = Math.floor(gradeMin);
  let expectedValue = 0;

  if (conservativeGrade >= 10 && evaluation.marketPricePSA10) {
    expectedValue = evaluation.marketPricePSA10;
  } else if (conservativeGrade >= 9 && evaluation.marketPricePSA9) {
    expectedValue = evaluation.marketPricePSA9;
  } else if (conservativeGrade >= 8 && evaluation.marketPricePSA8) {
    expectedValue = evaluation.marketPricePSA8;
  } else if (conservativeGrade >= 7 && evaluation.marketPricePSA7) {
    expectedValue = evaluation.marketPricePSA7;
  } else if (evaluation.marketPriceUngraded) {
    expectedValue = evaluation.marketPriceUngraded;
  }

  // Confidence adjustment
  const confidenceMultiplier = 0.7 + (confidence * 0.3);
  expectedValue *= confidenceMultiplier;

  // Subtract grading cost
  const GRADING_COST = 40;
  expectedValue = Math.max(0, expectedValue - GRADING_COST);

  return expectedValue;
}

// ============================================================================
// Error Handling
// ============================================================================

const workers = [ebayFetchWorker, parseWorker, gradeWorker, priceWorker, scoreWorker];

workers.forEach(worker => {
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, queue: worker.name }, 'Job completed');
  });

  worker.on('failed', (job: Job | undefined, error) => {
    logger.error({ jobId: job?.id, queue: worker.name, error }, 'Job failed');
  });

  worker.on('error', (error: Error) => {
    logger.error({ queue: worker.name, error }, 'Worker error');
  });
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function gracefulShutdown() {
  logger.info('Shutting down workers gracefully...');

  await Promise.all(workers.map(worker => worker.close()));

  await prisma.$disconnect();
  await redis.quit();

  logger.info('Workers shut down');
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

logger.info('Worker process started');
