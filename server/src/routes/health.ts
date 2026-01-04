import { Router } from 'express';
import prisma from '../lib/db';
import redis from '../lib/redis';
import { ebayService } from '../services/ebay';
import logger from '../lib/logger';
import { config } from '../config';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`;
    
    // Check Redis
    await redis.ping();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'up',
        redis: 'up',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Test eBay API connection
healthRouter.get('/ebay', async (_req, res) => {
  try {
    logger.info('Testing eBay API connection');
    
    // Log configuration
    logger.info({
      hasAppId: !!config.ebay.appId,
      hasClientId: !!config.ebay.clientId,
      hasCertId: !!config.ebay.certId,
      hasClientSecret: !!config.ebay.clientSecret,
      environment: config.ebay.environment,
    }, 'eBay configuration status');
    
    // Try to search for a simple item
    const results = await ebayService.searchListings({
      keywords: ['pokemon'],
      maxResults: 1,
    });
    
    logger.info({ resultCount: results.length }, 'eBay API test successful');
    
    res.json({
      status: 'connected',
      timestamp: new Date().toISOString(),
      environment: config.ebay.environment,
      testResults: results.length,
      message: 'eBay API is working correctly',
    });
  } catch (error) {
    logger.error({ error }, 'eBay API test failed');
    res.status(503).json({
      status: 'failed',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Show eBay configuration (without secrets)
healthRouter.get('/ebay/config', async (_req, res) => {
  res.json({
    environment: config.ebay.environment,
    hasAppId: !!config.ebay.appId,
    hasClientId: !!config.ebay.clientId,
    hasCertId: !!config.ebay.certId,
    hasClientSecret: !!config.ebay.clientSecret,
    rateLimitPerSecond: config.ebay.rateLimitPerSecond,
  });
});

// Query available models from HiCap endpoint
healthRouter.get('/models', async (_req, res) => {
  try {
    logger.info('Querying available models from HiCap endpoint');
    
    const baseURL = config.openai.baseURL || 'https://api.openai.com/v1';
    
    // Try multiple possible model endpoint paths
    const possibleEndpoints = [
      baseURL.replace('/v2/openai', '/v1/models'),
      baseURL + '/models',
      'https://api.hicap.ai/v1/models',
    ];
    
    let modelsData: any = null;
    let successfulEndpoint: string | null = null;
    
    for (const endpoint of possibleEndpoints) {
      try {
        const response = await fetch(endpoint, {
          headers: {
            'Authorization': `Bearer ${config.openai.apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          modelsData = await response.json();
          successfulEndpoint = endpoint;
          break;
        }
      } catch (err) {
        // Continue to next endpoint
      }
    }
    
    if (!modelsData) {
      // If models endpoint is not available, return configuration info
      logger.warn('Models endpoint not available, returning configuration only');
      return res.json({
        status: 'configuration',
        timestamp: new Date().toISOString(),
        message: 'Models endpoint not available from HiCap. Showing current configuration.',
        currentConfiguration: {
          model: config.openai.model,
          visionModel: config.openai.visionModel,
          baseURL: config.openai.baseURL,
        },
        supportedGPT52Models: [
          'gpt-5.2',
          'gpt-5.2-turbo',
          'gpt-5.2-vision',
        ],
        note: 'HiCap proxy may not expose the /models endpoint. Models are configured in .env file.',
      });
    }
    
    // Process available models
    const gpt5Models = modelsData.data?.filter((model: any) => 
      model.id.includes('gpt-5')
    ) || [];
    
    logger.info({ 
      totalModels: modelsData.data?.length || 0,
      gpt5Count: gpt5Models.length,
      endpoint: successfulEndpoint
    }, 'Models retrieved successfully');
    
    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      endpoint: successfulEndpoint,
      currentModel: config.openai.model,
      currentVisionModel: config.openai.visionModel,
      totalModels: modelsData.data?.length || 0,
      gpt5Models: gpt5Models,
      allModels: modelsData.data || [],
    });
  } catch (error) {
    logger.error({ error }, 'Failed to query models from HiCap endpoint');
    
    // Return graceful fallback
    res.json({
      status: 'fallback',
      timestamp: new Date().toISOString(),
      message: 'Unable to query models endpoint. Current configuration:',
      currentConfiguration: {
        model: config.openai.model,
        visionModel: config.openai.visionModel,
        baseURL: config.openai.baseURL,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
      supportedGPT52Models: [
        'gpt-5.2',
        'gpt-5.2-turbo',
        'gpt-5.2-vision',
      ],
    });
  }
});

// Test OpenAI/HiCap API connection
healthRouter.get('/openai', async (_req, res) => {
  try {
    logger.info('Testing OpenAI/HiCap API connection');
    
    const { llmService } = await import('../services/llm');
    
    // Try a simple parse test
    const testResult = await llmService.parseCard(
      'Charizard VMAX 020/189 Darkness Ablaze Holo Rare',
      'Test listing'
    );
    
    logger.info({ confidence: testResult.confidence }, 'OpenAI API test successful');
    
    res.json({
      status: 'connected',
      timestamp: new Date().toISOString(),
      model: config.openai.model,
      visionModel: config.openai.visionModel,
      baseURL: config.openai.baseURL,
      testResult: {
        cardName: testResult.cardName,
        confidence: testResult.confidence,
      },
      message: 'OpenAI/HiCap API is working correctly',
    });
  } catch (error) {
    logger.error({ error }, 'OpenAI API test failed');
    res.status(503).json({
      status: 'failed',
      timestamp: new Date().toISOString(),
      model: config.openai.model,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined,
    });
  }
});
