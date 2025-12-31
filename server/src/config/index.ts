import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  // Server
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3001),
  
  // Database
  databaseUrl: z.string().min(1),
  
  // Redis (optional for standalone mode)
  redisUrl: z.string().optional(),
  
  // eBay API
  ebay: z.object({
    appId: z.string().min(1),
    certId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    environment: z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
    rateLimitPerSecond: z.coerce.number().default(5),
  }),
  
  // JustTCG API
  justTCG: z.object({
    apiKey: z.string().min(1),
    rateLimitPerMinute: z.coerce.number().default(60),
  }),
  
  // OpenAI API
  openai: z.object({
    apiKey: z.string().min(1),
    organization: z.string().optional(),
    model: z.string().default('gpt-4-turbo'),
    visionModel: z.string().default('gpt-4-vision-preview'),
    rateLimitPerMinute: z.coerce.number().default(60),
  }),
  
  // Application
  app: z.object({
    maxListingsPerSearch: z.coerce.number().default(500),
    workerConcurrency: z.coerce.number().default(5),
    maxJobAttempts: z.coerce.number().default(3),
    enableTelemetry: z.coerce.boolean().default(false),
    pricingCacheTtlHours: z.coerce.number().default(24),
  }),
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  try {
    return configSchema.parse({
      nodeEnv: process.env.NODE_ENV,
      port: process.env.PORT,
      databaseUrl: process.env.DATABASE_URL,
      redisUrl: process.env.REDIS_URL,
      ebay: {
        appId: process.env.EBAY_APP_ID,
        certId: process.env.EBAY_CERT_ID,
        clientId: process.env.EBAY_CLIENT_ID,
        clientSecret: process.env.EBAY_CLIENT_SECRET,
        environment: process.env.EBAY_ENVIRONMENT,
        rateLimitPerSecond: process.env.EBAY_RATE_LIMIT_PER_SECOND,
      },
      justTCG: {
        apiKey: process.env.JUSTTCG_API_KEY,
        rateLimitPerMinute: process.env.JUSTTCG_RATE_LIMIT_PER_MINUTE,
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.OPENAI_ORGANIZATION,
        model: process.env.OPENAI_MODEL,
        visionModel: process.env.OPENAI_VISION_MODEL,
        rateLimitPerMinute: process.env.OPENAI_RATE_LIMIT_PER_MINUTE,
      },
      app: {
        maxListingsPerSearch: process.env.MAX_LISTINGS_PER_SEARCH,
        workerConcurrency: process.env.WORKER_CONCURRENCY,
        maxJobAttempts: process.env.MAX_JOB_ATTEMPTS,
        enableTelemetry: process.env.ENABLE_TELEMETRY,
        pricingCacheTtlHours: process.env.PRICING_CACHE_TTL_HOURS,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Configuration validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

export const config = loadConfig();

export default config;
