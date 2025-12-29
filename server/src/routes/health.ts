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
