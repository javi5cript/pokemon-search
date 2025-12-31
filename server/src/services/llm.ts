/**
 * LLM Service for Card Parsing and Grading
 * 
 * Uses OpenAI GPT-4 and GPT-4V for:
 * - Card parsing from text
 * - Condition grading from images
 */

import OpenAI from 'openai';
import { config } from '../config';
import logger from '../lib/logger';

// ============================================================================
// Type Definitions
// ============================================================================

export interface CardParseResult {
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
  confidence: number;
  reasoning: string;
  extractedKeywords: string[];
  uncertainties: string[];
}

export interface GradingResult {
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

// ============================================================================
// Prompt Templates
// ============================================================================

const CARD_PARSER_SYSTEM_PROMPT = `You are a Pokémon Trading Card Game expert specializing in card identification and cataloging. Your task is to extract structured information from eBay listing titles and descriptions.

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
- Include promotional text in structured fields`;

const IMAGE_GRADER_SYSTEM_PROMPT = `You are a professional trading card grader with expertise in PSA (Professional Sports Authenticator) grading standards for Pokémon cards. Your task is to analyze card images and estimate the likely PSA grade range.

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
- Provide grades outside the observed range`;

// ============================================================================
// LLM Service Class
// ============================================================================

export class LLMService {
  private client: OpenAI;

  constructor() {
    const clientConfig: any = {
      apiKey: config.openai.apiKey,
    };

    // Use custom baseURL if provided
    if (config.openai.baseURL) {
      clientConfig.baseURL = config.openai.baseURL;
      logger.info({ baseURL: config.openai.baseURL }, 'Using custom OpenAI base URL');
    }

    if (config.openai.organization) {
      clientConfig.organization = config.openai.organization;
    }

    this.client = new OpenAI(clientConfig);
    
    logger.info({
      model: config.openai.model,
      visionModel: config.openai.visionModel,
      hasBaseURL: !!config.openai.baseURL,
    }, 'LLM Service initialized');
  }

  /**
   * Parse card information from listing text
   */
  async parseCard(
    title: string,
    description: string = '',
    itemSpecifics: Record<string, string> = {}
  ): Promise<CardParseResult> {
    logger.info({ title, hasDescription: !!description }, 'Starting card parsing - calling OpenAI API');

    const userPrompt = this.buildCardParserPrompt(title, description, itemSpecifics);

    try {
      logger.info({ model: config.openai.model }, 'Making OpenAI API call for card parsing');
      
      const completion = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: 'system', content: CARD_PARSER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      logger.info({ 
        usage: completion.usage,
        finishReason: completion.choices[0].finish_reason 
      }, 'OpenAI API call completed for card parsing');

      const responseText = completion.choices[0].message.content || '{}';
      const parsed = JSON.parse(responseText);

      logger.info({ 
        confidence: parsed.confidence,
        cardName: parsed.cardName 
      }, 'Card parsed successfully');

      return this.validateCardParseResult(parsed);

    } catch (error: any) {
      logger.error({ 
        error: error.message,
        code: error.code,
        status: error.status,
        type: error.type
      }, 'Card parsing failed');

      // Return unknown result on error
      return {
        cardName: 'unknown',
        set: 'unknown',
        cardNumber: 'unknown',
        year: 'unknown',
        language: 'unknown',
        variant: 'unknown',
        isHolo: 'unknown',
        isFirstEdition: 'unknown',
        isShadowless: 'unknown',
        rarity: 'unknown',
        confidence: 0,
        reasoning: `Parsing error: ${error.message}`,
        extractedKeywords: [],
        uncertainties: ['LLM parsing failed'],
      };
    }
  }

  /**
   * Grade card condition from images
   */
  async gradeCard(
    images: string[],
    cardName: string = 'unknown',
    set: string = 'unknown',
    year: number | string = 'unknown'
  ): Promise<GradingResult> {
    if (images.length === 0) {
      logger.warn('No images provided for grading');
      return this.getNoImagesGradingResult();
    }

    logger.info({ 
      imageCount: images.length, 
      cardName,
      imageUrls: images 
    }, 'Starting card grading - calling OpenAI Vision API');

    const userPrompt = this.buildImageGraderPrompt(images.length, cardName, set, year);

    try {
      // Build messages with images
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: IMAGE_GRADER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            ...images.map(url => ({
              type: 'image_url' as const,
              image_url: { url, detail: 'high' as const },
            })),
          ],
        },
      ];

      logger.info({ 
        model: config.openai.visionModel,
        maxTokens: 3000,
        imageCount: images.length 
      }, 'Making OpenAI Vision API call for card grading');

      const completion = await this.client.chat.completions.create({
        model: config.openai.visionModel,
        messages,
        max_tokens: 3000,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      logger.info({ 
        usage: completion.usage,
        finishReason: completion.choices[0].finish_reason 
      }, 'OpenAI Vision API call completed for card grading');

      const responseText = completion.choices[0].message.content || '{}';
      const parsed = JSON.parse(responseText);

      logger.info(
        {
          gradeRange: `${parsed.predictedGradeMin}-${parsed.predictedGradeMax}`,
          confidence: parsed.confidence,
          hasDefects: parsed.defectFlags?.length > 0
        },
        'Card graded successfully'
      );

      return this.validateGradingResult(parsed);

    } catch (error: any) {
      logger.error({ 
        error: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
        cardName,
        imageCount: images.length
      }, 'Card grading failed');

      // Return low-confidence result on error
      return {
        predictedGradeMin: 5,
        predictedGradeMax: 7,
        confidence: 0.1,
        centering: {
          frontHorizontal: 'unknown',
          frontVertical: 'unknown',
          backHorizontal: 'unknown',
          backVertical: 'unknown',
          assessment: 'Could not assess',
          impactOnGrade: 'unknown',
        },
        corners: {
          topLeft: 'unknown',
          topRight: 'unknown',
          bottomLeft: 'unknown',
          bottomRight: 'unknown',
          assessment: 'Could not assess',
          impactOnGrade: 'unknown',
        },
        edges: {
          top: 'unknown',
          right: 'unknown',
          bottom: 'unknown',
          left: 'unknown',
          assessment: 'Could not assess',
          impactOnGrade: 'unknown',
        },
        surface: {
          frontCondition: 'unknown',
          backCondition: 'unknown',
          defects: [],
          assessment: 'Could not assess',
          impactOnGrade: 'unknown',
        },
        overallCondition: `Grading error: ${error.message}`,
        defectFlags: ['grading_failed'],
        gradingReasoning: 'LLM grading failed',
        imageQuality: {
          adequateForGrading: false,
          missingViews: [],
          photoQualityIssues: ['Grading process failed'],
        },
        recommendations: ['Unable to grade card'],
      };
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private buildCardParserPrompt(
    title: string,
    description: string,
    itemSpecifics: Record<string, string>
  ): string {
    const specificsStr = Object.entries(itemSpecifics)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    return `Extract structured card information from this eBay listing.

TITLE: ${title}

DESCRIPTION: ${description || '(No description provided)'}

ITEM SPECIFICS:
${specificsStr || '(None provided)'}

Return a JSON object with these exact fields:
- cardName: string | "unknown"
- set: string | "unknown"
- cardNumber: string | "unknown"
- year: number | "unknown"
- language: string | "unknown"
- variant: string | "unknown"
- isHolo: boolean | "unknown"
- isFirstEdition: boolean | "unknown"
- isShadowless: boolean | "unknown"
- rarity: string | "unknown"
- confidence: number (0.0 to 1.0)
- reasoning: string
- extractedKeywords: string[]
- uncertainties: string[]`;
  }

  private buildImageGraderPrompt(
    imageCount: number,
    cardName: string,
    set: string,
    year: number | string
  ): string {
    return `You are analyzing ${imageCount} image(s) of a Pokémon trading card for PSA-style grading.

CARD DETAILS:
- Name: ${cardName}
- Set: ${set}
- Year: ${year}

GRADING INSTRUCTIONS:
Examine each image carefully and assess the following in order of importance:

1. CENTERING (Most Critical)
   - Measure front horizontal centering (left border vs right border)
   - Measure front vertical centering (top border vs bottom border)
   - If back is visible, measure back centering as well
   - Express as ratios (e.g., "55/45", "60/40", "70/30")
   - Perfect is 50/50, PSA 10 allows up to 55/45, PSA 9 allows 60/40

2. CORNERS (Very Critical)
   - Inspect all four corners for:
     * Sharpness vs rounding
     * White wear/whitening on corners
     * Denting or bending
   - Rate each corner: "Sharp", "Very Slight Wear", "Slight Wear", "Moderate Wear", "Heavy Wear"
   - Even one rounded corner drops the grade significantly

3. EDGES (Critical)
   - Examine all four edges for:
     * Edge whitening (white showing along the edge)
     * Chipping or fraying
     * Wear patterns
   - Rate each edge: "Clean", "Very Minor Whitening", "Minor Whitening", "Moderate Whitening", "Heavy Wear"

4. SURFACE (Critical)
   - Look for on the front surface:
     * Scratches (light, moderate, heavy)
     * Print lines or printing defects
     * Dents or indentations
     * Stains or discoloration
     * Holo scratching (if holofoil card)
   - If back is visible, check back surface similarly
   - List all specific defects observed

5. IMAGE QUALITY ASSESSMENT
   - Note if images are high-resolution enough to grade accurately
   - List any missing critical angles (back, close-up corners, edges)
   - Note photo quality issues (blur, lighting, angle)

RESPONSE FORMAT:
Return ONLY a valid JSON object with this exact structure:
{
  "predictedGradeMin": <number 1-10>,
  "predictedGradeMax": <number 1-10>,
  "confidence": <number 0.0-1.0>,
  "centering": {
    "frontHorizontal": "<ratio like 55/45>",
    "frontVertical": "<ratio like 60/40>",
    "backHorizontal": "<ratio or 'unknown'>",
    "backVertical": "<ratio or 'unknown'>",
    "assessment": "<detailed description>",
    "impactOnGrade": "<how this affects final grade>"
  },
  "corners": {
    "topLeft": "<condition description>",
    "topRight": "<condition description>",
    "bottomLeft": "<condition description>",
    "bottomRight": "<condition description>",
    "assessment": "<overall corner assessment>",
    "impactOnGrade": "<how this affects final grade>"
  },
  "edges": {
    "top": "<condition description>",
    "right": "<condition description>",
    "bottom": "<condition description>",
    "left": "<condition description>",
    "assessment": "<overall edge assessment>",
    "impactOnGrade": "<how this affects final grade>"
  },
  "surface": {
    "frontCondition": "<detailed condition>",
    "backCondition": "<detailed condition or 'unknown'>",
    "defects": ["<specific defect 1>", "<specific defect 2>"],
    "assessment": "<overall surface assessment>",
    "impactOnGrade": "<how this affects final grade>"
  },
  "overallCondition": "<summary of card condition>",
  "defectFlags": ["<critical defect 1>", "<critical defect 2>"],
  "gradingReasoning": "<detailed explanation of why you assigned this grade range>",
  "imageQuality": {
    "adequateForGrading": <true/false>,
    "missingViews": ["<missing angle 1>"],
    "photoQualityIssues": ["<issue 1>"]
  },
  "recommendations": ["<recommendation 1>", "<recommendation 2>"]
}

GRADING GUIDELINES:
- PSA 10: Near perfect centering (55/45), sharp corners, clean edges, pristine surface
- PSA 9: Centering 60/40, one minor corner/edge flaw allowed
- PSA 8: Centering 65/35, minor corner wear, light edge whitening acceptable
- PSA 7: Centering 70/30, slight corner rounding, visible edge wear
- PSA 6: Centering 75/25, corner whitening, edge whitening visible
- PSA 5 and below: Multiple defects, creases, heavy wear

Be CONSERVATIVE. When uncertain between two grades, choose the lower one.`;
  }

  private validateCardParseResult(parsed: any): CardParseResult {
    return {
      cardName: parsed.cardName || 'unknown',
      set: parsed.set || 'unknown',
      cardNumber: parsed.cardNumber || 'unknown',
      year: parsed.year || 'unknown',
      language: parsed.language || 'unknown',
      variant: parsed.variant || 'unknown',
      isHolo: parsed.isHolo ?? 'unknown',
      isFirstEdition: parsed.isFirstEdition ?? 'unknown',
      isShadowless: parsed.isShadowless ?? 'unknown',
      rarity: parsed.rarity || 'unknown',
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
      reasoning: parsed.reasoning || 'No reasoning provided',
      extractedKeywords: parsed.extractedKeywords || [],
      uncertainties: parsed.uncertainties || [],
    };
  }

  private validateGradingResult(parsed: any): GradingResult {
    return {
      predictedGradeMin: parsed.predictedGradeMin || 5,
      predictedGradeMax: parsed.predictedGradeMax || 7,
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
      centering: parsed.centering || this.getDefaultCentering(),
      corners: parsed.corners || this.getDefaultCorners(),
      edges: parsed.edges || this.getDefaultEdges(),
      surface: parsed.surface || this.getDefaultSurface(),
      overallCondition: parsed.overallCondition || 'Could not assess',
      defectFlags: parsed.defectFlags || [],
      gradingReasoning: parsed.gradingReasoning || 'No reasoning provided',
      imageQuality: parsed.imageQuality || this.getDefaultImageQuality(),
      recommendations: parsed.recommendations || [],
    };
  }

  private getNoImagesGradingResult(): GradingResult {
    return {
      predictedGradeMin: 1,
      predictedGradeMax: 10,
      confidence: 0,
      centering: this.getDefaultCentering(),
      corners: this.getDefaultCorners(),
      edges: this.getDefaultEdges(),
      surface: this.getDefaultSurface(),
      overallCondition: 'No images provided - cannot assess condition',
      defectFlags: ['no_images'],
      gradingReasoning: 'Grading requires images',
      imageQuality: {
        adequateForGrading: false,
        missingViews: ['All views missing'],
        photoQualityIssues: ['No photos provided'],
      },
      recommendations: ['Add photos of the card to enable grading'],
    };
  }

  private getDefaultCentering() {
    return {
      frontHorizontal: 'unknown',
      frontVertical: 'unknown',
      backHorizontal: 'unknown',
      backVertical: 'unknown',
      assessment: 'unknown',
      impactOnGrade: 'unknown',
    };
  }

  private getDefaultCorners() {
    return {
      topLeft: 'unknown',
      topRight: 'unknown',
      bottomLeft: 'unknown',
      bottomRight: 'unknown',
      assessment: 'unknown',
      impactOnGrade: 'unknown',
    };
  }

  private getDefaultEdges() {
    return {
      top: 'unknown',
      right: 'unknown',
      bottom: 'unknown',
      left: 'unknown',
      assessment: 'unknown',
      impactOnGrade: 'unknown',
    };
  }

  private getDefaultSurface() {
    return {
      frontCondition: 'unknown',
      backCondition: 'unknown',
      defects: [],
      assessment: 'unknown',
      impactOnGrade: 'unknown',
    };
  }

  private getDefaultImageQuality() {
    return {
      adequateForGrading: false,
      missingViews: [],
      photoQualityIssues: [],
    };
  }
}

// Singleton instance
export const llmService = new LLMService();
