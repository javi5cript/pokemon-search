/**
 * In-Memory Job Processors
 * Registers job handlers for the in-memory queue
 */

import logger from './lib/logger';
import prisma from './lib/db';
import { ebayService } from './services/ebay';
import { llmService } from './services/llm';
import { priceChartingService } from './services/pricecharting';
import { ListingScorer } from './services/scorer';
import { searchQueue, parseQueue, gradeQueue, priceQueue, scoreQueue } from './queues';
import type { EbaySearchCriteria } from './services/ebay';

interface SearchJobData {
  searchId: string;
  criteria: {
    keywords: string[];
    category?: string;
    condition?: string[];
    minPrice?: number;
    maxPrice?: number;
    listingType?: 'auction' | 'buyItNow' | 'all';
    location?: string;
    shippingOptions?: string[];
  };
}

/**
 * Process eBay search job
 */
searchQueue.process('ebay-search', async (job) => {
  const { searchId, criteria } = job.data as SearchJobData;
  
  logger.info({ searchId, criteria }, 'Processing eBay search job');

  try {
    // Update search status
    await prisma.search.update({
      where: { id: searchId },
      data: { status: 'IN_PROGRESS' },
    });

    // Build eBay search criteria
    const ebayCriteria: EbaySearchCriteria = {
      keywords: criteria.keywords,
      // Don't filter by category, condition, price, etc in sandbox
      // Sandbox has limited test data
      maxResults: 50,
    };

    // Search eBay
    logger.info({ searchId, ebayCriteria, originalCriteria: criteria }, 'Fetching listings from eBay');
    const listings = await ebayService.searchListings(ebayCriteria);
    
    logger.info({ searchId, count: listings.length }, 'Received eBay listings');

    if (listings.length === 0) {
      await prisma.search.update({
        where: { id: searchId },
        data: {
          status: 'COMPLETED',
          totalListings: 0,
          completedAt: new Date(),
        },
      });
      logger.warn({ searchId }, 'No listings found');
      return;
    }

    // Save listings to database
    let savedCount = 0;
    for (const listing of listings) {
      try {
        const created = await prisma.listing.create({
          data: {
            searchId: searchId,
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
        savedCount++;
        
        // Queue parsing job for this listing
        await parseQueue.add('parse-card', { listingId: created.id });
      } catch (error) {
        logger.error({ error, listingId: listing.ebayItemId }, 'Failed to save listing');
      }
    }

    // Update search with results
    await prisma.search.update({
      where: { id: searchId },
      data: {
        status: 'COMPLETED',
        totalListings: savedCount,
        processedListings: savedCount,
        completedAt: new Date(),
      },
    });

    logger.info({ searchId, savedCount }, 'Search completed successfully');
  } catch (error) {
    logger.error({ error, searchId }, 'Search job failed');
    
    await prisma.search.update({
      where: { id: searchId },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    
    throw error;
  }
});

/**
 * Process card parsing job
 */
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
        cardName: parseResult.cardName === 'unknown' ? null : parseResult.cardName,
        cardSet: parseResult.set === 'unknown' ? null : parseResult.set,
        cardNumber: parseResult.cardNumber === 'unknown' ? null : parseResult.cardNumber,
        year: parseResult.year === 'unknown' ? null : parseResult.year,
        language: parseResult.language === 'unknown' ? null : parseResult.language,
        isHolo: typeof parseResult.isHolo === 'boolean' ? (parseResult.isHolo ? 1 : 0) : null,
        isFirstEdition: typeof parseResult.isFirstEdition === 'boolean' ? (parseResult.isFirstEdition ? 1 : 0) : null,
        isShadowless: typeof parseResult.isShadowless === 'boolean' ? (parseResult.isShadowless ? 1 : 0) : null,
        rarity: parseResult.rarity === 'unknown' ? null : parseResult.rarity,
        parseConfidence: parseResult.confidence,
        parseMetadata: JSON.stringify(parseResult),
      },
      update: {
        cardName: parseResult.cardName === 'unknown' ? null : parseResult.cardName,
        cardSet: parseResult.set === 'unknown' ? null : parseResult.set,
        cardNumber: parseResult.cardNumber === 'unknown' ? null : parseResult.cardNumber,
        year: parseResult.year === 'unknown' ? null : parseResult.year,
        language: parseResult.language === 'unknown' ? null : parseResult.language,
        isHolo: typeof parseResult.isHolo === 'boolean' ? (parseResult.isHolo ? 1 : 0) : null,
        isFirstEdition: typeof parseResult.isFirstEdition === 'boolean' ? (parseResult.isFirstEdition ? 1 : 0) : null,
        isShadowless: typeof parseResult.isShadowless === 'boolean' ? (parseResult.isShadowless ? 1 : 0) : null,
        rarity: parseResult.rarity === 'unknown' ? null : parseResult.rarity,
        parseConfidence: parseResult.confidence,
        parseMetadata: JSON.stringify(parseResult),
      },
    });

    logger.info({ listingId, cardName: parseResult.cardName }, 'Card parsed successfully');
    
    // Queue grading and pricing jobs
    await gradeQueue.add('grade-card', { listingId });
    await priceQueue.add('price-lookup', { listingId });
  } catch (error) {
    logger.error({ error, listingId }, 'Card parse failed');
    throw error;
  }
});

/**
 * Process card grading job
 */
gradeQueue.process('grade-card', async (job) => {
  const { listingId } = job.data as { listingId: string };
  logger.info({ listingId }, 'Starting card grading');

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
      await prisma.evaluation.update({
        where: { listingId },
        data: { gradingDetails: JSON.stringify({ error: 'No images available' }) },
      });
      return;
    }

    const gradeResult = await llmService.gradeCard(images);

    await prisma.evaluation.update({
      where: { listingId },
      data: {
        predictedGradeMin: gradeResult.predictedGradeMin,
        predictedGradeMax: gradeResult.predictedGradeMax,
        gradeConfidence: gradeResult.confidence,
        defectFlags: JSON.stringify(gradeResult.defectFlags),
        gradeReasoning: gradeResult.gradingReasoning,
        gradingDetails: JSON.stringify({
          centering: gradeResult.centering,
          corners: gradeResult.corners,
          edges: gradeResult.edges,
          surface: gradeResult.surface,
          imageQuality: gradeResult.imageQuality,
        }),
        // Store individual grading components
        centeringFrontH: parseFloat(gradeResult.centering.frontHorizontal) || null,
        centeringFrontV: parseFloat(gradeResult.centering.frontVertical) || null,
        centeringBackH: gradeResult.centering.backHorizontal !== 'unknown' 
          ? parseFloat(gradeResult.centering.backHorizontal) 
          : null,
        centeringBackV: gradeResult.centering.backVertical !== 'unknown' 
          ? parseFloat(gradeResult.centering.backVertical) 
          : null,
        cornerTL: gradeResult.corners.topLeft,
        cornerTR: gradeResult.corners.topRight,
        cornerBL: gradeResult.corners.bottomLeft,
        cornerBR: gradeResult.corners.bottomRight,
        edgeTop: gradeResult.edges.top,
        edgeRight: gradeResult.edges.right,
        edgeBottom: gradeResult.edges.bottom,
        edgeLeft: gradeResult.edges.left,
        surfaceFront: gradeResult.surface.frontCondition,
        surfaceBack: gradeResult.surface.backCondition !== 'unknown' 
          ? gradeResult.surface.backCondition 
          : null,
        imageAdequate: gradeResult.imageQuality.adequateForGrading ? 1 : 0,
      },
    });

    logger.info({ listingId, gradeMin: gradeResult.predictedGradeMin, gradeMax: gradeResult.predictedGradeMax }, 'Card graded successfully');
    
    // Queue scoring job
    await scoreQueue.add('score-deal', { listingId });
  } catch (error) {
    logger.error({ error, listingId }, 'Card grading failed');
    throw error;
  }
});

/**
 * Process price lookup job
 */
priceQueue.process('price-lookup', async (job) => {
  const { listingId } = job.data as { listingId: string };
  logger.info({ listingId }, 'Starting price lookup');

  try {
    const evaluation = await prisma.evaluation.findUnique({
      where: { listingId },
    });

    if (!evaluation || !evaluation.cardName || !evaluation.cardSet) {
      logger.warn({ listingId }, 'Evaluation incomplete, skipping pricing');
      return;
    }

    const priceData = await priceChartingService.getCardPrices(
      evaluation.cardName,
      evaluation.cardSet,
      evaluation.cardNumber
    );

    if (priceData) {
      await prisma.evaluation.update({
        where: { listingId },
        data: {
          marketPriceUngraded: priceData.ungraded,
          marketPricePsa7: priceData.psa7,
          marketPricePsa8: priceData.psa8,
          marketPricePsa9: priceData.psa9,
          marketPricePsa10: priceData.psa10,
          pricingConfidence: priceData.confidence,
          pricingSource: priceData.source,
        },
      });

      logger.info({ listingId }, 'Pricing data retrieved');
      
      // Queue scoring job (in case grading already completed)
      await scoreQueue.add('score-deal', { listingId });
    }
  } catch (error) {
    logger.error({ error, listingId }, 'Price lookup failed');
    throw error;
  }
});

/**
 * Process deal scoring job
 */
scoreQueue.process('score-deal', async (job) => {
  const { listingId } = job.data as { listingId: string };
  logger.info({ listingId }, 'Starting deal scoring');

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
    const scoreResult = scorer.scoreListing(listing, listing.evaluation);

    await prisma.evaluation.update({
      where: { listingId },
      data: {
        expectedValue: scoreResult.expectedValue,
        dealMargin: scoreResult.dealMargin,
        dealScore: scoreResult.dealScore,
        isQualified: scoreResult.isQualified ? 1 : 0,
        qualificationFlags: JSON.stringify(scoreResult.qualificationFlags),
        softScores: JSON.stringify(scoreResult.softScores),
      },
    });

    logger.info({ listingId, dealScore: scoreResult.dealScore, isQualified: scoreResult.isQualified }, 'Deal scored successfully');

    // Update search progress
    const search = await prisma.search.findUnique({
      where: { id: listing.searchId },
      include: { _count: { select: { listings: true } } },
    });

    if (search) {
      const processedCount = await prisma.evaluation.count({
        where: {
          listing: { searchId: listing.searchId },
          dealScore: { not: null },
        },
      });

      await prisma.search.update({
        where: { id: listing.searchId },
        data: {
          processedListings: processedCount,
          status: processedCount >= (search.totalListings || 0) ? 'COMPLETED' : 'PROCESSING',
          completedAt: processedCount >= (search.totalListings || 0) ? new Date() : null,
        },
      });
    }
  } catch (error) {
    logger.error({ error, listingId }, 'Deal scoring failed');
    throw error;
  }
});

logger.info('Job processors registered');
