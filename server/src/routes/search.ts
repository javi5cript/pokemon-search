import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/db';
import logger from '../lib/logger';
import { searchQueue } from '../queues';

export const searchRouter = Router();

// Validation schema for search criteria
const searchCriteriaSchema = z.object({
  keywords: z.array(z.string()).min(1, 'At least one keyword is required'),
  category: z.string().optional(),
  condition: z.array(z.string()).optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  listingType: z.enum(['auction', 'buyItNow', 'all']).default('all'),
  location: z.string().optional(),
  shippingOptions: z.array(z.string()).optional(),
  language: z.string().optional(),
  minSellerFeedback: z.number().optional(),
});

// POST /api/search - Create new search
searchRouter.post('/', async (req, res) => {
  try {
    logger.info({ body: req.body }, 'Received search request');
    
    const criteria = searchCriteriaSchema.parse(req.body);
    
    // Create search record
    const search = await prisma.search.create({
      data: {
        criteria: JSON.stringify(criteria),
        status: 'PENDING',
      },
    });
    
    logger.info({ searchId: search.id, criteria }, 'Search record created');
    
    // Queue the search job
    try {
      await searchQueue.add('ebay-search', {
        searchId: search.id,
        criteria,
      });
      logger.info({ searchId: search.id }, 'Search job queued successfully');
    } catch (queueError) {
      logger.error({ error: queueError, searchId: search.id }, 'Failed to queue search job');
      // Update search status to failed
      await prisma.search.update({
        where: { id: search.id },
        data: { 
          status: 'FAILED',
          error: 'Failed to queue search job. Worker may not be running.'
        },
      });
    }
    
    res.status(201).json({
      searchId: search.id,
      status: search.status,
      createdAt: search.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn({ error: error.errors }, 'Validation error');
      res.status(400).json({
        error: 'Invalid search criteria',
        details: error.errors,
      });
      return;
    }
    
    logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Failed to create search');
    res.status(500).json({ 
      error: 'Failed to create search',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/search/:searchId - Get search status and results
searchRouter.get('/:searchId', async (req, res) => {
  try {
    const { searchId } = req.params;
    
    const search = await prisma.search.findUnique({
      where: { id: searchId },
      include: {
        listings: {
          include: {
            evaluation: true,
          },
          orderBy: {
            createdAt: 'asc', // Stable ordering by creation time
          },
        },
      },
    });
    
    if (!search) {
      res.status(404).json({ error: 'Search not found' });
      return;
    }
    
    // Calculate qualified listings
    const qualifiedListings = search.listings.filter(
      (listing: any) => listing.evaluation?.isQualified
    );
    
    res.json({
      searchId: search.id,
      status: search.status,
      criteria: search.criteria,
      progress: {
        total: search.totalListings,
        processed: search.processedListings,
        qualified: qualifiedListings.length,
      },
      listings: search.listings.map((listing: any) => ({
        id: listing.id,
        ebayItemId: listing.ebayItemId,
        url: listing.url,
        title: listing.title,
        price: listing.price,
        shippingCost: listing.shippingCost,
        currency: listing.currency,
        seller: {
          username: listing.sellerUsername,
          feedbackScore: listing.sellerFeedbackScore,
          feedbackPercent: listing.sellerFeedbackPercent,
        },
        condition: listing.condition,
        endTime: listing.endTime,
        images: typeof listing.images === 'string' ? JSON.parse(listing.images) : listing.images,
        evaluation: listing.evaluation ? {
          // Card metadata
          cardName: listing.evaluation.cardName,
          cardSet: listing.evaluation.cardSet,
          cardNumber: listing.evaluation.cardNumber,
          year: listing.evaluation.year,
          language: listing.evaluation.language,
          isHolo: listing.evaluation.isHolo,
          isFirstEdition: listing.evaluation.isFirstEdition,
          isShadowless: listing.evaluation.isShadowless,
          rarity: listing.evaluation.rarity,
          parseConfidence: listing.evaluation.parseConfidence,
          
          // Grading
          predictedGradeMin: listing.evaluation.predictedGradeMin,
          predictedGradeMax: listing.evaluation.predictedGradeMax,
          gradeConfidence: listing.evaluation.gradeConfidence,
          gradeReasoning: listing.evaluation.gradeReasoning,
          gradingDetails: typeof listing.evaluation.gradingDetails === 'string'
            ? JSON.parse(listing.evaluation.gradingDetails)
            : listing.evaluation.gradingDetails,
          defectFlags: typeof listing.evaluation.defectFlags === 'string'
            ? JSON.parse(listing.evaluation.defectFlags)
            : (listing.evaluation.defectFlags || []),
          
          // Pricing data from JustTCG
          marketPriceUngraded: listing.evaluation.marketPriceUngraded,
          marketPricePsa7: listing.evaluation.marketPricePsa7,
          marketPricePsa8: listing.evaluation.marketPricePsa8,
          marketPricePsa9: listing.evaluation.marketPricePsa9,
          marketPricePsa10: listing.evaluation.marketPricePsa10,
          pricingConfidence: listing.evaluation.pricingConfidence,
          pricingSource: listing.evaluation.pricingSource,
          
          // Deal scoring
          expectedValue: listing.evaluation.expectedValue,
          expectedValueMin: listing.evaluation.expectedValueMin,
          expectedValueMax: listing.evaluation.expectedValueMax,
          dealMargin: listing.evaluation.dealMargin,
          dealScore: listing.evaluation.dealScore,
          isQualified: listing.evaluation.isQualified,
          qualificationFlags: typeof listing.evaluation.qualificationFlags === 'string' 
            ? JSON.parse(listing.evaluation.qualificationFlags) 
            : (listing.evaluation.qualificationFlags || []),
        } : null,
      })),
      createdAt: search.createdAt,
      updatedAt: search.updatedAt,
      completedAt: search.completedAt,
    });
  } catch (error) {
    logger.error({ error, searchId: req.params.searchId }, 'Failed to fetch search');
    res.status(500).json({ error: 'Failed to fetch search' });
  }
});

// POST /api/search/:searchId/listing/:listingId/grade - Trigger on-demand grading
searchRouter.post('/:searchId/listing/:listingId/grade', async (req, res) => {
  try {
    const { searchId, listingId } = req.params;
    
    const listing = await prisma.listing.findFirst({
      where: {
        id: listingId,
        searchId: searchId,
      },
      include: {
        evaluation: true,
      },
    });
    
    if (!listing) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }

    // Import services here to avoid circular dependencies
    const { llmService } = await import('../services/llm');
    const { justTCGService } = await import('../services/justtcg');
    const { ListingScorer } = await import('../services/scorer');

    try {
      // Parse images - handle both string and array formats
      let images: string[] = [];
      
      if (typeof listing.images === 'string') {
        try {
          images = JSON.parse(listing.images);
        } catch (parseError) {
          logger.warn({ listingId, images: listing.images }, 'Failed to parse images JSON');
          images = [];
        }
      } else if (Array.isArray(listing.images)) {
        images = listing.images;
      }
      
      logger.info({ listingId, imageCount: images.length, imagesType: typeof listing.images }, 'Parsed listing images');
      
      if (!images || images.length === 0) {
        res.status(400).json({ 
          error: 'No images available for grading',
          message: 'This listing has no images to analyze',
          listingId: listing.id 
        });
        return;
      }

      logger.info({ listingId, imageCount: images.length }, 'Starting on-demand grading');

      // Grade the card
      const gradeResult = await llmService.gradeCard(
        images,
        listing.evaluation?.cardName || 'unknown',
        listing.evaluation?.cardSet || 'unknown',
        listing.evaluation?.year || 'unknown'
      );

      // Fetch pricing data from JustTCG if we have card identification
      let pricingData: any = null;
      if (listing.evaluation?.cardName && listing.evaluation?.cardSet) {
        logger.info({ 
          listingId, 
          cardName: listing.evaluation.cardName, 
          cardSet: listing.evaluation.cardSet 
        }, 'Fetching pricing data from JustTCG');
        
        try {
          pricingData = await justTCGService.getPricing(
            listing.evaluation.cardName,
            listing.evaluation.cardSet,
            listing.evaluation.cardNumber || undefined
          );
          
          if (pricingData) {
            logger.info({ 
              listingId, 
              ungraded: pricingData.ungraded, 
              psa7: pricingData.psa7,
              psa8: pricingData.psa8,
              psa9: pricingData.psa9,
              psa10: pricingData.psa10
            }, 'Pricing data fetched successfully');
          }
        } catch (pricingError) {
          logger.warn({ error: pricingError, listingId }, 'Failed to fetch pricing data');
        }
      }

      // Update evaluation with grading results and pricing (use upsert to be safe)
      const updatedEvaluation = await prisma.evaluation.upsert({
        where: { listingId },
        update: {
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
          // Update pricing if available
          ...(pricingData && {
            marketPriceUngraded: pricingData.ungraded || null,
            marketPricePsa7: pricingData.psa7 || null,
            marketPricePsa8: pricingData.psa8 || null,
            marketPricePsa9: pricingData.psa9 || null,
            marketPricePsa10: pricingData.psa10 || null,
            pricingConfidence: pricingData.confidence || 0,
            pricingSource: pricingData.source || 'justtcg',
          }),
        },
        create: {
          listingId,
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
          // Include pricing in create as well
          ...(pricingData && {
            marketPriceUngraded: pricingData.ungraded || null,
            marketPricePsa7: pricingData.psa7 || null,
            marketPricePsa8: pricingData.psa8 || null,
            marketPricePsa9: pricingData.psa9 || null,
            marketPricePsa10: pricingData.psa10 || null,
            pricingConfidence: pricingData.confidence || 0,
            pricingSource: pricingData.source || 'justtcg',
          }),
        },
      });

      // Get updated listing with evaluation for scoring
      const listingForScoring = await prisma.listing.findUnique({
        where: { id: listingId },
        include: { evaluation: true },
      });

      if (listingForScoring && listingForScoring.evaluation) {
        // Score the deal
        const scorer = new ListingScorer();
        const scoreResult = scorer.scoreListing(listingForScoring, listingForScoring.evaluation);

        // Update with scores including expectedValueMin/Max
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
      }

      logger.info({ 
        listingId, 
        gradeRange: `${gradeResult.predictedGradeMin}-${gradeResult.predictedGradeMax}` 
      }, 'On-demand grading completed');

      res.json({
        success: true,
        listingId: listing.id,
        grading: {
          predictedGradeMin: gradeResult.predictedGradeMin,
          predictedGradeMax: gradeResult.predictedGradeMax,
          confidence: gradeResult.confidence,
          defectFlags: gradeResult.defectFlags,
          reasoning: gradeResult.gradingReasoning,
          details: {
            centering: gradeResult.centering,
            corners: gradeResult.corners,
            edges: gradeResult.edges,
            surface: gradeResult.surface,
            imageQuality: gradeResult.imageQuality,
          },
        },
      });
    } catch (error) {
      logger.error({ error, listingId }, 'On-demand grading failed');
      
      res.status(500).json({ 
        error: 'Grading failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        listingId: listing.id,
        details: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : null,
      });
    }
  } catch (error) {
    logger.error({ error, searchId: req.params.searchId, listingId: req.params.listingId }, 'Failed to process grading request');
    res.status(500).json({ 
      error: 'Failed to process grading request',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : null,
    });
  }
});

// GET /api/search/:searchId/listing/:listingId - Get detailed listing evaluation
searchRouter.get('/:searchId/listing/:listingId', async (req, res) => {
  try {
    const { searchId, listingId } = req.params;
    
    const listing = await prisma.listing.findFirst({
      where: {
        id: listingId,
        searchId: searchId,
      },
      include: {
        evaluation: true,
      },
    });
    
    if (!listing) {
      res.status(404).json({ error: 'Listing not found' });
      return;
    }
    
    res.json({
      listing: {
        id: listing.id,
        ebayItemId: listing.ebayItemId,
        url: listing.url,
        title: listing.title,
        description: listing.description,
        price: listing.price,
        shippingCost: listing.shippingCost,
        currency: listing.currency,
        seller: {
          username: listing.sellerUsername,
          feedbackScore: listing.sellerFeedbackScore,
          feedbackPercent: listing.sellerFeedbackPercent,
        },
        location: listing.location,
        condition: listing.condition,
        endTime: listing.endTime,
        listingType: listing.listingType,
        images: listing.images,
        itemSpecifics: listing.itemSpecifics,
      },
      evaluation: listing.evaluation ? {
        // Parsed fields
        cardName: listing.evaluation.cardName,
        cardSet: listing.evaluation.cardSet,
        cardNumber: listing.evaluation.cardNumber,
        year: listing.evaluation.year,
        language: listing.evaluation.language,
        isHolo: listing.evaluation.isHolo,
        isFirstEdition: listing.evaluation.isFirstEdition,
        isShadowless: listing.evaluation.isShadowless,
        rarity: listing.evaluation.rarity,
        parseConfidence: listing.evaluation.parseConfidence,
        parseMetadata: listing.evaluation.parseMetadata,
        
        // Grading
        predictedGradeMin: listing.evaluation.predictedGradeMin,
        predictedGradeMax: listing.evaluation.predictedGradeMax,
        gradeConfidence: listing.evaluation.gradeConfidence,
        defectFlags: listing.evaluation.defectFlags,
        gradeReasoning: listing.evaluation.gradeReasoning,
        gradingDetails: listing.evaluation.gradingDetails,
        
        // Pricing
        marketPriceUngraded: listing.evaluation.marketPriceUngraded,
        marketPricePsa7: listing.evaluation.marketPricePsa7,
        marketPricePsa8: listing.evaluation.marketPricePsa8,
        marketPricePsa9: listing.evaluation.marketPricePsa9,
        marketPricePsa10: listing.evaluation.marketPricePsa10,
        pricingConfidence: listing.evaluation.pricingConfidence,
        pricingSource: listing.evaluation.pricingSource,
        
        // Scoring
        expectedValue: listing.evaluation.expectedValue,
        dealMargin: listing.evaluation.dealMargin,
        dealScore: listing.evaluation.dealScore,
        qualificationFlags: listing.evaluation.qualificationFlags,
        isQualified: listing.evaluation.isQualified,
        softScores: listing.evaluation.softScores,
        
        createdAt: listing.evaluation.createdAt,
        updatedAt: listing.evaluation.updatedAt,
      } : null,
    });
  } catch (error) {
    logger.error({ error, searchId: req.params.searchId, listingId: req.params.listingId }, 'Failed to fetch listing details');
    res.status(500).json({ error: 'Failed to fetch listing details' });
  }
});
