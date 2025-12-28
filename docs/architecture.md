# Architecture Documentation

## System Overview

The Pokémon Card Finder is a distributed system designed to discover, evaluate, and rank trading card opportunities from eBay listings.

## Architecture Principles

1. **Separation of Concerns**: Clear boundaries between presentation, business logic, and data layers
2. **Async Processing**: Long-running tasks handled by background workers
3. **Resilience**: Retry logic, circuit breakers, and graceful degradation
4. **Scalability**: Horizontal scaling of workers and API servers
5. **Observability**: Comprehensive logging, metrics, and tracing

## Component Details

### 1. Client (Next.js)

**Responsibilities:**
- Render search form with advanced filtering
- Display real-time results as they're processed
- Show detailed card evaluations
- Handle user interactions

**Key Features:**
- Server-sent events for live updates
- Responsive design for desktop and mobile
- Optimistic UI updates
- Error boundary handling

**Tech Stack:**
- Next.js 14 (App Router)
- React 18 with hooks
- TypeScript for type safety
- TailwindCSS for styling
- React Query for server state
- Zustand for client state

### 2. API Server (Express)

**Responsibilities:**
- Handle HTTP requests from client
- Validate and sanitize inputs
- Queue background jobs
- Stream results via SSE
- Rate limiting and authentication

**Endpoints:**
```
POST   /api/search              - Create new search
GET    /api/search/:id          - Get search status/results
GET    /api/search/:id/stream   - SSE stream for updates
GET    /api/listing/:id         - Get listing details
GET    /api/health              - Health check
```

**Middleware:**
- Body parsing (JSON)
- CORS configuration
- Request logging
- Error handling
- Rate limiting (per IP/user)
- API key validation

### 3. Orchestration Layer (BullMQ Workers)

**Job Flow:**

```
POST /api/search
    ↓
Create Search Record
    ↓
Enqueue: ebay-fetch-job
    ↓
[eBay Fetcher Worker]
    ├→ Fetch paginated results
    ├→ Normalize listing data
    ├→ Store in DB
    └→ For each listing: enqueue parse-job
         ↓
    [Parser Worker]
        ├→ Extract card metadata
        ├→ Canonicalize fields
        ├→ Store parsed data
        └→ Enqueue: grade-job + price-job
             ↓                    ↓
        [Grader Worker]      [Pricing Worker]
            ├→ Analyze images    ├→ Lookup PriceCharting
            ├→ Estimate grade    ├→ Check cache
            └→ Store results     └→ Store prices
                     ↓                    ↓
                     └────────┬───────────┘
                              ↓
                        [Scorer Worker]
                            ├→ Calculate deal score
                            ├→ Apply filters
                            ├→ Rank results
                            └→ Update search status
```

**Workers:**

1. **eBay Fetcher Worker**
   - Fetches listings from eBay API
   - Handles pagination (up to configurable max)
   - Normalizes data into standard schema
   - Rate limiting with exponential backoff

2. **Parser Worker**
   - Extracts structured data from title/description
   - Uses LLM for complex parsing
   - Canonicalizes card identifiers
   - Confidence scoring

3. **Grader Worker**
   - Analyzes images with GPT-4V
   - Estimates PSA grade range
   - Identifies defects
   - Flags missing/poor photos

4. **Pricing Worker**
   - Queries PriceCharting API
   - Handles fuzzy matching
   - Caches aggressively
   - Provides grade-specific pricing

5. **Scorer Worker**
   - Calculates expected value
   - Computes deal score
   - Applies qualification rules
   - Ranks and filters results

### 4. Data Layer

**PostgreSQL Schema:**

```sql
-- Searches table
searches (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255),
  criteria JSONB,
  status VARCHAR(50), -- pending, processing, completed, failed
  total_listings INT,
  processed_listings INT,
  qualified_listings INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  completed_at TIMESTAMP
)

-- Listings table
listings (
  id UUID PRIMARY KEY,
  search_id UUID REFERENCES searches(id),
  ebay_item_id VARCHAR(255) UNIQUE,
  url TEXT,
  title TEXT,
  price DECIMAL(10,2),
  currency VARCHAR(3),
  shipping_cost DECIMAL(10,2),
  seller_username VARCHAR(255),
  seller_feedback_score INT,
  seller_feedback_percent DECIMAL(5,2),
  location VARCHAR(255),
  condition VARCHAR(50),
  end_time TIMESTAMP,
  images JSONB, -- array of image URLs
  item_specifics JSONB,
  raw_payload JSONB,
  created_at TIMESTAMP
)

-- Evaluations table
evaluations (
  id UUID PRIMARY KEY,
  listing_id UUID REFERENCES listings(id),
  
  -- Parsed fields
  card_name VARCHAR(255),
  card_set VARCHAR(255),
  card_number VARCHAR(50),
  year INT,
  language VARCHAR(50),
  is_holo BOOLEAN,
  is_first_edition BOOLEAN,
  is_shadowless BOOLEAN,
  parse_confidence DECIMAL(3,2),
  parse_metadata JSONB,
  
  -- Grading
  predicted_grade_min DECIMAL(3,1),
  predicted_grade_max DECIMAL(3,1),
  grade_confidence DECIMAL(3,2),
  defect_flags JSONB, -- array of defects
  grade_reasoning TEXT,
  
  -- Pricing
  market_price_ungraded DECIMAL(10,2),
  market_price_psa7 DECIMAL(10,2),
  market_price_psa8 DECIMAL(10,2),
  market_price_psa9 DECIMAL(10,2),
  market_price_psa10 DECIMAL(10,2),
  pricing_confidence DECIMAL(3,2),
  pricing_source VARCHAR(100),
  
  -- Scoring
  expected_value DECIMAL(10,2),
  deal_margin DECIMAL(10,2),
  deal_score DECIMAL(5,2),
  qualification_flags JSONB,
  is_qualified BOOLEAN,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Pricing cache table
pricing_cache (
  id UUID PRIMARY KEY,
  canonical_card_id VARCHAR(255) UNIQUE, -- set:number:variant
  card_name VARCHAR(255),
  card_set VARCHAR(255),
  card_number VARCHAR(50),
  price_data JSONB,
  source VARCHAR(100),
  cached_at TIMESTAMP,
  expires_at TIMESTAMP
)

-- Indexes
CREATE INDEX idx_searches_user_created ON searches(user_id, created_at DESC);
CREATE INDEX idx_listings_search ON listings(search_id);
CREATE INDEX idx_listings_ebay_item ON listings(ebay_item_id);
CREATE INDEX idx_evaluations_listing ON evaluations(listing_id);
CREATE INDEX idx_evaluations_qualified_score ON evaluations(is_qualified, deal_score DESC);
CREATE INDEX idx_pricing_cache_canonical ON pricing_cache(canonical_card_id);
CREATE INDEX idx_pricing_cache_expires ON pricing_cache(expires_at);
```

**Redis Usage:**

1. **Job Queue** (BullMQ)
   - Separate queues per worker type
   - Priority-based processing
   - Job retry configuration
   - Dead letter queue

2. **API Response Cache**
   - eBay API responses (5-15 min TTL)
   - PriceCharting responses (24 hour TTL)
   - Key pattern: `cache:ebay:{query_hash}`

3. **Rate Limiting**
   - Token bucket per API
   - Per-IP request limiting
   - Key pattern: `ratelimit:{service}:{identifier}`

### 5. External Service Integration

**eBay Browse API:**
- OAuth 2.0 authentication
- Rate limits: ~5,000 calls/day
- Endpoints: `item_summary/search`
- Retry strategy: exponential backoff
- Circuit breaker: 5 failures → 1 min cooldown

**PriceCharting API:**
- API key authentication
- Rate limits: configurable tier
- Endpoints: `/products`, `/prices`
- Cache TTL: 24 hours
- Fuzzy matching fallback

**OpenAI GPT-4V:**
- API key authentication
- Rate limits: tier-based (TPM, RPM)
- Models: `gpt-4-vision-preview`, `gpt-4-turbo`
- Retry strategy: exponential backoff
- Token budget management

## Data Flow Example

**User searches for "Charizard 1st Edition Base Set PSA":**

1. **Client → API**: POST /api/search
   ```json
   {
     "keywords": "Charizard 1st Edition Base Set",
     "condition": "Used",
     "minPrice": 100,
     "maxPrice": 5000,
     "buyItNow": true,
     "maxResults": 100
   }
   ```

2. **API**: Creates search record, returns search_id
   ```json
   {
     "searchId": "uuid-123",
     "status": "pending"
   }
   ```

3. **Worker: eBay Fetcher**
   - Queries eBay API with pagination
   - Finds 47 matching listings
   - Stores normalized listing data
   - Enqueues 47 parse jobs

4. **Worker: Parser** (parallel, 47 jobs)
   - Listing 1: "Charizard Holo 1st Edition 4/102 Base Set PSA Ready"
   - Extracts: {name: "Charizard", set: "Base Set", number: "4/102", firstEd: true, holo: true}
   - Confidence: 0.95
   - Enqueues grade + price jobs

5. **Worker: Grader** (parallel)
   - Analyzes 3 photos
   - Detects: minor whitening on back, good centering
   - Estimates: PSA 7-8
   - Confidence: 0.75

6. **Worker: Pricing** (parallel)
   - Canonical ID: "baseset:4:holo:1st"
   - Cache hit from previous search
   - Prices: {ungraded: $800, psa7: $1200, psa8: $1800, psa9: $3500}

7. **Worker: Scorer**
   - Listing price: $450 + $15 shipping = $465
   - Expected value: $1200 (conservative PSA 7)
   - Deal margin: $735
   - Deal score: 158% (735/465)
   - Qualified: ✓ (passes all rules)

8. **Client**: Receives SSE update
   ```json
   {
     "searchId": "uuid-123",
     "status": "processing",
     "progress": {
       "total": 47,
       "processed": 23,
       "qualified": 8
     },
     "topResults": [...]
   }
   ```

## Scaling Considerations

**Horizontal Scaling:**
- API servers: stateless, load balanced
- Workers: scale by queue depth
- Database: read replicas for queries
- Redis: cluster mode for high throughput

**Performance Targets:**
- API response time: <200ms (p95)
- Search completion: <2 min for 100 listings
- SSE update latency: <500ms
- Cache hit rate: >80% for pricing

**Resource Limits:**
- Max concurrent eBay requests: 10
- Max concurrent OpenAI requests: 5
- Max listings per search: 500
- Job timeout: 30s per listing

## Security

**Authentication & Authorization:**
- API keys for external services (env vars)
- JWT tokens for user sessions (future)
- Rate limiting per IP/user

**Data Protection:**
- No storage of payment information
- Sanitize user inputs
- Secure Redis with password
- Database connection encryption

**API Security:**
- HTTPS only
- CORS restrictions
- Input validation
- SQL injection prevention (ORM)
- XSS prevention (React auto-escaping)

## Monitoring & Observability

**Metrics:**
- Request rate, latency, error rate
- Queue depth, processing rate
- API quota usage
- Cache hit rates
- Database connection pool

**Logging:**
- Structured JSON logs (Pino)
- Log levels: DEBUG, INFO, WARN, ERROR
- Correlation IDs for tracing
- Log aggregation (future: ELK/Datadog)

**Alerting:**
- API error rate >5%
- Queue backlog >1000 jobs
- External API failures
- Database connection issues

## Disaster Recovery

**Backup Strategy:**
- Database: daily automated backups
- Redis: persistence enabled (AOF)
- Configuration: version controlled

**Failure Scenarios:**

1. **eBay API Down**
   - Queue jobs for retry
   - Show cached results if available
   - Alert user of delays

2. **OpenAI API Down**
   - Graceful degradation: skip grading
   - Use simpler heuristics
   - Mark confidence as low

3. **Database Down**
   - API returns 503
   - Queue jobs in Redis (temporary)
   - Fail fast, retry later

4. **Redis Down**
   - Queue jobs in memory (limited)
   - Skip caching
   - Reduced performance, not failure
