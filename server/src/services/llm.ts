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
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  /**
   * Parse card information from listing text
   */
  async parseCard(
    title: string,
    description: string = '',
    itemSpecifics: Record<string, string> = {}
  ): Promise<CardParseResult> {
    logger.info('Parsing card from listing text');

    const userPrompt = this.buildCardParserPrompt(title, description, itemSpecifics);

    try {
      const completion = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: 'system', content: CARD_PARSER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const responseText = completion.choices[0].message.content || '{}';
      const parsed = JSON.parse(responseText);

      logger.info({ confidence: parsed.confidence }, 'Card parsed successfully');

      return this.validateCardParseResult(parsed);

    } catch (error: any) {
      logger.error({ error }, 'Card parsing failed');

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

    logger.info({ imageCount: images.length, cardName }, 'Grading card from images');

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

      const completion = await this.client.chat.completions.create({
        model: config.openai.visionModel,
        messages,
        max_tokens: 2000,
        temperature: 0.1,
      });

      const responseText = completion.choices[0].message.content || '{}';
      
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      logger.info(
        {
          gradeRange: `${parsed.predictedGradeMin}-${parsed.predictedGradeMax}`,
          confidence: parsed.confidence,
        },
        'Card graded successfully'
      );

      return this.validateGradingResult(parsed);

    } catch (error: any) {
      logger.error({ error }, 'Card grading failed');

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
    return `Analyze these Pokémon card images and estimate the PSA grade range.

CARD INFORMATION:
- Name: ${cardName}
- Set: ${set}
- Year: ${year}

NUMBER OF IMAGES: ${imageCount}

Evaluate the card carefully and return a JSON object with all required fields as specified in the system prompt.

Be conservative in your grading and provide specific reasoning for your assessment.`;
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
