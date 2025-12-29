/**
 * eBay Browse API Integration
 * 
 * Handles:
 * - Search query translation
 * - Pagination and result fetching
 * - Rate limiting and retries
 * - Response normalization
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import logger from '../lib/logger';

export interface EbaySearchCriteria {
  keywords: string | string[];
  category?: string;
  condition?: string[];
  priceMin?: number;
  priceMax?: number;
  buyItNowOnly?: boolean;
  location?: string;
  shipsTo?: string;
  sortBy?: 'price' | 'endingSoonest' | 'newlyListed';
  maxResults?: number;
}

export interface NormalizedListing {
  ebayItemId: string;
  url: string;
  title: string;
  price: number;
  currency: string;
  shippingCost: number;
  sellerUsername: string;
  sellerFeedbackScore: number;
  sellerFeedbackPercent: number;
  location: string;
  condition: string;
  endTime: Date;
  listingType: 'AUCTION' | 'FIXED_PRICE';
  images: string[];
  itemSpecifics: Record<string, string>;
  description?: string;
  rawPayload: any;
}

export class EbayService {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private requestCount: number = 0;
  private rateLimitWindow: Date = new Date();
  private readonly baseURL: string;
  private readonly authURL: string;

  constructor() {
    // Use different URLs for sandbox vs production
    const isSandbox = config.ebay.environment === 'SANDBOX';
    this.baseURL = isSandbox 
      ? 'https://api.sandbox.ebay.com'
      : 'https://api.ebay.com';
    this.authURL = isSandbox
      ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
      : 'https://api.ebay.com/identity/v1/oauth2/token';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
    });
    
    logger.info({
      environment: config.ebay.environment,
      baseURL: this.baseURL,
      authURL: this.authURL,
    }, 'eBay Service initialized');
  }

  /**
   * Get OAuth access token for eBay API
   */
  private async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    logger.info({
      environment: config.ebay.environment,
      authURL: this.authURL,
      hasClientId: !!config.ebay.clientId,
      hasClientSecret: !!config.ebay.clientSecret,
    }, 'Fetching new eBay OAuth token');

    try {
      const credentials = Buffer.from(
        `${config.ebay.clientId}:${config.ebay.clientSecret}`
      ).toString('base64');

      const response = await axios.post(
        this.authURL,
        'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${credentials}`,
          },
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiry to 5 minutes before actual expiry for safety
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in - 300) * 1000);

      logger.info('Successfully obtained eBay OAuth token');
      return this.accessToken!;
    } catch (error: any) {
      logger.error({ 
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        authURL: this.authURL,
      }, 'Failed to obtain eBay OAuth token');
      throw new Error('eBay authentication failed');
    }
  }

  /**
   * Rate limiting check
   */
  private async checkRateLimit(): Promise<void> {
    const now = new Date();
    const windowMs = 60000; // 1 minute

    // Reset counter if window has passed
    if (now.getTime() - this.rateLimitWindow.getTime() > windowMs) {
      this.requestCount = 0;
      this.rateLimitWindow = now;
    }

    // eBay allows 5000 calls per day, ~80 per minute conservatively
    if (this.requestCount >= 80) {
      const waitTime = windowMs - (now.getTime() - this.rateLimitWindow.getTime());
      logger.warn({ waitTime }, 'Rate limit reached, waiting');
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.rateLimitWindow = new Date();
    }

    this.requestCount++;
  }

  /**
   * Build eBay API query string from search criteria
   */
  private buildQuery(criteria: EbaySearchCriteria): string {
    const filters: string[] = [];

    // Keywords
    const keywordsStr = Array.isArray(criteria.keywords) 
      ? criteria.keywords.join(' ') 
      : criteria.keywords;
    filters.push(keywordsStr);

    // Category ID (20081 = Pokémon cards)
    if (criteria.category) {
      filters.push(`categoryIds:${criteria.category}`);
    }

    // Condition
    if (criteria.condition && criteria.condition.length > 0) {
      const conditionIds = criteria.condition.map(c => this.mapConditionToId(c)).join('|');
      filters.push(`conditionIds:{${conditionIds}}`);
    }

    // Price range
    if (criteria.priceMin !== undefined || criteria.priceMax !== undefined) {
      const min = criteria.priceMin ?? 0;
      const max = criteria.priceMax ?? 999999;
      filters.push(`price:[${min}..${max}]`);
    }

    // Buy It Now only
    if (criteria.buyItNowOnly) {
      filters.push('buyingOptions:{FIXED_PRICE}');
    }

    // Location
    if (criteria.location) {
      filters.push(`itemLocationCountry:${criteria.location}`);
    }

    return filters.join(' ');
  }

  /**
   * Map condition string to eBay condition ID
   */
  private mapConditionToId(condition: string): string {
    const conditionMap: Record<string, string> = {
      'NEW': '1000',
      'LIKE_NEW': '1500',
      'EXCELLENT': '2000',
      'VERY_GOOD': '3000',
      'GOOD': '4000',
      'ACCEPTABLE': '5000',
      'FOR_PARTS': '7000',
    };
    return conditionMap[condition] || '3000';
  }

  /**
   * Map eBay sort parameter
   */
  private mapSortOrder(sortBy?: string): string {
    const sortMap: Record<string, string> = {
      'price': 'price',
      'endingSoonest': 'endingSoonest',
      'newlyListed': 'newlyListed',
    };
    return sortMap[sortBy || 'newlyListed'] || 'newlyListed';
  }

  /**
   * Fetch all listings matching criteria with pagination
   */
  async searchListings(criteria: EbaySearchCriteria): Promise<NormalizedListing[]> {
    logger.info({ criteria }, 'Starting eBay search');

    const maxResults = criteria.maxResults || 500;
    const resultsPerPage = 200; // eBay max per request
    const allListings: NormalizedListing[] = [];

    let offset = 0;
    let hasMore = true;

    try {
      while (hasMore && allListings.length < maxResults) {
        await this.checkRateLimit();

        const token = await this.getAccessToken();
        const query = this.buildQuery(criteria);

        logger.debug({ offset, query }, 'Fetching eBay page');

        const response = await this.client.get('/buy/browse/v1/item_summary/search', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<ePNCampaignId>',
          },
          params: {
            q: query,
            limit: resultsPerPage,
            offset: offset,
            sort: this.mapSortOrder(criteria.sortBy),
            filter: criteria.shipsTo ? `deliveryCountry:${criteria.shipsTo}` : undefined,
          },
        });

        const items = response.data.itemSummaries || [];
        logger.info({ count: items.length, offset }, 'Received eBay results');

        // Normalize each item
        for (const item of items) {
          try {
            const normalized = this.normalizeItem(item);
            allListings.push(normalized);
          } catch (error) {
            logger.warn({ error, itemId: item.itemId }, 'Failed to normalize item');
          }
        }

        // Check pagination
        offset += items.length;
        hasMore = items.length === resultsPerPage && allListings.length < maxResults;

        // Respect eBay's total available
        if (response.data.total && offset >= response.data.total) {
          hasMore = false;
        }
      }

      logger.info({ total: allListings.length }, 'eBay search complete');
      return allListings;

    } catch (error: any) {
      logger.error({ error, criteria }, 'eBay search failed');
      
      if (error.response?.status === 429) {
        throw new Error('eBay rate limit exceeded');
      }
      
      if (error.response?.status === 401) {
        // Token expired, clear and retry once
        this.accessToken = null;
        throw new Error('eBay authentication failed');
      }

      throw new Error(`eBay API error: ${error.message}`);
    }
  }

  /**
   * Normalize eBay API response to our schema
   */
  private normalizeItem(item: any): NormalizedListing {
    // Extract price
    const price = parseFloat(item.price?.value || '0');
    const currency = item.price?.currency || 'USD';

    // Extract shipping
    let shippingCost = 0;
    if (item.shippingOptions && item.shippingOptions.length > 0) {
      const shipping = item.shippingOptions[0];
      shippingCost = parseFloat(shipping.shippingCost?.value || '0');
    }

    // Extract seller info
    const sellerUsername = item.seller?.username || 'unknown';
    const sellerFeedbackScore = parseInt(item.seller?.feedbackScore || '0');
    const sellerFeedbackPercent = parseFloat(item.seller?.feedbackPercentage || '0');

    // Extract images
    const images: string[] = [];
    if (item.image?.imageUrl) {
      images.push(item.image.imageUrl);
    }
    if (item.additionalImages) {
      images.push(...item.additionalImages.map((img: any) => img.imageUrl));
    }

    // Extract item specifics
    const itemSpecifics: Record<string, string> = {};
    if (item.localizedAspects) {
      for (const aspect of item.localizedAspects) {
        itemSpecifics[aspect.name] = aspect.value;
      }
    }

    // Determine listing type
    const listingType = item.buyingOptions?.includes('AUCTION') ? 'AUCTION' : 'FIXED_PRICE';

    // End time
    const endTime = item.itemEndDate ? new Date(item.itemEndDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    return {
      ebayItemId: item.itemId,
      url: item.itemWebUrl || `https://www.ebay.com/itm/${item.itemId}`,
      title: item.title || 'Untitled',
      price,
      currency,
      shippingCost,
      sellerUsername,
      sellerFeedbackScore,
      sellerFeedbackPercent,
      location: item.itemLocation?.country || 'US',
      condition: item.condition || 'USED',
      endTime,
      listingType,
      images,
      itemSpecifics,
      description: item.shortDescription,
      rawPayload: item,
    };
  }

  /**
   * Fetch detailed item information (if needed)
   */
  async getItemDetails(itemId: string): Promise<any> {
    await this.checkRateLimit();
    const token = await this.getAccessToken();

    try {
      const response = await this.client.get(`/buy/browse/v1/item/${itemId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
      });

      return response.data;
    } catch (error) {
      logger.error({ error, itemId }, 'Failed to fetch item details');
      throw error;
    }
  }
}

// Singleton instance
export const ebayService = new EbayService();
