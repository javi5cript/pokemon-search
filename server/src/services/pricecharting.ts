/**
 * PriceCharting API Integration
 * 
 * Handles:
 * - Card price lookups
 * - Product ID resolution
 * - Aggressive caching
 * - Fuzzy matching
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import logger from '../lib/logger';
import redis from '../lib/redis';

export interface PriceData {
  productId: string;
  productName: string;
  consoleName: string;
  
  // Ungraded prices
  loosePrice: number | null;
  cibPrice: number | null;
  newPrice: number | null;
  
  // Graded prices (PSA)
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
}

export interface PriceLookupResult {
  found: boolean;
  confidence: number;
  priceData: PriceData | null;
  reasoning: string;
}

export class PriceChartingService {
  private client: AxiosInstance;
  private cachePrefix = 'pc:';
  private cacheTTL = 24 * 60 * 60; // 24 hours

  constructor() {
    this.client = axios.create({
      baseURL: 'https://www.pricecharting.com/api',
      timeout: 15000,
      headers: {
        'Authorization': `Bearer ${config.priceCharting.apiKey}`,
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
    
    logger.info({ searchQuery }, 'Looking up price on PriceCharting');

    try {
      const result = await this.searchProduct(searchQuery, cardName, set);
      
      // Cache the result
      try {
        await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result));
      } catch (error) {
        logger.warn({ error }, 'Redis cache write failed');
      }

      return result;

    } catch (error: any) {
      logger.error({ error, searchQuery }, 'PriceCharting lookup failed');
      
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
   */
  private buildSearchQuery(
    cardName: string,
    set: string,
    cardNumber: string,
    variant?: string
  ): string {
    const parts: string[] = [];
    
    // Pokemon card prefix
    parts.push('Pokemon');
    
    // Card name
    if (cardName && cardName !== 'unknown') {
      parts.push(cardName);
    }
    
    // Set name
    if (set && set !== 'unknown') {
      // Normalize set names for PriceCharting
      const normalizedSet = this.normalizeSetName(set);
      parts.push(normalizedSet);
    }
    
    // Card number
    if (cardNumber && cardNumber !== 'unknown') {
      parts.push(`#${cardNumber}`);
    }
    
    // Variant (Holo, 1st Edition, etc.)
    if (variant && variant !== 'unknown') {
      parts.push(variant);
    }

    return parts.join(' ');
  }

  /**
   * Normalize set names to match PriceCharting's naming
   */
  private normalizeSetName(set: string): string {
    const setMap: Record<string, string> = {
      'Base Set': 'Base Set',
      'Base': 'Base Set',
      'Jungle': 'Jungle',
      'Fossil': 'Fossil',
      'Base Set 2': 'Base Set 2',
      'Team Rocket': 'Team Rocket',
      'Gym Heroes': 'Gym Heroes',
      'Gym Challenge': 'Gym Challenge',
      'Neo Genesis': 'Neo Genesis',
      'Neo Discovery': 'Neo Discovery',
      'Neo Revelation': 'Neo Revelation',
      'Neo Destiny': 'Neo Destiny',
      'Legendary Collection': 'Legendary Collection',
    };

    return setMap[set] || set;
  }

  /**
   * Search for product on PriceCharting
   */
  private async searchProduct(
    query: string,
    cardName: string,
    set: string
  ): Promise<PriceLookupResult> {
    try {
      // Search endpoint
      const searchResponse = await this.client.get('/products', {
        params: {
          q: query,
          t: 'pokemon-cards', // Type filter
          limit: 5,
        },
      });

      const products = searchResponse.data.products || [];

      if (products.length === 0) {
        return {
          found: false,
          confidence: 0,
          priceData: null,
          reasoning: 'No matching products found',
        };
      }

      // Find best match
      const bestMatch = this.findBestMatch(products, cardName, set);

      if (!bestMatch.product) {
        return {
          found: false,
          confidence: 0,
          priceData: null,
          reasoning: 'No confident match found',
        };
      }

      // Fetch detailed pricing
      const priceData = await this.fetchProductPricing(bestMatch.product.id);

      return {
        found: true,
        confidence: bestMatch.confidence,
        priceData,
        reasoning: `Matched to ${bestMatch.product['product-name']}`,
      };

    } catch (error: any) {
      // Handle rate limiting
      if (error.response?.status === 429) {
        logger.warn('PriceCharting rate limit hit');
        await this.delay(2000);
        throw new Error('Rate limit exceeded');
      }

      throw error;
    }
  }

  /**
   * Find best matching product from search results
   */
  private findBestMatch(
    products: any[],
    targetCardName: string,
    targetSet: string
  ): { product: any | null; confidence: number } {
    let bestProduct = null;
    let bestScore = 0;

    for (const product of products) {
      const productName = product['product-name'].toLowerCase();
      const score = this.calculateMatchScore(productName, targetCardName, targetSet);

      if (score > bestScore) {
        bestScore = score;
        bestProduct = product;
      }
    }

    // Require minimum confidence of 0.5
    if (bestScore < 0.5) {
      return { product: null, confidence: 0 };
    }

    return { product: bestProduct, confidence: bestScore };
  }

  /**
   * Calculate match score between product and target card
   */
  private calculateMatchScore(
    productName: string,
    targetCardName: string,
    targetSet: string
  ): number {
    let score = 0;

    const productLower = productName.toLowerCase();
    const cardNameLower = targetCardName.toLowerCase();
    const setLower = targetSet.toLowerCase();

    // Card name match (weight: 0.5)
    if (cardNameLower !== 'unknown' && productLower.includes(cardNameLower)) {
      score += 0.5;
    }

    // Set match (weight: 0.3)
    if (setLower !== 'unknown' && productLower.includes(setLower)) {
      score += 0.3;
    }

    // Pokemon keyword (weight: 0.2)
    if (productLower.includes('pokemon')) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Fetch detailed pricing for a product
   */
  private async fetchProductPricing(productId: string): Promise<PriceData> {
    const response = await this.client.get(`/product/${productId}`);
    const data = response.data;

    // Parse prices
    const loosePrice = this.parsePrice(data['loose-price']);
    const cibPrice = this.parsePrice(data['cib-price']);
    const newPrice = this.parsePrice(data['new-price']);

    // Graded prices (if available)
    const gradedPrices: any = {};
    if (data['graded-price-7']) gradedPrices.psa7 = this.parsePrice(data['graded-price-7']);
    if (data['graded-price-8']) gradedPrices.psa8 = this.parsePrice(data['graded-price-8']);
    if (data['graded-price-9']) gradedPrices.psa9 = this.parsePrice(data['graded-price-9']);
    if (data['graded-price-10']) gradedPrices.psa10 = this.parsePrice(data['graded-price-10']);

    // Market price is typically the CIB or new price for cards
    const marketPrice = cibPrice || newPrice || loosePrice;

    return {
      productId: data.id,
      productName: data['product-name'],
      consoleName: data['console-name'],
      loosePrice,
      cibPrice,
      newPrice,
      gradedPrices,
      marketPrice,
      lastUpdated: new Date(),
      currency: 'USD',
    };
  }

  /**
   * Parse price string to number
   */
  private parsePrice(priceStr: string | undefined): number | null {
    if (!priceStr) return null;
    
    const cleaned = priceStr.replace(/[$,]/g, '');
    const parsed = parseFloat(cleaned);
    
    return isNaN(parsed) ? null : parsed;
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
    
    // Process in batches to avoid overwhelming API
    const batchSize = 5;
    
    for (let i = 0; i < cards.length; i += batchSize) {
      const batch = cards.slice(i, i + batchSize);
      
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
      
      // Rate limiting: wait between batches
      if (i + batchSize < cards.length) {
        await this.delay(1000);
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
export const priceChartingService = new PriceChartingService();
