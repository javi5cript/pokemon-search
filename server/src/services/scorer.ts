/**
 * Scoring Engine
 * 
 * Implements hard filters and soft scoring for listing evaluation
 */

import type { Listing as PrismaListing, Evaluation as PrismaEvaluation } from '.prisma/client';

type Listing = PrismaListing;
type Evaluation = PrismaEvaluation;

// ============================================================================
// Hard Filters
// ============================================================================

export interface HardFilterResult {
  passed: boolean;
  failedFilters: string[];
}

export interface FilterCriteria {
  requirePhotos?: boolean;
  allowDamageKeywords?: boolean;
  minSellerFeedbackScore?: number;
  minSellerFeedbackPercent?: number;
  minGradeConfidence?: number;
  minPrice?: number;
  maxPrice?: number;
  requiredLanguage?: string;
}

const DAMAGE_KEYWORDS = [
  'damaged', 'crease', 'creased', 'bent', 'torn', 'rip', 'ripped',
  'water damage', 'stain', 'stained', 'marked', 'heavy wear', 'poor condition',
  'for parts', 'damaged see pics', 'dent', 'dented', 'scratched badly'
];

export class HardFilters {
  static apply(
    listing: Listing,
    evaluation: Evaluation | null,
    criteria: FilterCriteria = {}
  ): HardFilterResult {
    const failedFilters: string[] = [];

    // Filter: Has Photos
    if (criteria.requirePhotos !== false) {
      if (!this.hasPhotos(listing)) {
        failedFilters.push('no_photos');
      }
    }

    // Filter: No Damage Keywords
    if (!criteria.allowDamageKeywords) {
      if (!this.noDamageKeywords(listing)) {
        failedFilters.push('damage_keywords');
      }
    }

    // Filter: Seller Feedback Threshold
    const minScore = criteria.minSellerFeedbackScore ?? 100;
    const minPercent = criteria.minSellerFeedbackPercent ?? 97.0;
    if (!this.sellerMeetsThreshold(listing, minScore, minPercent)) {
      failedFilters.push('seller_feedback_low');
    }

    // Filter: Grading Confidence Minimum
    if (evaluation) {
      const minConfidence = criteria.minGradeConfidence ?? 0.3;
      if (!this.gradeConfidenceMinimum(evaluation, minConfidence)) {
        failedFilters.push('grade_confidence_low');
      }
    }

    // Filter: Price Within Range
    if (!this.priceWithinRange(listing, criteria.minPrice, criteria.maxPrice)) {
      failedFilters.push('price_out_of_range');
    }

    // Filter: Language Match
    if (evaluation && criteria.requiredLanguage) {
      if (!this.languageMatches(evaluation, criteria.requiredLanguage)) {
        failedFilters.push('language_mismatch');
      }
    }

    return {
      passed: failedFilters.length === 0,
      failedFilters,
    };
  }

  private static hasPhotos(listing: Listing): boolean {
    const images = typeof listing.images === 'string' 
      ? JSON.parse(listing.images) 
      : listing.images;
    return Array.isArray(images) && images.length > 0;
  }

  private static noDamageKeywords(listing: Listing): boolean {
    const text = `${listing.title} ${listing.description || ''}`.toLowerCase();
    return !DAMAGE_KEYWORDS.some(keyword => text.includes(keyword));
  }

  private static sellerMeetsThreshold(
    listing: Listing,
    minScore: number,
    minPercent: number
  ): boolean {
    return (
      listing.sellerFeedbackScore >= minScore &&
      listing.sellerFeedbackPercent >= minPercent
    );
  }

  private static gradeConfidenceMinimum(
    evaluation: Evaluation,
    minConfidence: number
  ): boolean {
    return (evaluation.gradeConfidence ?? 0) >= minConfidence;
  }

  private static priceWithinRange(
    listing: Listing,
    minPrice?: number,
    maxPrice?: number
  ): boolean {
    const total = listing.price + listing.shippingCost;
    if (minPrice !== undefined && total < minPrice) return false;
    if (maxPrice !== undefined && total > maxPrice) return false;
    return true;
  }

  private static languageMatches(
    evaluation: Evaluation,
    requiredLanguage: string
  ): boolean {
    if (!evaluation.language || evaluation.language === 'unknown') return false;
    return evaluation.language.toLowerCase() === requiredLanguage.toLowerCase();
  }
}

// ============================================================================
// Soft Scoring
// ============================================================================

export interface SoftScoreWeights {
  photoQuality: number;
  sellerReputation: number;
  cardIdentification: number;
  gradingConfidence: number;
  dealMargin: number;
  listingCompleteness: number;
}

export const DEFAULT_WEIGHTS: SoftScoreWeights = {
  photoQuality: 0.15,
  sellerReputation: 0.10,
  cardIdentification: 0.10,
  gradingConfidence: 0.15,
  dealMargin: 0.35,
  listingCompleteness: 0.15,
};

export interface ScoringResult {
  dealScore: number;
  componentScores: {
    photoQuality: number;
    sellerReputation: number;
    cardIdentification: number;
    gradingConfidence: number;
    dealMargin: number;
    listingCompleteness: number;
  };
  weightedScores: {
    photoQuality: number;
    sellerReputation: number;
    cardIdentification: number;
    gradingConfidence: number;
    dealMargin: number;
    listingCompleteness: number;
  };
}

export class SoftScorer {
  static calculateDealScore(
    listing: Listing,
    evaluation: Evaluation,
    weights: SoftScoreWeights = DEFAULT_WEIGHTS
  ): ScoringResult {
    // Calculate component scores (0-10 each)
    const componentScores = {
      photoQuality: this.scorePhotoQuality(listing, evaluation),
      sellerReputation: this.scoreSellerReputation(listing),
      cardIdentification: this.scoreCardIdentification(evaluation),
      gradingConfidence: this.scoreGradingConfidence(evaluation),
      dealMargin: this.scoreDealMargin(listing, evaluation),
      listingCompleteness: this.scoreListingCompleteness(listing),
    };

    // Apply weights
    const weightedScores = {
      photoQuality: componentScores.photoQuality * weights.photoQuality,
      sellerReputation: componentScores.sellerReputation * weights.sellerReputation,
      cardIdentification: componentScores.cardIdentification * weights.cardIdentification,
      gradingConfidence: componentScores.gradingConfidence * weights.gradingConfidence,
      dealMargin: componentScores.dealMargin * weights.dealMargin,
      listingCompleteness: componentScores.listingCompleteness * weights.listingCompleteness,
    };

    // Calculate final score
    const dealScore = Object.values(weightedScores).reduce((sum, score) => sum + score, 0);

    return {
      dealScore: Math.round(dealScore * 100) / 100,
      componentScores,
      weightedScores,
    };
  }

  // --------------------------------------------------------------------------
  // Photo Quality (0-10)
  // --------------------------------------------------------------------------
  private static scorePhotoQuality(listing: Listing, evaluation: Evaluation): number {
    let score = 5; // baseline

    const images = this.parseImages(listing);

    // Number of photos (0-2 points)
    if (images.length >= 4) score += 2;
    else if (images.length >= 2) score += 1;

    // Quality assessment from grading (0-4 points)
    // Note: imageAdequate property removed or not yet in schema
    // if (evaluation.imageAdequate) {
    //   score += 2;
    // }

    // Note: imageMissingViews property not yet in schema
    // const missingViews = this.parseJsonArray(evaluation.imageMissingViews);
    // if (missingViews.length === 0) {
    //   score += 1;
    // }

    // Note: imageQualityIssues property not yet in schema
    // const qualityIssues = this.parseJsonArray(evaluation.imageQualityIssues);
    // if (qualityIssues.length === 0) {
    //   score += 1;
    // } else {
    //   score -= qualityIssues.length * 0.5;
    // }

    return Math.max(0, Math.min(10, score));
  }

  // --------------------------------------------------------------------------
  // Seller Reputation (0-10)
  // --------------------------------------------------------------------------
  private static scoreSellerReputation(listing: Listing): number {
    let score = 0;

    const feedbackScore = listing.sellerFeedbackScore;
    const feedbackPercent = listing.sellerFeedbackPercent;

    // Feedback score component (0-5 points)
    if (feedbackScore >= 5000) score += 5;
    else if (feedbackScore >= 1000) score += 4;
    else if (feedbackScore >= 500) score += 3;
    else if (feedbackScore >= 100) score += 2;
    else score += 1;

    // Feedback percentage component (0-5 points)
    if (feedbackPercent >= 99.5) score += 5;
    else if (feedbackPercent >= 99.0) score += 4;
    else if (feedbackPercent >= 98.0) score += 3;
    else if (feedbackPercent >= 97.0) score += 2;
    else score += 1;

    return score;
  }

  // --------------------------------------------------------------------------
  // Card Identification Confidence (0-10)
  // --------------------------------------------------------------------------
  private static scoreCardIdentification(evaluation: Evaluation): number {
    const confidence = evaluation.parseConfidence ?? 0;
    return confidence * 10;
  }

  // --------------------------------------------------------------------------
  // Grading Confidence (0-10)
  // --------------------------------------------------------------------------
  private static scoreGradingConfidence(evaluation: Evaluation): number {
    const confidence = evaluation.gradeConfidence ?? 0;
    let score = confidence * 10;

    // Bonus for very high confidence
    if (confidence >= 0.8) {
      score = Math.min(10, score + 1);
    }

    return score;
  }

  // --------------------------------------------------------------------------
  // Deal Margin (0-10) - Most Important Factor
  // 
  // Evaluates the profit potential using:
  // - ROI percentage (Return on Investment)
  // - Absolute profit margin
  // - Risk-adjusted scoring based on confidence and variance
  // --------------------------------------------------------------------------
  private static scoreDealMargin(listing: Listing, evaluation: Evaluation): number {
    const totalCost = listing.price + listing.shippingCost;
    const expectedValue = evaluation.expectedValue ?? 0;

    if (expectedValue === 0 || expectedValue === null) return 0;

    const margin = expectedValue - totalCost;
    const marginPercent = (margin / totalCost) * 100; // ROI percentage
    
    // Base score from ROI percentage
    let score = 0;
    if (marginPercent >= 200) score = 10;       // 200%+ ROI - exceptional
    else if (marginPercent >= 150) score = 9.5; // 150-200% ROI
    else if (marginPercent >= 100) score = 9;   // 100-150% ROI - excellent
    else if (marginPercent >= 75) score = 8;    // 75-100% ROI
    else if (marginPercent >= 50) score = 7;    // 50-75% ROI - very good
    else if (marginPercent >= 35) score = 6;    // 35-50% ROI - good
    else if (marginPercent >= 25) score = 5;    // 25-35% ROI - decent
    else if (marginPercent >= 15) score = 3.5;  // 15-25% ROI - marginal
    else if (marginPercent >= 10) score = 2;    // 10-15% ROI - low
    else if (marginPercent > 0) score = 1;      // Positive but minimal
    else return 0;                              // Negative margin - no deal
    
    // Adjustment 1: Absolute margin bonus
    // High-margin deals are more valuable even at lower ROI percentages
    const absoluteMarginBonus = Math.min(1.5, margin / 500); // Up to +1.5 points for $500+ profit
    score += absoluteMarginBonus;
    
    // Adjustment 2: Confidence penalty
    // Lower confidence = reduce score due to higher risk
    const gradeConfidence = evaluation.gradeConfidence ?? 0.5;
    const confidencePenalty = (1.0 - gradeConfidence) * 2; // Up to -2 points for very low confidence
    score -= confidencePenalty;
    
    // Adjustment 3: Grade variance penalty
    // Wide grade range = higher variance = riskier investment
    const gradeRange = (evaluation.predictedGradeMax ?? 0) - (evaluation.predictedGradeMin ?? 0);
    const variancePenalty = Math.min(1.5, gradeRange * 0.4); // Up to -1.5 points for wide ranges
    score -= variancePenalty;
    
    // Adjustment 4: Pricing confidence
    // Uncertain pricing data = reduce score
    const pricingConfidence = evaluation.pricingConfidence ?? 1.0;
    if (pricingConfidence < 0.7) {
      score -= (0.7 - pricingConfidence) * 2; // Up to -1.4 points for very uncertain pricing
    }
    
    // Ensure score stays in valid range
    return Math.max(0, Math.min(10, score));
  }

  // --------------------------------------------------------------------------
  // Listing Completeness (0-10)
  // --------------------------------------------------------------------------
  private static scoreListingCompleteness(listing: Listing): number {
    let score = 0;

    // Title detail (0-2)
    if (listing.title.length > 50) score += 2;
    else if (listing.title.length > 30) score += 1;

    // Description exists and detailed (0-3)
    if (listing.description) {
      if (listing.description.length > 200) score += 3;
      else if (listing.description.length > 100) score += 2;
      else score += 1;
    }

    // Item specifics provided (0-2)
    const itemSpecifics = this.parseItemSpecifics(listing);
    const specificsCount = Object.keys(itemSpecifics).length;
    if (specificsCount >= 5) score += 2;
    else if (specificsCount >= 3) score += 1;

    // Multiple photos (0-3)
    const images = this.parseImages(listing);
    if (images.length >= 5) score += 3;
    else if (images.length >= 3) score += 2;
    else if (images.length >= 1) score += 1;

    return Math.min(10, score);
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private static parseImages(listing: Listing): string[] {
    try {
      const images = typeof listing.images === 'string' 
        ? JSON.parse(listing.images) 
        : listing.images;
      return Array.isArray(images) ? images : [];
    } catch {
      return [];
    }
  }

  private static parseItemSpecifics(listing: Listing): Record<string, string> {
    try {
      if (!listing.itemSpecifics) return {};
      const specifics = typeof listing.itemSpecifics === 'string'
        ? JSON.parse(listing.itemSpecifics)
        : listing.itemSpecifics;
      return typeof specifics === 'object' ? specifics : {};
    } catch {
      return {};
    }
  }

  private static parseJsonArray(field: string | null): string[] {
    if (!field) return [];
    try {
      const parsed = typeof field === 'string' ? JSON.parse(field) : field;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

// ============================================================================
// Combined Scorer
// ============================================================================

export interface ListingScore {
  listingId: string;
  qualified: boolean;
  dealScore: number;
  hardFilterResult: HardFilterResult;
  scoringResult: ScoringResult;
}

export class ListingScorer {
  /**
   * Score a single listing with evaluation (simplified interface for processors)
   */
  scoreListing(
    listing: any,
    evaluation: any
  ): {
    expectedValue: number | null;
    expectedValueMin: number | null;
    expectedValueMax: number | null;
    rawPrice: number | null;
    dealMargin: number | null;
    dealScore: number;
    isQualified: boolean;
    qualificationFlags: string[];
    softScores: Record<string, number>;
  } {
    const result = ListingScorer.score(listing, evaluation);
    
    // Get raw ungraded price from JustTCG
    const rawPrice = evaluation?.marketPriceUngraded || null;
    
    // Calculate expected value based on predicted grade range
    let expectedValue: number | null = null;
    let expectedValueMin: number | null = null;
    let expectedValueMax: number | null = null;
    let dealMargin: number | null = null;
    
    if (evaluation && evaluation.predictedGradeMin && evaluation.predictedGradeMax) {
      const calculations = this.calculateExpectedValueWithConfidence(
        evaluation,
        listing.price + (listing.shippingCost || 0)
      );
      
      expectedValue = calculations.expectedValue;
      expectedValueMin = calculations.expectedValueMin;
      expectedValueMax = calculations.expectedValueMax;
      dealMargin = calculations.dealMargin;
    }

    return {
      expectedValue,
      expectedValueMin,
      expectedValueMax,
      rawPrice,
      dealMargin,
      dealScore: result.dealScore,
      isQualified: result.qualified,
      qualificationFlags: result.hardFilterResult.failedFilters,
      softScores: result.scoringResult.componentScores,
    };
  }

  /**
   * Calculate expected value using probability-weighted approach with risk adjustments
   * 
   * Methodology:
   * 1. Grade distribution: Use confidence to model probability spread
   * 2. Conservative bias: Weight toward lower grades when confidence is low
   * 3. Grading costs: Subtract PSA grading fees (~$30-50 depending on tier)
   * 4. Pricing confidence: Discount if market data is uncertain
   * 5. Variance penalty: Reduce value when grade range is wide (higher risk)
   */
  private calculateExpectedValueWithConfidence(
    evaluation: any,
    totalCost: number
  ): {
    expectedValue: number;
    expectedValueMin: number;
    expectedValueMax: number;
    dealMargin: number;
  } {
    const gradeMin = evaluation.predictedGradeMin;
    const gradeMax = evaluation.predictedGradeMax;
    const gradeConfidence = evaluation.gradeConfidence ?? 0.5;
    const pricingConfidence = evaluation.pricingConfidence ?? 1.0;
    
    // Map grades to market prices
    const priceMap: Record<number, number> = {
      10: evaluation.marketPricePsa10 ?? 0,
      9: evaluation.marketPricePsa9 ?? 0,
      8: evaluation.marketPricePsa8 ?? 0,
      7: evaluation.marketPricePsa7 ?? 0,
      6: evaluation.marketPriceUngraded ?? 0, // PSA 6 and below use ungraded price
      5: evaluation.marketPriceUngraded ?? 0,
      4: evaluation.marketPriceUngraded ?? 0,
    };
    
    // Step 1: Calculate probability distribution across grade range
    // High confidence = concentrated around predicted grade
    // Low confidence = more spread out distribution
    const gradeRange = gradeMax - gradeMin;
    const probabilities: Record<number, number> = {};
    
    if (gradeRange === 0) {
      // Single grade predicted - 100% weight
      probabilities[gradeMax] = 1.0;
    } else if (gradeRange === 1) {
      // Two-grade range - split based on confidence
      // High confidence: 70/30 split favoring higher grade
      // Low confidence: 50/50 split
      const higherGradeProb = 0.5 + (gradeConfidence * 0.2);
      probabilities[gradeMax] = higherGradeProb;
      probabilities[gradeMin] = 1.0 - higherGradeProb;
    } else {
      // Wide range (3+ grades) - apply normal distribution
      // Mean shifts based on confidence (low confidence = lower mean)
      const meanGrade = gradeMin + (gradeRange * (0.4 + gradeConfidence * 0.2));
      const stdDev = gradeRange / (2 + gradeConfidence * 2); // Tighter distribution when confident
      
      for (let grade = Math.floor(gradeMin); grade <= Math.ceil(gradeMax); grade++) {
        // Simplified normal distribution weight
        const distanceFromMean = Math.abs(grade - meanGrade);
        const weight = Math.exp(-(distanceFromMean ** 2) / (2 * stdDev ** 2));
        probabilities[grade] = weight;
      }
      
      // Normalize probabilities to sum to 1.0
      const totalProb = Object.values(probabilities).reduce((sum, p) => sum + p, 0);
      for (const grade in probabilities) {
        probabilities[grade] /= totalProb;
      }
    }
    
    // Step 2: Calculate probability-weighted expected value
    let weightedValue = 0;
    for (const [gradeStr, probability] of Object.entries(probabilities)) {
      const grade = parseInt(gradeStr);
      const marketPrice = priceMap[grade] ?? priceMap[Math.floor(grade)] ?? 0;
      weightedValue += marketPrice * probability;
    }
    
    // Step 3: Apply conservative adjustments
    
    // 3a. Grading cost - PSA pricing tiers
    let gradingCost = 50; // Base: Regular service
    if (weightedValue > 500) {
      gradingCost = 100; // Express service recommended for high-value cards
    } else if (weightedValue > 200) {
      gradingCost = 75; // Value Plus service
    }
    
    // 3b. Pricing confidence discount
    // If market data is uncertain, reduce expected value
    const pricingMultiplier = 0.7 + (pricingConfidence * 0.3); // 0.7 to 1.0
    
    // 3c. Grade variance penalty
    // Wide grade range = higher risk, reduce value
    const variancePenalty = gradeRange === 0 ? 1.0 : (1.0 - (gradeRange * 0.05)); // 5% penalty per grade of uncertainty
    
    // 3d. Confidence multiplier
    // Lower confidence = additional conservative discount
    const confidenceMultiplier = 0.85 + (gradeConfidence * 0.15); // 0.85 to 1.0
    
    // Apply all adjustments
    let expectedValue = weightedValue * pricingMultiplier * variancePenalty * confidenceMultiplier;
    
    // Subtract grading costs
    expectedValue = Math.max(0, expectedValue - gradingCost);
    
    // Step 4: Calculate min/max range for reference
    const priceForGrade = (grade: number): number => {
      return priceMap[grade] ?? priceMap[Math.floor(grade)] ?? 0;
    };
    
    const expectedValueMin = Math.max(0, (priceForGrade(gradeMin) * pricingMultiplier * confidenceMultiplier) - gradingCost);
    const expectedValueMax = Math.max(0, (priceForGrade(gradeMax) * pricingMultiplier) - gradingCost);
    
    // Step 5: Calculate deal margin
    const dealMargin = expectedValue - totalCost;
    
    return {
      expectedValue: Math.round(expectedValue * 100) / 100,
      expectedValueMin: Math.round(expectedValueMin * 100) / 100,
      expectedValueMax: Math.round(expectedValueMax * 100) / 100,
      dealMargin: Math.round(dealMargin * 100) / 100,
    };
  }

  static score(
    listing: Listing,
    evaluation: Evaluation | null,
    filterCriteria: FilterCriteria = {},
    scoreWeights: SoftScoreWeights = DEFAULT_WEIGHTS
  ): ListingScore {
    // Apply hard filters
    const hardFilterResult = HardFilters.apply(listing, evaluation, filterCriteria);

    // Calculate soft scores (even if hard filters fail, for analysis)
    let scoringResult: ScoringResult;
    
    if (evaluation) {
      scoringResult = SoftScorer.calculateDealScore(listing, evaluation, scoreWeights);
    } else {
      // No evaluation - assign zero scores
      scoringResult = {
        dealScore: 0,
        componentScores: {
          photoQuality: 0,
          sellerReputation: SoftScorer['scoreSellerReputation'](listing),
          cardIdentification: 0,
          gradingConfidence: 0,
          dealMargin: 0,
          listingCompleteness: SoftScorer['scoreListingCompleteness'](listing),
        },
        weightedScores: {
          photoQuality: 0,
          sellerReputation: 0,
          cardIdentification: 0,
          gradingConfidence: 0,
          dealMargin: 0,
          listingCompleteness: 0,
        },
      };
    }

    return {
      listingId: listing.id,
      qualified: hardFilterResult.passed,
      dealScore: scoringResult.dealScore,
      hardFilterResult,
      scoringResult,
    };
  }

  /**
   * Rank listings by deal score
   */
  static rankListings(scores: ListingScore[]): ListingScore[] {
    return scores
      .filter(s => s.qualified)
      .sort((a, b) => b.dealScore - a.dealScore);
  }
}
