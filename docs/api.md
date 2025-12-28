# API Documentation

## Base URL

```
Development: http://localhost:3001/api
Production: https://api.pokemonfinder.example.com/api
```

## Authentication

Currently, the API is open. Future versions will require API keys or JWT tokens.

```http
Authorization: Bearer <token>
```

## Endpoints

### 1. Create Search

**POST /api/search**

Start a new search for Pokémon card listings on eBay.

**Request Body:**

```typescript
interface SearchRequest {
  // Search criteria
  keywords: string;                    // e.g., "Charizard Base Set"
  category?: string;                   // eBay category ID
  
  // Filters
  condition?: 'new' | 'used' | 'any';
  minPrice?: number;
  maxPrice?: number;
  buyItNow?: boolean;                  // true = Buy It Now only
  auction?: boolean;                   // true = auctions only
  acceptsOffers?: boolean;
  
  // Location/Shipping
  location?: string;                   // e.g., "US", "GB"
  shipsTo?: string;
  freeShipping?: boolean;
  
  // Seller criteria
  minSellerFeedbackScore?: number;     // e.g., 100
  minSellerFeedbackPercent?: number;   // e.g., 98.0
  
  // Card-specific filters
  set?: string;                        // e.g., "Base Set", "Jungle"
  cardNumber?: string;                 // e.g., "4/102"
  firstEdition?: boolean;
  shadowless?: boolean;
  holo?: boolean;
  language?: string;                   // e.g., "English", "Japanese"
  
  // Grading filters
  minExpectedGrade?: number;           // e.g., 7.0
  maxExpectedGrade?: number;           // e.g., 10.0
  
  // Result options
  maxResults?: number;                 // default: 100, max: 500
  sortBy?: 'price' | 'dealScore' | 'endTime' | 'listed';
  sortOrder?: 'asc' | 'desc';
}
```

**Example Request:**

```json
{
  "keywords": "Charizard 1st Edition Base Set",
  "condition": "used",
  "minPrice": 100,
  "maxPrice": 5000,
  "buyItNow": true,
  "location": "US",
  "minSellerFeedbackScore": 500,
  "minSellerFeedbackPercent": 98.0,
  "firstEdition": true,
  "minExpectedGrade": 7.0,
  "maxResults": 100
}
```

**Response: 201 Created**

```typescript
interface SearchResponse {
  searchId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  estimatedCompletionTime?: number;  // seconds
}
```

**Example Response:**

```json
{
  "searchId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "createdAt": "2024-01-15T10:30:00Z",
  "estimatedCompletionTime": 120
}
```

**Error Responses:**

- `400 Bad Request` - Invalid search criteria
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

---

### 2. Get Search Status & Results

**GET /api/search/:searchId**

Get the current status and results of a search.

**Path Parameters:**

- `searchId` (string, required) - The search ID returned from POST /api/search

**Query Parameters:**

```typescript
interface SearchResultsQuery {
  limit?: number;        // default: 50, max: 100
  offset?: number;       // default: 0
  qualifiedOnly?: boolean; // default: true
  minDealScore?: number;   // filter by minimum deal score
}
```

**Response: 200 OK**

```typescript
interface SearchResultsResponse {
  searchId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  criteria: SearchRequest;
  
  progress: {
    totalListings: number;
    processedListings: number;
    qualifiedListings: number;
    percentComplete: number;
  };
  
  results: ListingResult[];
  
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

interface ListingResult {
  listingId: string;
  ebayItemId: string;
  url: string;
  
  // Basic info
  title: string;
  price: number;
  shippingCost: number;
  currency: string;
  totalCost: number;
  
  // Seller info
  seller: {
    username: string;
    feedbackScore: number;
    feedbackPercent: number;
  };
  
  // Listing details
  condition: string;
  endTime: string;
  timeLeft: string;
  listingType: 'auction' | 'fixedPrice';
  location: string;
  
  // Images
  images: string[];
  thumbnailUrl: string;
  
  // Card identification
  card: {
    name: string;
    set: string;
    number: string;
    year?: number;
    language: string;
    isHolo: boolean;
    isFirstEdition: boolean;
    isShadowless: boolean;
    parseConfidence: number;
  };
  
  // Grading assessment
  grading: {
    predictedGradeMin: number;
    predictedGradeMax: number;
    predictedGrade: string;  // e.g., "PSA 7-8"
    confidence: number;
    defects: string[];
    reasoning: string;
  };
  
  // Pricing
  pricing: {
    marketPriceUngraded?: number;
    marketPricePSA7?: number;
    marketPricePSA8?: number;
    marketPricePSA9?: number;
    marketPricePSA10?: number;
    confidence: number;
    source: string;
  };
  
  // Deal analysis
  deal: {
    expectedValue: number;
    dealMargin: number;
    dealScore: number;  // percentage
    isQualified: boolean;
    flags: string[];  // warning flags
  };
}
```

**Example Response:**

```json
{
  "searchId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "criteria": {
    "keywords": "Charizard 1st Edition Base Set",
    "minPrice": 100,
    "maxPrice": 5000
  },
  "progress": {
    "totalListings": 47,
    "processedListings": 47,
    "qualifiedListings": 12,
    "percentComplete": 100
  },
  "results": [
    {
      "listingId": "abc-123",
      "ebayItemId": "123456789012",
      "url": "https://www.ebay.com/itm/123456789012",
      "title": "Charizard Holo 1st Edition 4/102 Base Set PSA Ready",
      "price": 450.00,
      "shippingCost": 15.00,
      "currency": "USD",
      "totalCost": 465.00,
      "seller": {
        "username": "cardcollector99",
        "feedbackScore": 1523,
        "feedbackPercent": 99.8
      },
      "condition": "Used",
      "endTime": "2024-01-20T15:00:00Z",
      "timeLeft": "5d 4h",
      "listingType": "fixedPrice",
      "location": "California, US",
      "images": [
        "https://i.ebayimg.com/images/g/.../s-l1600.jpg"
      ],
      "thumbnailUrl": "https://i.ebayimg.com/images/g/.../s-l225.jpg",
      "card": {
        "name": "Charizard",
        "set": "Base Set",
        "number": "4/102",
        "year": 1999,
        "language": "English",
        "isHolo": true,
        "isFirstEdition": true,
        "isShadowless": false,
        "parseConfidence": 0.95
      },
      "grading": {
        "predictedGradeMin": 7.0,
        "predictedGradeMax": 8.0,
        "predictedGrade": "PSA 7-8",
        "confidence": 0.75,
        "defects": [
          "Minor whitening on back edges",
          "Slight corner wear top-right"
        ],
        "reasoning": "Card shows good centering (55/45). Minor whitening visible on back edges. Slight wear on top-right corner. Surface appears clean with no major scratches. Overall condition suggests PSA 7-8 range."
      },
      "pricing": {
        "marketPriceUngraded": 800.00,
        "marketPricePSA7": 1200.00,
        "marketPricePSA8": 1800.00,
        "marketPricePSA9": 3500.00,
        "marketPricePSA10": 8000.00,
        "confidence": 0.90,
        "source": "PriceCharting"
      },
      "deal": {
        "expectedValue": 1200.00,
        "dealMargin": 735.00,
        "dealScore": 158.06,
        "isQualified": true,
        "flags": []
      }
    }
  ],
  "pagination": {
    "total": 12,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:32:30Z",
  "completedAt": "2024-01-15T10:32:30Z"
}
```

**Error Responses:**

- `404 Not Found` - Search ID not found
- `500 Internal Server Error` - Server error

---

### 3. Stream Search Updates (SSE)

**GET /api/search/:searchId/stream**

Server-sent events stream for real-time search progress updates.

**Path Parameters:**

- `searchId` (string, required) - The search ID

**Response: 200 OK**

Content-Type: `text/event-stream`

**Event Types:**

```typescript
// Progress update
{
  event: 'progress',
  data: {
    totalListings: number,
    processedListings: number,
    qualifiedListings: number,
    percentComplete: number
  }
}

// New qualified listing
{
  event: 'listing',
  data: ListingResult
}

// Search completed
{
  event: 'complete',
  data: {
    totalListings: number,
    qualifiedListings: number,
    completedAt: string
  }
}

// Error occurred
{
  event: 'error',
  data: {
    message: string,
    code: string
  }
}
```

**Example Stream:**

```
event: progress
data: {"totalListings":47,"processedListings":10,"qualifiedListings":3,"percentComplete":21}

event: listing
data: {"listingId":"abc-123","title":"Charizard...","dealScore":158.06}

event: progress
data: {"totalListings":47,"processedListings":47,"qualifiedListings":12,"percentComplete":100}

event: complete
data: {"totalListings":47,"qualifiedListings":12,"completedAt":"2024-01-15T10:32:30Z"}
```

---

### 4. Get Listing Details

**GET /api/listing/:listingId**

Get detailed information about a specific listing, including full evaluation breakdown.

**Path Parameters:**

- `listingId` (string, required) - The listing ID

**Response: 200 OK**

```typescript
interface ListingDetailsResponse extends ListingResult {
  // Additional detailed fields
  rawTitle: string;
  description: string;
  itemSpecifics: Record<string, string>;
  
  // Detailed grading breakdown
  gradingDetails: {
    centering: {
      frontHorizontal: string;  // e.g., "55/45"
      frontVertical: string;
      backHorizontal: string;
      backVertical: string;
      score: number;  // 1-10
    };
    corners: {
      topLeft: string;  // e.g., "Sharp", "Minor wear"
      topRight: string;
      bottomLeft: string;
      bottomRight: string;
      score: number;
    };
    edges: {
      top: string;
      right: string;
      bottom: string;
      left: string;
      score: number;
    };
    surface: {
      front: string;
      back: string;
      score: number;
    };
    overallCondition: string;
  };
  
  // Full qualification analysis
  qualificationAnalysis: {
    hardFilters: {
      name: string;
      passed: boolean;
      reason?: string;
    }[];
    softScores: {
      name: string;
      score: number;
      weight: number;
      contribution: number;
    }[];
    totalScore: number;
  };
  
  // Processing metadata
  processing: {
    parsedAt: string;
    gradedAt: string;
    pricedAt: string;
    scoredAt: string;
  };
}
```

**Example Response:**

```json
{
  "listingId": "abc-123",
  "ebayItemId": "123456789012",
  "url": "https://www.ebay.com/itm/123456789012",
  "title": "Charizard Holo 1st Edition 4/102 Base Set PSA Ready",
  "rawTitle": "CHARIZARD HOLO 1ST EDITION 4/102 BASE SET - PSA READY!!!",
  "description": "Beautiful Charizard card from the original Base Set...",
  "price": 450.00,
  "shippingCost": 15.00,
  "currency": "USD",
  "totalCost": 465.00,
  "itemSpecifics": {
    "Card Number": "4",
    "Set": "Base Set",
    "Character": "Charizard",
    "Rarity": "Holo Rare"
  },
  "gradingDetails": {
    "centering": {
      "frontHorizontal": "55/45",
      "frontVertical": "50/50",
      "backHorizontal": "60/40",
      "backVertical": "52/48",
      "score": 7.5
    },
    "corners": {
      "topLeft": "Sharp",
      "topRight": "Minor wear",
      "bottomLeft": "Sharp",
      "bottomRight": "Sharp",
      "score": 8.0
    },
    "edges": {
      "top": "Clean",
      "right": "Minor whitening",
      "bottom": "Minor whitening",
      "left": "Clean",
      "score": 7.5
    },
    "surface": {
      "front": "Clean, no scratches visible",
      "back": "Minor print line near top",
      "score": 8.0
    },
    "overallCondition": "Good condition with minor flaws typical of PSA 7-8 range"
  },
  "qualificationAnalysis": {
    "hardFilters": [
      {
        "name": "Has photos",
        "passed": true
      },
      {
        "name": "No damage keywords",
        "passed": true
      },
      {
        "name": "Seller feedback threshold",
        "passed": true
      }
    ],
    "softScores": [
      {
        "name": "Photo quality",
        "score": 9,
        "weight": 0.2,
        "contribution": 1.8
      },
      {
        "name": "Seller reputation",
        "score": 10,
        "weight": 0.15,
        "contribution": 1.5
      },
      {
        "name": "Deal margin",
        "score": 10,
        "weight": 0.4,
        "contribution": 4.0
      }
    ],
    "totalScore": 158.06
  },
  "processing": {
    "parsedAt": "2024-01-15T10:31:15Z",
    "gradedAt": "2024-01-15T10:31:45Z",
    "pricedAt": "2024-01-15T10:31:50Z",
    "scoredAt": "2024-01-15T10:32:00Z"
  }
}
```

---

### 5. Health Check

**GET /api/health**

Check API health and service status.

**Response: 200 OK**

```typescript
interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  services: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
    queue: 'up' | 'down';
    ebayApi: 'up' | 'down' | 'degraded';
    pricingApi: 'up' | 'down' | 'degraded';
    llmApi: 'up' | 'down' | 'degraded';
  };
  metrics: {
    activeSearches: number;
    queueDepth: number;
    cacheHitRate: number;
  };
}
```

**Example Response:**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "services": {
    "database": "up",
    "redis": "up",
    "queue": "up",
    "ebayApi": "up",
    "pricingApi": "up",
    "llmApi": "up"
  },
  "metrics": {
    "activeSearches": 5,
    "queueDepth": 47,
    "cacheHitRate": 0.85
  }
}
```

---

## Rate Limiting

The API implements rate limiting per IP address:

- **Anonymous users**: 10 requests per minute
- **Authenticated users**: 100 requests per minute

Rate limit headers are included in all responses:

```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1610712000
```

When rate limit is exceeded:

**Response: 429 Too Many Requests**

```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 45
}
```

---

## Error Handling

All errors follow a consistent format:

```typescript
interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: any;
  timestamp: string;
}
```

**Common Error Codes:**

- `INVALID_REQUEST` - Malformed request
- `VALIDATION_ERROR` - Invalid parameters
- `NOT_FOUND` - Resource not found
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `EXTERNAL_API_ERROR` - Third-party API failure
- `INTERNAL_ERROR` - Server error

**Example Error:**

```json
{
  "error": "Validation Error",
  "message": "Invalid search criteria",
  "code": "VALIDATION_ERROR",
  "details": {
    "maxPrice": "Must be greater than minPrice"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Pagination

All list endpoints support pagination:

**Query Parameters:**

- `limit` - Number of results per page (default: 50, max: 100)
- `offset` - Number of results to skip (default: 0)

**Response includes pagination metadata:**

```json
{
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

---

## CORS

The API supports CORS for browser-based clients:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

---

## Webhook Support (Future)

Future versions will support webhooks for search completion:

**POST /api/webhooks**

Register a webhook URL to receive notifications when searches complete.

```json
{
  "url": "https://your-app.com/webhook",
  "events": ["search.completed", "search.failed"]
}
