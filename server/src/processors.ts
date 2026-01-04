/**
 * In-Memory Job Processors
 * Registers job handlers for the in-memory queue
 */

import logger from './lib/logger';
import prisma from './lib/db';
import { ebayService } from './services/ebay';
import { llmService } from './services/llm';
import { justTCGService } from './services/justtcg';
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

    // Update search with results - set to PROCESSING since we need to evaluate them
    await prisma.search.update({
      where: { id: searchId },
      data: {
        status: 'PROCESSING',
        totalListings: savedCount,
        processedListings: 0, // Will be updated as listings are scored
        completedAt: null,
      },
    });

    logger.info({ searchId, savedCount }, 'Search listings fetched, starting processing pipeline');
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
 * Process card parsing job - Enhanced with image-based identification
 */
parseQueue.process('parse-card', async (job) => {
  const { listingId } = job.data as { listingId: string };
  logger.info({ listingId }, 'Starting enhanced card parse with image analysis');

  try {
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) {
      logger.warn({ listingId }, 'Listing not found');
      return;
    }

    // Step 1: Text-based parsing (fast, but may be incomplete)
    const textParseResult = await llmService.parseCard(
      listing.title,
      listing.description || '',
      listing.itemSpecifics ? JSON.parse(listing.itemSpecifics) : {}
    );

    // Step 2: Image-based identification (more accurate, especially for set info)
    let finalResult = textParseResult;
    const images = listing.images ? JSON.parse(listing.images) : [];
    
    if (images.length > 0) {
      try {
        const imageIdentification = await llmService.identifyCardFromImage(
          images,
          listing.title,
          listing.description || ''
        );

        // Merge results: Prefer image data for critical fields (set, cardNumber)
        // But use text data as fallback if image parsing fails
        finalResult = {
          ...textParseResult,
          // Prefer image data for these critical fields
          cardName: imageIdentification.cardName !== 'unknown' ? imageIdentification.cardName : textParseResult.cardName,
          set: imageIdentification.set !== 'unknown' ? imageIdentification.set : textParseResult.set,
          cardNumber: imageIdentification.fullCardNumber !== 'unknown' ? imageIdentification.fullCardNumber : textParseResult.cardNumber,
          variant: imageIdentification.variant !== 'unknown' ? imageIdentification.variant : textParseResult.variant,
          rarity: imageIdentification.rarity !== 'unknown' ? imageIdentification.rarity : textParseResult.rarity,
          isHolo: imageIdentification.isHolo !== 'unknown' ? imageIdentification.isHolo : textParseResult.isHolo,
          year: imageIdentification.year !== 'unknown' ? imageIdentification.year : textParseResult.year,
          confidence: Math.max(textParseResult.confidence, imageIdentification.confidence),
          reasoning: `Image: ${imageIdentification.reasoning}; Text: ${textParseResult.reasoning}`,
        };

        logger.info({
          listingId,
          textSet: textParseResult.set,
          imageSet: imageIdentification.set,
          finalSet: finalResult.set,
          confidence: finalResult.confidence
        }, 'Merged text and image identification results');

      } catch (error) {
        logger.warn({ error, listingId }, 'Image identification failed, using text-only results');
      }
    }

    await prisma.evaluation.upsert({
      where: { listingId },
      create: {
        listingId,
        cardName: finalResult.cardName === 'unknown' ? null : finalResult.cardName,
        cardSet: finalResult.set === 'unknown' ? null : finalResult.set,
        cardNumber: finalResult.cardNumber === 'unknown' ? null : finalResult.cardNumber,
        year: finalResult.year === 'unknown' ? null : finalResult.year,
        language: finalResult.language === 'unknown' ? null : finalResult.language,
        isHolo: typeof finalResult.isHolo === 'boolean' ? (finalResult.isHolo ? 1 : 0) : null,
        isFirstEdition: typeof finalResult.isFirstEdition === 'boolean' ? (finalResult.isFirstEdition ? 1 : 0) : null,
        isShadowless: typeof finalResult.isShadowless === 'boolean' ? (finalResult.isShadowless ? 1 : 0) : null,
        rarity: finalResult.rarity === 'unknown' ? null : finalResult.rarity,
        parseConfidence: finalResult.confidence,
        parseMetadata: JSON.stringify(finalResult),
      },
      update: {
        cardName: finalResult.cardName === 'unknown' ? null : finalResult.cardName,
        cardSet: finalResult.set === 'unknown' ? null : finalResult.set,
        cardNumber: finalResult.cardNumber === 'unknown' ? null : finalResult.cardNumber,
        year: finalResult.year === 'unknown' ? null : finalResult.year,
        language: finalResult.language === 'unknown' ? null : finalResult.language,
        isHolo: typeof finalResult.isHolo === 'boolean' ? (finalResult.isHolo ? 1 : 0) : null,
        isFirstEdition: typeof finalResult.isFirstEdition === 'boolean' ? (finalResult.isFirstEdition ? 1 : 0) : null,
        isShadowless: typeof finalResult.isShadowless === 'boolean' ? (finalResult.isShadowless ? 1 : 0) : null,
        rarity: finalResult.rarity === 'unknown' ? null : finalResult.rarity,
        parseConfidence: finalResult.confidence,
        parseMetadata: JSON.stringify(finalResult),
      },
    });

    logger.info({ listingId, cardName: parseResult.cardName }, 'Card parsed successfully');
    
    // DISABLED: Auto-grading - Users will manually grade cards they're interested in
    // This prevents confusion where all listings get graded automatically
    // await gradeQueue.add('grade-card', { listingId });
    
    // Still queue pricing lookup (doesn't require OpenAI calls)
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
      // Still queue scoring with what we have
      await scoreQueue.add('score-deal', { listingId });
      return;
    }

    const images = JSON.parse(listing.images) as string[];
    if (images.length === 0) {
      logger.warn({ listingId }, 'No images to grade');
      await prisma.evaluation.update({
        where: { listingId },
        data: { 
          gradingDetails: JSON.stringify({ error: 'No images available' }),
          // Set default grades so scoring can still proceed
          predictedGradeMin: 5,
          predictedGradeMax: 7,
          gradeConfidence: 0.3,
        },
      });
      // Queue scoring even without images
      await scoreQueue.add('score-deal', { listingId });
      return;
    }

    // Pass card information to help with grading context
    const gradeResult = await llmService.gradeCard(
      images,
      listing.evaluation.cardName || 'unknown',
      listing.evaluation.cardSet || 'unknown',
      listing.evaluation.year || 'unknown'
    );

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
      },
    });

    logger.info({ listingId, gradeMin: gradeResult.predictedGradeMin, gradeMax: gradeResult.predictedGradeMax }, 'Card graded successfully');
    
    // Queue scoring job
    await scoreQueue.add('score-deal', { listingId });
  } catch (error) {
    logger.error({ error, listingId }, 'Card grading failed');
    // Set fallback grades and still proceed to scoring
    try {
      await prisma.evaluation.update({
        where: { listingId },
        data: {
          predictedGradeMin: 5,
          predictedGradeMax: 7,
          gradeConfidence: 0.2,
          gradingDetails: JSON.stringify({ error: 'Grading failed', message: error instanceof Error ? error.message : 'Unknown error' }),
        },
      });
      await scoreQueue.add('score-deal', { listingId });
    } catch (updateError) {
      logger.error({ error: updateError, listingId }, 'Failed to set fallback grades');
    }
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

    if (!evaluation) {
      logger.warn({ listingId }, 'Evaluation not found for pricing');
      // Queue scoring anyway - it can work with just grading data
      await scoreQueue.add('score-deal', { listingId });
      return;
    }

    if (!evaluation.cardName || !evaluation.cardSet) {
      logger.warn({ listingId, cardName: evaluation.cardName, cardSet: evaluation.cardSet }, 'Card info incomplete, skipping pricing but proceeding to scoring');
      // Queue scoring even without pricing - better to have partial data than nothing
      await scoreQueue.add('score-deal', { listingId });
      return;
    }

    const priceData = await justTCGService.getCardPrices(
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

      logger.info({ listingId, ungraded: priceData.ungraded }, 'Pricing data retrieved');
    } else {
      logger.warn({ listingId }, 'No pricing data found, proceeding to scoring anyway');
    }
    
    // Always queue scoring job (in case grading already completed)
    await scoreQueue.add('score-deal', { listingId });
    
  } catch (error) {
    logger.error({ error, listingId }, 'Price lookup failed');
    // Still queue scoring - partial data is better than nothing
    try {
      await scoreQueue.add('score-deal', { listingId });
    } catch (queueError) {
      logger.error({ error: queueError, listingId }, 'Failed to queue scoring after price lookup failure');
    }
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
        expectedValue: scoreResult.expectedValue || 0,
        expectedValueMin: scoreResult.expectedValueMin || 0,
        expectedValueMax: scoreResult.expectedValueMax || 0,
        dealMargin: scoreResult.dealMargin || 0,
        dealScore: scoreResult.dealScore || 0,
        isQualified: scoreResult.isQualified ? 1 : 0,
        qualificationFlags: JSON.stringify(scoreResult.qualificationFlags || []),
        softScores: JSON.stringify(scoreResult.softScores || {}),
      },
    });

    logger.info({ listingId, dealScore: scoreResult.dealScore, isQualified: scoreResult.isQualified }, 'Deal scored successfully');

    // Update search progress
    const search = await prisma.search.findUnique({
      where: { id: listing.searchId },
    });

    if (search) {
      const processedCount = await prisma.evaluation.count({
        where: {
          listing: { searchId: listing.searchId },
          dealScore: { 
            not: 0,
          },
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
