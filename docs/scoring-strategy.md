# Scoring Strategy

This document details the algorithm for evaluating and ranking Pokémon card listings.

## Overview

The scoring system evaluates listings across multiple dimensions to identify the best opportunities. Each listing receives:

1. **Hard Filter Pass/Fail** - Binary qualification checks
2. **Soft Scores** - Multi-factor weighted scoring (0-10)
3. **Deal Score** - Final composite score representing opportunity quality

---

## Scoring Pipeline

```
Listing Input
    ↓
[Hard Filters] → FAIL → Disqualify
    ↓ PASS
[Soft Scoring]
    ↓
[Deal Score Calculation]
    ↓
[Ranking & Output]
```

---

## 1. Hard Filters (Pass/Fail)

These are binary checks that immediately disqualify a listing.

### Filter: Has Photos

```typescript
function hasPhotos(listing: Listing): boolean {
  return listing.images.length > 0;
}
```

**Rationale**: Cannot assess condition without images.

---

### Filter: No Damage Keywords

```typescript
const DAMAGE_KEYWORDS = [
  'damaged', 'crease', 'creased', 'bent', 'torn', 'rip', 'ripped',
  'water damage', 'stain', 'marked', 'heavy wear', 'poor condition',
  'for parts', 'damaged see pics'
];

function noDamageKeywords(listing: Listing): boolean {
  const text = (listing.title + ' ' + listing.description).toLowerCase();
  return !DAMAGE_KEYWORDS.some(keyword => text.includes(keyword));
}
```

**Rationale**: Explicitly damaged cards are not grading candidates.

**Exception**: May allow if grading assessment shows better than described.

---

### Filter: Seller Feedback Threshold

```typescript
function sellerMeetsThreshold(
  listing: Listing,
  minScore: number = 100,
  minPercent: number = 97.0
): boolean {
  return (
    listing.seller.feedbackScore >= minScore &&
    listing.seller.feedbackPercent >= minPercent
  );
}
```

**Rationale**: Reduce risk of fraud or misrepresentation.

**Configurable**: Users can adjust thresholds.

---

### Filter: Grading Confidence Minimum

```typescript
function gradeConfidenceMinimum(
  evaluation: Evaluation,
  minConfidence: number = 0.3
): boolean {
  return evaluation.gradeConfidence >= minConfidence;
}
```

**Rationale**: Too uncertain to make investment decision.

---

### Filter: Price Within Range

```typescript
function priceWithinRange(
  listing: Listing,
  minPrice?: number,
  maxPrice?: number
): boolean {
  const total = listing.price + listing.shippingCost;
  if (minPrice && total < minPrice) return false;
  if (maxPrice && total > maxPrice) return false;
  return true;
}
```

**Rationale**: User-defined price constraints.

---

### Filter: Language Match

```typescript
function languageMatches(
  evaluation: Evaluation,
  requiredLanguage?: string
): boolean {
  if (!requiredLanguage) return true;
  if (evaluation.language === 'unknown') return false;
  return evaluation.language === requiredLanguage;
}
```

**Rationale**: Market prices vary significantly by language.

---

## 2. Soft Scoring (0-10 scale)

Each factor receives a score 0-10, which is then weighted.

### Score: Photo Quality

```typescript
function scorePhotoQuality(listing: Listing, grading: GradingResult): number {
  let score = 5; // baseline
  
  // Number of photos
  if (listing.images.length >= 4) score += 2;
  else if (listing.images.length >= 2) score += 1;
  
  // Quality assessment from grading
  if (grading.imageQuality.adequateForGrading) {
    score += 2;
  }
  
  if (grading.imageQuality.missingViews.length === 0) {
    score += 1;
  }
  
  if (grading.imageQuality.photoQualityIssues.length === 0) {
    score += 1;
  } else {
    score -= grading.imageQuality.photoQualityIssues.length * 0.5;
  }
  
  return Math.max(0, Math.min(10, score));
}
```

**Weight**: 0.15

---

### Score: Seller Reputation

```typescript
function scoreSellerReputation(listing: Listing): number {
  const { feedbackScore, feedbackPercent } = listing.seller;
  
  let score = 0;
  
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
```

**Weight**: 0.10

---

### Score: Card Identification Confidence

```typescript
function scoreCardIdentification(evaluation: Evaluation): number {
  const conf = evaluation.parseConfidence;
  
  // Direct mapping of confidence to 0-10 scale
  return conf * 10;
}
```

**Weight**: 0.10

---

### Score: Grading Confidence

```typescript
function scoreGradingConfidence(evaluation: Evaluation): number {
  const conf = evaluation.gradeConfidence;
  
  // Direct mapping with boost for high confidence
  let score = conf * 10;
  
  // Bonus for very high confidence
  if (conf >= 0.8) score = Math.min(10, score + 1);
  
  return score;
}
```

**Weight**: 0.15

---

### Score: Deal Margin

```typescript
function scoreDealMargin(
  listing: Listing,
  evaluation: Evaluation
): number {
  const totalCost = listing.price + listing.shippingCost;
  const expectedValue = evaluation.expectedValue;
  
  if (!expectedValue || expectedValue === 0) return 0;
  
  const margin = expectedValue - totalCost;
  const marginPercent = (margin / totalCost) * 100;
  
  // Score based on margin percentage
  if (marginPercent >= 150) return 10;      // 150%+ margin
  if (marginPercent >= 100) return 9;       // 100-150% margin
  if (marginPercent >= 75) return 8;        // 75-100% margin
  if (marginPercent >= 50) return 7;        // 50-75% margin
  if (marginPercent >= 25) return 5;        // 25-50% margin
  if (marginPercent >= 10) return 3;        // 10-25% margin
  if (marginPercent > 0) return 1;          // Positive margin
  return 0;                                  // Negative margin
}
```

**Weight**: 0.35 (highest weight - most important factor)

---

### Score: Listing Completeness

```typescript
function scoreListingCompleteness(listing: Listing): number {
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
  const specificsCount = Object.keys(listing.itemSpecifics || {}).length;
  if (specificsCount >= 5) score += 2;
  else if (specificsCount >= 3) score += 1;
  
  // Multiple photos (0-3)
  if (listing.images.length >= 5) score += 3;
  else if (listing.images.length >= 3) score += 2;
  else if (listing.images.length >= 1) score += 1;
  
  return Math.min(10, score);
}
```

**Weight**: 0.10

---

### Score: Condition Quality

```typescript
function scoreConditionQuality(evaluation: Evaluation): number {
  const avgGrade = (evaluation.predictedGradeMin + evaluation.predictedGradeMax) / 2;
  
  // Map grade to 0-10 scale
  // PSA 10 = 10, PSA 9 = 9, ..., PSA 1 = 1
  return avgGrade;
}
```

**Weight**: 0.05

---

## 3. Deal Score Calculation

### Weighted Score

```typescript
const WEIGHTS = {
  photoQuality: 0.15,
  sellerReputation: 0.10,
  cardIdentification: 0.10,
  gradingConfidence: 0.15,
  dealMargin: 0.35,
  listingCompleteness: 0.10,
  conditionQuality: 0.05
};

function calculateWeightedScore(scores: SoftScores): number {
  return (
    scores.photoQuality * WEIGHTS.photoQuality +
    scores.sellerReputation * WEIGHTS.sellerReputation +
    scores.cardIdentification * WEIGHTS.cardIdentification +
    scores.gradingConfidence * WEIGHTS.gradingConfidence +
    scores.dealMargin * WEIGHTS.dealMargin +
    scores.listingCompleteness * WEIGHTS.listingCompleteness +
    scores.conditionQuality * WEIGHTS.conditionQuality
  );
}
```

### Final Deal Score

The deal score is expressed as a percentage representing the overall opportunity quality:

```typescript
function calculateDealScore(
  listing: Listing,
  evaluation: Evaluation
): number {
  // Calculate all soft scores
  const scores = {
    photoQuality: scorePhotoQuality(listing, evaluation.grading),
    sellerReputation: scoreSellerReputation(listing),
    cardIdentification: scoreCardIdentification(evaluation),
    gradingConfidence: scoreGradingConfidence(evaluation),
    dealMargin: scoreDealMargin(listing, evaluation),
    listingCompleteness: scoreListingCompleteness(listing),
    conditionQuality: scoreConditionQuality(evaluation)
  };
  
  // Calculate weighted score (0-10)
  const weightedScore = calculateWeightedScore(scores);
  
  // Convert to percentage (0-100)
  // Add bonus multiplier for exceptional deals
  let dealScore = weightedScore * 10;
  
  // Bonus: Exceptional margin (>100%)
  const totalCost = listing.price + listing.shippingCost;
  const marginPercent = ((evaluation.expectedValue - totalCost) / totalCost) * 100;
  if (marginPercent > 100) {
    dealScore *= 1.2; // 20% bonus
  }
  
  // Cap at reasonable maximum
  return Math.min(200, dealScore);
}
```

**Interpretation**:
- **150-200**: Exceptional opportunity
- **100-150**: Excellent opportunity
- **75-100**: Very good opportunity
- **50-75**: Good opportunity
- **25-50**: Fair opportunity
- **0-25**: Marginal opportunity

---

## 4. Expected Value Calculation

Expected value is calculated using a conservative approach:

```typescript
function calculateExpectedValue(
  evaluation: Evaluation,
  pricing: PricingResult
): number {
  const { predictedGradeMin, predictedGradeMax, gradeConfidence } = evaluation;
  
  // Map grades to prices
  const gradeToPrice = {
    10: pricing.marketPricePSA10,
    9: pricing.marketPricePSA9,
    8: pricing.marketPricePSA8,
    7: pricing.marketPricePSA7,
    ungraded: pricing.marketPriceUngraded
  };
  
  // Conservative estimate: use minimum predicted grade
  const conservativeGrade = Math.floor(predictedGradeMin);
  let expectedValue = gradeToPrice[conservativeGrade] || gradeToPrice.ungraded || 0;
  
  // Adjust for confidence
  // Low confidence = further reduce expected value
  const confidenceMultiplier = 0.7 + (gradeConfidence * 0.3); // 0.7 to 1.0
  expectedValue *= confidenceMultiplier;
  
  // Subtract grading costs (~$30-50 for PSA)
  const GRADING_COST = 40;
  expectedValue = Math.max(0, expectedValue - GRADING_COST);
  
  return expectedValue;
}
```

---

## 5. Ranking Algorithm

```typescript
function rankListings(evaluations: Evaluation[]): Evaluation[] {
  return evaluations
    .filter(e => e.isQualified) // Only qualified listings
    .sort((a, b) => {
      // Primary sort: Deal score (descending)
      if (b.dealScore !== a.dealScore) {
        return b.dealScore - a.dealScore;
      }
      
      // Secondary sort: Deal margin (descending)
      if (b.dealMargin !== a.dealMargin) {
        return b.dealMargin - a.dealMargin;
      }
      
      // Tertiary sort: Grading confidence (descending)
      return b.gradeConfidence - a.gradeConfidence;
    });
}
```

---

## 6. Adjustment Factors

### Time-Based Adjustments

```typescript
function applyTimeAdjustment(
  dealScore: number,
  listing: Listing
): number {
  const now = new Date();
  const endTime = new Date(listing.endTime);
  const hoursLeft = (endTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  // Boost score for ending soon (urgency)
  if (hoursLeft < 2) {
    return dealScore * 1.1; // 10% boost
  }
  
  // Slight boost for ending within 24 hours
  if (hoursLeft < 24) {
    return dealScore * 1.05; // 5% boost
  }
  
  return dealScore;
}
```

### Pricing Confidence Adjustment

```typescript
function applyPricingConfidenceAdjustment(
  expectedValue: number,
  pricingConfidence: number
): number {
  // Reduce expected value based on pricing confidence
  return expectedValue * (0.5 + (pricingConfidence * 0.5));
}
```

---

## 7. Flag System

Listings can have warning flags that inform but don't disqualify:

```typescript
enum QualificationFlag {
  MISSING_PHOTOS = 'Missing key photo angles',
  LOW_SELLER_FEEDBACK = 'Seller has low feedback score',
  VAGUE_DESCRIPTION = 'Description lacks detail',
  POOR_PHOTO_QUALITY = 'Photo quality is suboptimal',
  LOW_PARSE_CONFIDENCE = 'Card identification uncertain',
  LOW_GRADE_CONFIDENCE = 'Condition assessment uncertain',
  PRICING_UNCERTAIN = 'Market pricing data uncertain',
  NO_BACK_PHOTO = 'Back of card not visible',
  POTENTIAL_FAKE = 'Authenticity concerns',
  UNREALISTIC_GRADE = 'Seller claim differs from assessment',
  AUCTION_RISK = 'Auction may increase final price'
}

function generateFlags(
  listing: Listing,
  evaluation: Evaluation
): QualificationFlag[] {
  const flags: QualificationFlag[] = [];
  
  if (listing.images.length < 2) {
    flags.push(QualificationFlag.MISSING_PHOTOS);
  }
  
  if (!evaluation.grading.imageQuality.adequateForGrading) {
    flags.push(QualificationFlag.POOR_PHOTO_QUALITY);
  }
  
  if (evaluation.grading.imageQuality.missingViews.includes('Back of card')) {
    flags.push(QualificationFlag.NO_BACK_PHOTO);
  }
  
  if (listing.seller.feedbackScore < 100) {
    flags.push(QualificationFlag.LOW_SELLER_FEEDBACK);
  }
  
  if (evaluation.parseConfidence < 0.7) {
    flags.push(QualificationFlag.LOW_PARSE_CONFIDENCE);
  }
  
  if (evaluation.gradeConfidence < 0.5) {
    flags.push(QualificationFlag.LOW_GRADE_CONFIDENCE);
  }
  
  if (evaluation.pricingConfidence < 0.7) {
    flags.push(QualificationFlag.PRICING_UNCERTAIN);
  }
  
  if (listing.listingType === 'auction') {
    flags.push(QualificationFlag.AUCTION_RISK);
  }
  
  return flags;
}
```

---

## 8. Example Calculations

### Example 1: Excellent Opportunity

**Listing**:
- Price: $450
- Shipping: $15
- Total Cost: $465
- Photos: 4 high-quality
- Seller: 1500 feedback, 99.8%

**Evaluation**:
- Card: Charizard Base Set 4/102 1st Ed
- Parse Confidence: 0.95
- Predicted Grade: 7-8
- Grade Confidence: 0.75
- Market Price PSA 7: $1200
- Expected Value: $1160 (after grading costs)

**Scores**:
- Photo Quality: 9/10 → weighted: 1.35
- Seller Reputation: 9/10 → weighted: 0.90
- Card Identification: 9.5/10 → weighted: 0.95
- Grading Confidence: 8.5/10 → weighted: 1.28
- Deal Margin: 10/10 → weighted: 3.50 (149% margin)
- Listing Completeness: 8/10 → weighted: 0.80
- Condition Quality: 7.5/10 → weighted: 0.38

**Weighted Score**: 9.16/10
**Deal Score**: 91.6 * 1.2 (bonus) = **109.9**

**Ranking**: **Excellent** - Top tier opportunity

---

### Example 2: Marginal Opportunity

**Listing**:
- Price: $380
- Shipping: $20
- Total Cost: $400
- Photos: 2 average quality
- Seller: 150 feedback, 97.5%

**Evaluation**:
- Card: Pikachu Jungle 60/64
- Parse Confidence: 0.70
- Predicted Grade: 6-7
- Grade Confidence: 0.50
- Market Price PSA 6: $450
- Expected Value: $360 (after grading costs)

**Scores**:
- Photo Quality: 5/10 → weighted: 0.75
- Seller Reputation: 4/10 → weighted: 0.40
- Card Identification: 7/10 → weighted: 0.70
- Grading Confidence: 6/10 → weighted: 0.90
- Deal Margin: 0/10 → weighted: 0.00 (negative margin)
- Listing Completeness: 4/10 → weighted: 0.40
- Condition Quality: 6.5/10 → weighted: 0.33

**Weighted Score**: 3.48/10
**Deal Score**: **34.8**

**Ranking**: **Marginal** - Likely not worth pursuing

---

## 9. Tuning Parameters

These constants can be adjusted based on user preferences or market conditions:

```typescript
const SCORING_CONFIG = {
  // Grading cost assumption
  GRADING_COST: 40,
  
  // Minimum thresholds
  MIN_DEAL_SCORE: 50,
  MIN_SELLER_FEEDBACK: 100,
  MIN_SELLER_PERCENT: 97.0,
  MIN_PARSE_CONFIDENCE: 0.5,
  MIN_GRADE_CONFIDENCE: 0.3,
  
  // Weight adjustments (user preference)
  RISK_TOLERANCE: 'medium', // 'low', 'medium', 'high'
  
  // Bonus multipliers
  EXCEPTIONAL_MARGIN_THRESHOLD: 100, // percent
  EXCEPTIONAL_MARGIN_BONUS: 1.2,
  URGENCY_THRESHOLD_HOURS: 2,
  URGENCY_BONUS: 1.1
};
```

---

## 10. Machine Learning Future Enhancements

Potential ML improvements:

1. **Historical Performance Tracking**
   - Track actual selling prices vs predictions
   - Adjust pricing confidence based on historical accuracy

2. **Personalized Scoring**
   - Learn user preferences from their actions
   - Adjust weights based on what they actually purchase

3. **Market Trend Analysis**
   - Identify trending cards
   - Adjust expected values based on market momentum

4. **Fraud Detection**
   - ML model to identify suspicious listings
   - Pattern recognition for fake cards

5. **Grading Accuracy Improvement**
   - Train on known PSA-graded results
   - Improve grade prediction accuracy over time
