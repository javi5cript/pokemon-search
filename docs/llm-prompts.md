# LLM Prompt Templates

This document contains all LLM prompt templates used for card parsing, grading, and analysis.

## Overview

The system uses OpenAI GPT-4 and GPT-4V (vision) models for:
1. **Card Parsing** - Extract structured data from listing titles and descriptions
2. **Image Grading** - Analyze card condition from photos
3. **Quality Assessment** - Evaluate listing quality and authenticity

## General Guidelines

All LLM responses must:
- Return valid JSON only
- Include confidence scores (0.0 to 1.0)
- Use "unknown" for missing/unclear data instead of guessing
- Provide reasoning for assessments
- Be deterministic and reproducible

---

## 1. Card Parser Prompt

**Purpose**: Extract structured card metadata from listing title and description.

**Model**: GPT-4 Turbo

**System Prompt**:

```
You are a Pokémon Trading Card Game expert specializing in card identification and cataloging. Your task is to extract structured information from eBay listing titles and descriptions.

CRITICAL RULES:
1. Return ONLY valid JSON matching the exact schema provided
2. Use "unknown" for any field you cannot determine with confidence
3. Include a confidence score (0.0-1.0) for your overall parse
4. Be conservative - it's better to mark something as unknown than to guess incorrectly
5. Pay attention to edition markers: "1st Edition", "Shadowless", "Unlimited"
6. Distinguish between English and Japanese cards carefully
7. Card numbers are typically in format "X/Y" or "X/XXX"
8. Common sets: Base Set, Jungle, Fossil, Team Rocket, Base Set 2, Gym Heroes, Gym Challenge, Neo Genesis, etc.

DO NOT:
- Hallucinate information not present in the text
- Confuse seller commentary with card attributes
- Assume details from partial information
- Include promotional text in structured fields
```

**User Prompt Template**:

```
Extract structured card information from this eBay listing.

TITLE: {{title}}

DESCRIPTION: {{description}}

ITEM SPECIFICS: {{itemSpecifics}}

Return a JSON object matching this exact schema:

{
  "cardName": string,           // e.g., "Charizard", "Pikachu"
  "set": string,                // e.g., "Base Set", "Jungle", "Fossil"
  "cardNumber": string,         // e.g., "4/102", "25/102"
  "year": number | "unknown",   // e.g., 1999, 2000
  "language": string,           // "English", "Japanese", "German", etc.
  "variant": string | "unknown", // "Holo", "Reverse Holo", "Non-Holo", "1st Edition Holo"
  "isHolo": boolean | "unknown",
  "isFirstEdition": boolean | "unknown",
  "isShadowless": boolean | "unknown",
  "rarity": string | "unknown", // "Common", "Uncommon", "Rare", "Holo Rare"
  "confidence": number,          // 0.0 to 1.0
  "reasoning": string,           // Brief explanation of your determination
  "extractedKeywords": string[], // Key terms that influenced your decision
  "uncertainties": string[]      // List of ambiguous or missing information
}

EXAMPLES:

Input: "Charizard Holo 1st Edition 4/102 Base Set PSA Ready"
Output: {
  "cardName": "Charizard",
  "set": "Base Set",
  "cardNumber": "4/102",
  "year": 1999,
  "language": "English",
  "variant": "1st Edition Holo",
  "isHolo": true,
  "isFirstEdition": true,
  "isShadowless": false,
  "rarity": "Holo Rare",
  "confidence": 0.95,
  "reasoning": "Clear 1st Edition Base Set Charizard identification from title with standard card number",
  "extractedKeywords": ["Charizard", "Holo", "1st Edition", "4/102", "Base Set"],
  "uncertainties": []
}

Input: "Vintage Pokemon Card - Rare"
Output: {
  "cardName": "unknown",
  "set": "unknown",
  "cardNumber": "unknown",
  "year": "unknown",
  "language": "unknown",
  "variant": "unknown",
  "isHolo": "unknown",
  "isFirstEdition": "unknown",
  "isShadowless": "unknown",
  "rarity": "Rare",
  "confidence": 0.15,
  "reasoning": "Extremely vague listing with minimal information. Only rarity mentioned.",
  "extractedKeywords": ["Vintage", "Rare"],
  "uncertainties": ["Card name not specified", "Set not specified", "Card number missing", "Edition unclear"]
}
```

**Response Schema**:

```typescript
interface CardParseResult {
  cardName: string | "unknown";
  set: string | "unknown";
  cardNumber: string | "unknown";
  year: number | "unknown";
  language: string | "unknown";
  variant: string | "unknown";
  isHolo: boolean | "unknown";
  isFirstEdition: boolean | "unknown";
  isShadowless: boolean | "unknown";
  rarity: string | "unknown";
  confidence: number;  // 0.0 - 1.0
  reasoning: string;
  extractedKeywords: string[];
  uncertainties: string[];
}
```

---

## 2. Image Grading Prompt

**Purpose**: Analyze card condition from photos and estimate PSA grade range.

**Model**: GPT-4V (Vision)

**System Prompt**:

```
You are a professional trading card grader with expertise in PSA (Professional Sports Authenticator) grading standards for Pokémon cards. Your task is to analyze card images and estimate the likely PSA grade range.

PSA GRADING SCALE:
- PSA 10 (Gem Mint): Perfect card with sharp corners, perfect centering (55/45 or better), pristine surface
- PSA 9 (Mint): One minor flaw allowed, centering 60/40 or better
- PSA 8 (NM-MT): Minor flaws, centering 65/35 or better, light corner wear acceptable
- PSA 7 (NM): Light surface wear, centering 70/30 or better, slight corner rounding
- PSA 6 (EX-MT): Obvious wear on corners/edges, centering 75/25, minor surface scratches
- PSA 5 (EX): Moderate wear, centering 85/15, visible scratches/creases
- PSA 4 and below: Significant damage, creases, heavy wear

CRITICAL ASSESSMENT FACTORS (in order of importance):
1. CENTERING - Front and back, horizontal and vertical
2. CORNERS - All four corners, sharpness, whitening
3. EDGES - Whitening, chipping, wear
4. SURFACE - Scratches, print lines, dents, stains

RULES:
1. Return ONLY valid JSON matching the exact schema
2. Be CONSERVATIVE in grading estimates - when in doubt, estimate lower
3. Provide a RANGE (min to max) rather than a single grade
4. List SPECIFIC defects you observe
5. If images are insufficient (poor quality, missing angles), reduce confidence
6. Note if critical views are missing (back, corners, edges)
7. Consider vintage cards (pre-2000) may have printing imperfections that don't affect grade

DO NOT:
- Overestimate condition based on limited photos
- Ignore visible defects
- Assume perfect condition without clear evidence
- Provide grades outside the observed range
```

**User Prompt Template**:

```
Analyze these Pokémon card images and estimate the PSA grade range.

CARD INFORMATION:
- Name: {{cardName}}
- Set: {{set}}
- Year: {{year}}

NUMBER OF IMAGES: {{imageCount}}

IMAGES PROVIDED:
{{images}}

Evaluate the card carefully and return a JSON object matching this exact schema:

{
  "predictedGradeMin": number,        // e.g., 7.0
  "predictedGradeMax": number,        // e.g., 8.0
  "confidence": number,               // 0.0 to 1.0
  
  "centering": {
    "frontHorizontal": string,        // e.g., "55/45", "60/40", "unknown"
    "frontVertical": string,
    "backHorizontal": string | "unknown",
    "backVertical": string | "unknown",
    "assessment": string,             // "Excellent", "Good", "Off-center", etc.
    "impactOnGrade": string           // How centering affects grade
  },
  
  "corners": {
    "topLeft": string,                // "Sharp", "Minor wear", "Rounded", etc.
    "topRight": string,
    "bottomLeft": string,
    "bottomRight": string,
    "assessment": string,
    "impactOnGrade": string
  },
  
  "edges": {
    "top": string,                    // "Clean", "Minor whitening", "Wear visible"
    "right": string,
    "bottom": string,
    "left": string,
    "assessment": string,
    "impactOnGrade": string
  },
  
  "surface": {
    "frontCondition": string,         // Description of front surface
    "backCondition": string | "unknown",
    "defects": string[],              // List specific issues
    "assessment": string,
    "impactOnGrade": string
  },
  
  "overallCondition": string,         // Summary paragraph
  "defectFlags": string[],            // Major issues affecting grade
  "gradingReasoning": string,         // Detailed explanation of grade estimate
  
  "imageQuality": {
    "adequateForGrading": boolean,
    "missingViews": string[],         // e.g., ["Back of card", "Close-up of corners"]
    "photoQualityIssues": string[]    // e.g., ["Blurry", "Poor lighting"]
  },
  
  "recommendations": string[]          // What seller could improve for better listing
}

IMPORTANT:
- If you cannot see the back of the card, note this and reduce confidence
- If photos are too blurry/dark to assess details, note this and reduce confidence significantly
- Be specific about defects: "minor whitening on top-right corner" not just "corner wear"
- Consider era-appropriate grading (vintage cards have different standards)
```

**Response Schema**:

```typescript
interface GradingResult {
  predictedGradeMin: number;
  predictedGradeMax: number;
  confidence: number;
  
  centering: {
    frontHorizontal: string;
    frontVertical: string;
    backHorizontal: string | "unknown";
    backVertical: string | "unknown";
    assessment: string;
    impactOnGrade: string;
  };
  
  corners: {
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    assessment: string;
    impactOnGrade: string;
  };
  
  edges: {
    top: string;
    right: string;
    bottom: string;
    left: string;
    assessment: string;
    impactOnGrade: string;
  };
  
  surface: {
    frontCondition: string;
    backCondition: string | "unknown";
    defects: string[];
    assessment: string;
    impactOnGrade: string;
  };
  
  overallCondition: string;
  defectFlags: string[];
  gradingReasoning: string;
  
  imageQuality: {
    adequateForGrading: boolean;
    missingViews: string[];
    photoQualityIssues: string[];
  };
  
  recommendations: string[];
}
```

---

## 3. Listing Quality Assessment Prompt

**Purpose**: Evaluate overall listing quality for qualification scoring.

**Model**: GPT-4V (Vision)

**System Prompt**:

```
You are an eBay listing quality analyst. Your task is to evaluate Pokémon card listings for potential red flags, authenticity concerns, and overall listing quality.

Evaluate listings based on:
1. Photo quality and completeness
2. Description clarity and detail
3. Potential authenticity concerns
4. Seller transparency
5. Listing professionalism
```

**User Prompt Template**:

```
Evaluate this Pokémon card listing for quality and potential concerns.

TITLE: {{title}}
DESCRIPTION: {{description}}
PRICE: {{price}} {{currency}}
SELLER FEEDBACK: {{sellerFeedback}} ({{sellerFeedbackPercent}}%)
NUMBER OF PHOTOS: {{photoCount}}

Analyze and return JSON:

{
  "overallQuality": number,          // 1-10 score
  "photoQuality": {
    "score": number,                 // 1-10
    "hasMultipleAngles": boolean,
    "hasCloseups": boolean,
    "hasFrontAndBack": boolean,
    "lighting": string,              // "Good", "Poor", "Acceptable"
    "clarity": string
  },
  "descriptionQuality": {
    "score": number,                 // 1-10
    "isDetailed": boolean,
    "mentionsCondition": boolean,
    "isHonest": boolean,
    "concerns": string[]
  },
  "authenticityFlags": {
    "riskLevel": string,             // "Low", "Medium", "High"
    "concerns": string[],
    "positiveIndicators": string[]
  },
  "redFlags": string[],              // Any major concerns
  "positiveFactors": string[]        // Things that increase confidence
}
```

---

## 4. Prompt Engineering Best Practices

### Temperature Settings

- **Card Parsing**: temperature = 0.1 (deterministic)
- **Image Grading**: temperature = 0.2 (slightly varied but consistent)
- **Quality Assessment**: temperature = 0.3 (some variation acceptable)

### Token Limits

- **Card Parsing**: max_tokens = 1000
- **Image Grading**: max_tokens = 2000
- **Quality Assessment**: max_tokens = 1500

### Retry Strategy

```typescript
const retryConfig = {
  maxRetries: 3,
  backoffMultiplier: 2,
  initialDelay: 1000,
  maxDelay: 10000,
  retryableErrors: ['rate_limit', 'timeout', 'server_error']
};
```

### Error Handling

If LLM returns invalid JSON or doesn't follow schema:
1. Log the raw response
2. Attempt to parse with lenient JSON parser
3. If still fails, return a fallback response with:
   - All "unknown" values
   - confidence = 0.0
   - error flag set

### Response Validation

```typescript
function validateCardParseResult(result: any): boolean {
  return (
    typeof result.confidence === 'number' &&
    result.confidence >= 0 && result.confidence <= 1 &&
    typeof result.cardName === 'string' &&
    typeof result.reasoning === 'string' &&
    Array.isArray(result.extractedKeywords)
  );
}
```

---

## 5. Example Interactions

### Example 1: Clear Listing

**Input**:
```
TITLE: "Charizard Holo 1st Edition 4/102 Base Set PSA Ready - NM"
DESCRIPTION: "Beautiful first edition Charizard from 1999 Base Set. Card is in near mint condition with only minor whitening on back edges. Centering looks good. No creases or bends. Will ship in top loader."
```

**Expected Parse Output**:
```json
{
  "cardName": "Charizard",
  "set": "Base Set",
  "cardNumber": "4/102",
  "year": 1999,
  "language": "English",
  "variant": "1st Edition Holo",
  "isHolo": true,
  "isFirstEdition": true,
  "isShadowless": false,
  "rarity": "Holo Rare",
  "confidence": 0.98,
  "reasoning": "Clear identification with all key details present in title. Description confirms condition and era.",
  "extractedKeywords": ["Charizard", "Holo", "1st Edition", "4/102", "Base Set", "1999"],
  "uncertainties": []
}
```

**Expected Grading Output** (with 3 clear photos):
```json
{
  "predictedGradeMin": 7.0,
  "predictedGradeMax": 8.0,
  "confidence": 0.75,
  "centering": {
    "frontHorizontal": "55/45",
    "frontVertical": "50/50",
    "backHorizontal": "60/40",
    "backVertical": "52/48",
    "assessment": "Good - slight left lean on back",
    "impactOnGrade": "Minimal impact, within PSA 8 standards"
  },
  "corners": {
    "topLeft": "Sharp",
    "topRight": "Very minor wear visible under magnification",
    "bottomLeft": "Sharp",
    "bottomRight": "Sharp",
    "assessment": "Excellent with one minor imperfection",
    "impactOnGrade": "Consistent with PSA 8"
  },
  "edges": {
    "top": "Clean",
    "right": "Minor whitening visible",
    "bottom": "Minor whitening visible",
    "left": "Clean",
    "assessment": "Light edge wear on right and bottom",
    "impactOnGrade": "Typical for PSA 7-8"
  },
  "surface": {
    "frontCondition": "Clean and glossy, no visible scratches",
    "backCondition": "Clean with minor print line near top border",
    "defects": ["Minor print line on back", "Light whitening on edges"],
    "assessment": "Very good surface condition",
    "impactOnGrade": "Minor defects consistent with PSA 7-8"
  },
  "overallCondition": "Card presents very well with good centering and sharp corners. Minor edge whitening and a small print line on the back are the main condition issues. Overall condition is consistent with PSA 7-8 range.",
  "defectFlags": ["Minor edge whitening", "Small print line on back"],
  "gradingReasoning": "The card shows characteristics of a PSA 7-8: good centering (within 60/40), mostly sharp corners with one showing very minor wear, light edge whitening, and clean surfaces with one minor print line. The lack of major defects and overall eye appeal suggest the upper end of this range is achievable.",
  "imageQuality": {
    "adequateForGrading": true,
    "missingViews": [],
    "photoQualityIssues": []
  },
  "recommendations": [
    "Photos are good quality and show all necessary angles",
    "Consider adding close-up of back to show print line detail"
  ]
}
```

### Example 2: Vague Listing

**Input**:
```
TITLE: "Pokemon Card Rare Vintage"
DESCRIPTION: "Old pokemon card. Good condition."
```

**Expected Output**:
```json
{
  "cardName": "unknown",
  "set": "unknown",
  "cardNumber": "unknown",
  "year": "unknown",
  "language": "unknown",
  "variant": "unknown",
  "isHolo": "unknown",
  "isFirstEdition": "unknown",
  "isShadowless": "unknown",
  "rarity": "Rare",
  "confidence": 0.10,
  "reasoning": "Extremely vague listing with no specific card information. Only 'Rare' and 'Vintage' mentioned, which are not actionable identifiers.",
  "extractedKeywords": ["Pokemon", "Rare", "Vintage"],
  "uncertainties": [
    "No card name specified",
    "No set information",
    "No card number",
    "No edition details",
    "Language not specified",
    "Holo status unclear"
  ]
}
```

---

## 6. Quality Assurance

### Confidence Calibration

Low confidence (< 0.5): Multiple unknowns, vague listing, poor photos
Medium confidence (0.5 - 0.8): Some details clear, adequate photos
High confidence (> 0.8): All details clear, excellent photos

### Hallucination Prevention

1. Always include "unknown" option in schema
2. Require reasoning field to trace logic
3. List uncertainties explicitly
4. Validate responses against schema
5. Flag responses with high confidence but many "unknown" fields (contradiction)

### Human Review Triggers

Auto-flag for human review if:
- Confidence < 0.3
- predictedGradeMax - predictedGradeMin > 2
- High-value card (>$500) with confidence < 0.7
- Authenticity risk level = "High"
- Multiple critical views missing

---

## 7. Testing & Validation

### Golden Test Cases

Maintain a set of golden test listings with known correct outputs to validate:
1. Parser accuracy
2. Grading consistency
3. Response format compliance

### A/B Testing

Compare outputs from:
- Different temperature settings
- Different model versions
- Different prompt phrasings

### Performance Metrics

Track:
- Parse accuracy rate
- Average confidence scores
- Time to completion
- Token usage
- Error rates
- Human override frequency
