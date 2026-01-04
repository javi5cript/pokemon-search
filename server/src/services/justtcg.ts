/**
 * JustTCG API Integration
 * 
 * Handles:
 * - Card price lookups for Pokémon cards
 * - TCGPlayer ID resolution
 * - Aggressive caching
 * - Graded and ungraded pricing data
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import logger from '../lib/logger';
import redis from '../lib/redis';

export interface JustTCGVariant {
  id: string;
  condition: string;
  printing: string;
  language: string;
  price: number;
  lastUpdated: number;
  priceChange7d?: number | null;
  avgPrice?: number | null;
  minPrice7d?: number | null;
  maxPrice7d?: number | null;
}

export interface JustTCGCard {
  id: string;
  name: string;
  game: string;
  set: string;
  set_name: string;
  number: string;
  tcgplayerId: string;
  rarity: string;
  details: string | null;
  variants: JustTCGVariant[];
}

export interface PriceData {
  cardId: string;
  cardName: string;
  setName: string;
  
  // Ungraded prices (Near Mint Normal printing)
  loosePrice: number | null;
  
  // Graded prices (PSA) - we'll map from conditions
  gradedPrices: {
    psa7?: number;
    psa8?: number;
    psa9?: number;
    psa10?: number;
  };
  
  // Market data
  marketPrice: number | null;
  
  // Metadata
  lastUpdated: Date;
  currency: string;
  
  // All variants for reference
  allVariants: JustTCGVariant[];
}

export interface PriceLookupResult {
  found: boolean;
  confidence: number;
  priceData: PriceData | null;
  reasoning: string;
}

export class JustTCGService {
  private client: AxiosInstance;
  private cachePrefix = 'justtcg:';
  private cacheTTL = 24 * 60 * 60; // 24 hours
  private requestCount = 0;
  private rateLimitWindow = Date.now();

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.justtcg.com/v1',
      timeout: 15000,
      headers: {
        'x-api-key': config.justTCG.apiKey,
      },
    });
  }

  /**
   * Generate cache key for a card lookup
   */
  private getCacheKey(cardName: string, set: string, cardNumber: string, language: string): string {
    const normalized = `${cardName}_${set}_${cardNumber}_${language}`.toLowerCase().replace(/\s+/g, '_');
    return `${this.cachePrefix}${normalized}`;
  }

  /**
   * Rate limiting helper - DISABLED
   * Let the API handle its own rate limits instead of imposing artificial client-side limits
   */
  private async checkRateLimit(): Promise<void> {
    // No artificial rate limiting - let the API return its own limits
    return;
  }

  /**
   * Get card prices (simplified interface for processors)
   */
  async getCardPrices(
    cardName: string | null,
    set: string | null,
    cardNumber: string | null
  ): Promise<{
    ungraded: number | null;
    psa7: number | null;
    psa8: number | null;
    psa9: number | null;
    psa10: number | null;
    confidence: number;
    source: string;
  } | null> {
    if (!cardName || !set) {
      return null;
    }

    const result = await this.lookupPrice(cardName, set, cardNumber || '', 'English');
    
    if (!result.found || !result.priceData) {
      return null;
    }

    return {
      ungraded: result.priceData.loosePrice,
      psa7: result.priceData.gradedPrices.psa7 || null,
      psa8: result.priceData.gradedPrices.psa8 || null,
      psa9: result.priceData.gradedPrices.psa9 || null,
      psa10: result.priceData.gradedPrices.psa10 || null,
      confidence: result.confidence,
      source: 'justtcg',
    };
  }

  /**
   * Look up pricing for a card
   */
  async lookupPrice(
    cardName: string,
    set: string,
    cardNumber: string,
    language: string = 'English',
    variant?: string
  ): Promise<PriceLookupResult> {
    // Check cache first
    const cacheKey = this.getCacheKey(cardName, set, cardNumber, language);
    
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug({ cacheKey }, 'Price cache hit');
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.warn({ error }, 'Redis cache read failed');
    }

    // Build search query
    const searchQuery = this.buildSearchQuery(cardName, set, cardNumber, variant);
    
    logger.info({ searchQuery, cardName, set, cardNumber }, 'Looking up price on JustTCG');

    try {
      const result = await this.searchCard(searchQuery, cardName, set, cardNumber);
      
      // Cache the result
      try {
        await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result));
      } catch (error) {
        logger.warn({ error }, 'Redis cache write failed');
      }

      return result;

    } catch (error: any) {
      logger.error({ error, searchQuery }, 'JustTCG lookup failed');
      
      return {
        found: false,
        confidence: 0,
        priceData: null,
        reasoning: `API error: ${error.message}`,
      };
    }
  }

  /**
   * Build search query string
   * Standardizes format to "Pokemon Name CardNumber" (e.g., "Dachsbun EX 160")
   * Set is NOT included as it can cause false negatives in JustTCG search
   */
  private buildSearchQuery(
    cardName: string,
    set: string,
    cardNumber: string,
    variant?: string
  ): string {
    const parts: string[] = [];
    
    // Standardized format: ONLY Pokemon Name + Card Number
    // This matches JustTCG's expected format for better search results
    if (cardName && cardName !== 'unknown') {
      parts.push(cardName);
    }
    
    // Add card number directly after name (critical for matching)
    if (cardNumber && cardNumber !== 'unknown') {
      // Remove any slashes or extra formatting from card number
      const cleanNumber = cardNumber.split('/')[0].trim();
      parts.push(cleanNumber);
    }
    
    // NOTE: Set is intentionally NOT included - it can cause false negatives
    // JustTCG searches work better with just name + number
    
    // Variant (Holo, 1st Edition, etc.) - only if specified
    if (variant && variant !== 'unknown') {
      parts.push(variant);
    }

    const query = parts.join(' ');
    logger.info({ 
      cardName, 
      cardNumber, 
      excludedSet: set,
      query 
    }, 'Built JustTCG search query (set excluded for better results)');
    
    return query;
  }

  /**
   * Search for card on JustTCG
   */
  private async searchCard(
    query: string,
    cardName: string,
    set: string,
    cardNumber: string
  ): Promise<PriceLookupResult> {
    try {
      await this.checkRateLimit();

      // Search endpoint - using the cards endpoint with search query
      const response = await this.client.get('/cards', {
        params: {
          game: 'pokemon',
          q: query,
          limit: 10,
        },
      });

      const cards = response.data.data || [];

      if (cards.length === 0) {
        logger.info({ query }, 'No cards found in JustTCG search');
        return {
          found: false,
          confidence: 0,
          priceData: null,
          reasoning: 'No matching cards found',
        };
      }

      // Find best match
      const bestMatch = this.findBestMatch(cards, cardName, set, cardNumber);

      if (!bestMatch.card) {
        return {
          found: false,
          confidence: 0,
          priceData: null,
          reasoning: 'No confident match found',
        };
      }

      // Extract pricing data from variants
      const priceData = this.extractPriceData(bestMatch.card);

      return {
        found: true,
        confidence: bestMatch.confidence,
        priceData,
        reasoning: `Matched to ${bestMatch.card.name} from ${bestMatch.card.set_name}`,
      };

    } catch (error: any) {
      // Handle rate limiting
      if (error.response?.status === 429) {
        logger.warn({ 
          status: error.response?.status,
          data: error.response?.data,
          headers: error.response?.headers
        }, 'JustTCG rate limit hit - Full response');
        await this.delay(2000);
        throw new Error('Rate limit exceeded');
      }

      // Log full error details for debugging
      logger.error({
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers,
        url: error.config?.url,
        method: error.config?.method,
      }, 'JustTCG API error - Full details');

      throw error;
    }
  }

  /**
   * Find best matching card from search results
   */
  private findBestMatch(
    cards: JustTCGCard[],
    targetCardName: string,
    targetSet: string,
    targetCardNumber: string
  ): { card: JustTCGCard | null; confidence: number } {
    let bestCard = null;
    let bestScore = 0;

    for (const card of cards) {
      const score = this.calculateMatchScore(card, targetCardName, targetSet, targetCardNumber);

      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
      }
    }

    // Require minimum confidence of 0.5
    if (bestScore < 0.5) {
      return { card: null, confidence: 0 };
    }

    return { card: bestCard, confidence: bestScore };
  }

  /**
   * Calculate match score between card and target
   */
  private calculateMatchScore(
    card: JustTCGCard,
    targetCardName: string,
    targetSet: string,
    targetCardNumber: string
  ): number {
    let score = 0;

    const cardNameLower = card.name.toLowerCase();
    const setNameLower = card.set_name.toLowerCase();
    const cardNumberStr = card.number.toLowerCase();

    const targetNameLower = targetCardName.toLowerCase();
    const targetSetLower = targetSet.toLowerCase();
    const targetNumberLower = targetCardNumber.toLowerCase();

    // Card name match (weight: 0.5)
    if (targetNameLower !== 'unknown') {
      if (cardNameLower === targetNameLower) {
        score += 0.5;
      } else if (cardNameLower.includes(targetNameLower) || targetNameLower.includes(cardNameLower)) {
        score += 0.3;
      }
    }

    // Set match (weight: 0.3)
    if (targetSetLower !== 'unknown') {
      if (setNameLower.includes(targetSetLower) || targetSetLower.includes(setNameLower)) {
        score += 0.3;
      }
    }

    // Card number match (weight: 0.2)
    if (targetNumberLower !== 'unknown' && targetNumberLower) {
      // Normalize card numbers (remove leading zeros, slashes, etc.)
      const normalizedTarget = targetNumberLower.replace(/^0+/, '').split('/')[0];
      const normalizedCard = cardNumberStr.replace(/^0+/, '').split('/')[0];
      
      if (normalizedCard === normalizedTarget) {
        score += 0.2;
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * Extract pricing data from card variants
   */
  private extractPriceData(card: JustTCGCard): PriceData {
    const variants = card.variants || [];

    // Get all Near Mint variants (any printing)
    const nmVariants = variants.filter(v => v.condition === 'Near Mint');
    
    // Get the best Near Mint variant (prefer standard prints like Unlimited, Holofoil)
    // Avoid 1st Edition as it's typically much more expensive
    const nmStandard = nmVariants.find(v => 
      v.printing === 'Unlimited' || 
      v.printing === 'Holofoil' ||
      v.printing === 'Normal' ||
      v.printing === 'Reverse Holofoil'
    ) || nmVariants[0]; // Fallback to first Near Mint if no standard found

    // Get Lightly Played variants
    const lpVariants = variants.filter(v => v.condition === 'Lightly Played');
    const lpStandard = lpVariants.find(v => 
      v.printing === 'Unlimited' || 
      v.printing === 'Holofoil' ||
      v.printing === 'Normal' ||
      v.printing === 'Reverse Holofoil'
    ) || lpVariants[0];

    // Map JustTCG conditions to approximate PSA grades
    // This is a reasonable approximation based on condition standards:
    // - Near Mint (no visible flaws) ≈ PSA 8-9
    // - Lightly Played (minor flaws) ≈ PSA 7
    // - PSA 10 is estimated at a premium over Near Mint
    const gradedPrices: {
      psa7?: number;
      psa8?: number;
      psa9?: number;
      psa10?: number;
    } = {};

    // PSA 9 - Near Mint is closest to PSA 9
    if (nmStandard) {
      gradedPrices.psa9 = nmStandard.price;
    }

    // PSA 10 - Premium over Near Mint (typically 30-50% more)
    if (nmStandard) {
      gradedPrices.psa10 = nmStandard.price * 1.4;
    }

    // PSA 8 - Between Near Mint and Lightly Played, or 80% of Near Mint
    if (lpStandard && nmStandard) {
      // Average of Near Mint and Lightly Played
      gradedPrices.psa8 = (nmStandard.price + lpStandard.price) / 2;
    } else if (nmStandard) {
      gradedPrices.psa8 = nmStandard.price * 0.8;
    }

    // PSA 7 - Lightly Played is closest to PSA 7
    if (lpStandard) {
      gradedPrices.psa7 = lpStandard.price;
    } else if (nmStandard) {
      gradedPrices.psa7 = nmStandard.price * 0.65;
    }

    // Ungraded/loose price is Near Mint standard
    const loosePrice = nmStandard?.price || null;
    const marketPrice = nmStandard?.price || null;

    return {
      cardId: card.id,
      cardName: card.name,
      setName: card.set_name,
      loosePrice,
      gradedPrices,
      marketPrice,
      lastUpdated: new Date(),
      currency: 'USD',
      allVariants: variants,
    };
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Bulk lookup with batching
   */
  async lookupPriceBulk(
    cards: Array<{
      cardName: string;
      set: string;
      cardNumber: string;
      language?: string;
      variant?: string;
    }>
  ): Promise<PriceLookupResult[]> {
    const results: PriceLookupResult[] = [];
    
    // JustTCG supports batch requests via POST
    // We can use the batch endpoint for better performance
    const batchSize = 20; // Free plan limit
    
    for (let i = 0; i < cards.length; i += batchSize) {
      const batch = cards.slice(i, i + batchSize);
      
      try {
        await this.checkRateLimit();

        // Build batch request
        const batchRequest = batch.map(card => ({
          game: 'pokemon',
          q: this.buildSearchQuery(card.cardName, card.set, card.cardNumber, card.variant),
        }));

        // For now, process sequentially
        // TODO: Implement actual batch API call if needed
        const batchPromises = batch.map(card =>
          this.lookupPrice(
            card.cardName,
            card.set,
            card.cardNumber,
            card.language || 'English',
            card.variant
          )
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
      } catch (error) {
        logger.error({ error, batchIndex: i }, 'Batch lookup failed');
        // Add failed results
        batch.forEach(() => {
          results.push({
            found: false,
            confidence: 0,
            priceData: null,
            reasoning: 'Batch request failed',
          });
        });
      }
    }
    
    return results;
  }

  /**
   * Clear cache for a specific card
   */
  async clearCache(cardName: string, set: string, cardNumber: string, language: string): Promise<void> {
    const cacheKey = this.getCacheKey(cardName, set, cardNumber, language);
    try {
      await redis.del(cacheKey);
      logger.info({ cacheKey }, 'Cleared price cache');
    } catch (error) {
      logger.warn({ error }, 'Failed to clear cache');
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ keys: number; memoryUsage: string }> {
    try {
      const keys = await redis.keys(`${this.cachePrefix}*`);
      const info = await redis.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1] : 'unknown';

      return {
        keys: keys.length,
        memoryUsage,
      };
    } catch (error) {
      logger.warn({ error }, 'Failed to get cache stats');
      return { keys: 0, memoryUsage: 'unknown' };
    }
  }
}

// Singleton instance
export const justTCGService = new JustTCGService();
