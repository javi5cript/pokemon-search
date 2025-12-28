import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/db';
import logger from '../lib/logger';
import { searchQueue } from '../queues';

export const searchRouter = Router();

// Validation schema for search criteria
const searchCriteriaSchema = z.object({
  keywords: z.string().min(1),
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
    const criteria = searchCriteriaSchema.parse(req.body);
    
    // Create search record
    const search = await prisma.search.create({
      data: {
        criteria: criteria as any,
        status: 'PENDING',
      },
    });
    
    // Queue the search job
    await searchQueue.add('ebay-search', {
      searchId: search.id,
      criteria,
    });
    
    logger.info({ searchId: search.id }, 'Search created and queued');
    
    res.status(201).json({
      searchId: search.id,
      status: search.status,
      createdAt: search.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid search criteria',
        details: error.errors,
      });
      return;
    }
    
    logger.error({ error }, 'Failed to create search');
    res.status(500).json({ error: 'Failed to create search' });
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
            evaluation: {
              dealScore: 'desc',
            },
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
        images: listing.images,
        evaluation: listing.evaluation ? {
          cardName: listing.evaluation.cardName,
          cardSet: listing.evaluation.cardSet,
          cardNumber: listing.evaluation.cardNumber,
          predictedGradeMin: listing.evaluation.predictedGradeMin,
          predictedGradeMax: listing.evaluation.predictedGradeMax,
          gradeConfidence: listing.evaluation.gradeConfidence,
          expectedValue: listing.evaluation.expectedValue,
          dealMargin: listing.evaluation.dealMargin,
          dealScore: listing.evaluation.dealScore,
          isQualified: listing.evaluation.isQualified,
          qualificationFlags: listing.evaluation.qualificationFlags,
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
