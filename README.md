# Pokémon Card Finder

A full-stack application that finds, evaluates, and ranks Pokémon card listings from eBay using AI-powered grading and market pricing data.

## Architecture Overview

This application uses a modern microservices architecture with:

- **Client**: React-based web UI for search and results
- **API Server**: Node.js/Express REST API
- **Orchestrator**: Background job processing with BullMQ
- **Database**: PostgreSQL for persistence
- **Cache**: Redis for pricing and API response caching
- **External APIs**: eBay Browse API, JustTCG API
- **LLM**: OpenAI GPT-4V for image analysis and text parsing

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client Layer                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React UI (Next.js)                                      │   │
│  │  - Search Form                                           │   │
│  │  - Results Dashboard                                     │   │
│  │  - Real-time Updates (SSE)                              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              │
┌─────────────────────────────────────────────────────────────────┐
│                          API Layer                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Express REST API                                        │   │
│  │  - POST /api/search                                      │   │
│  │  - GET  /api/search/:id                                  │   │
│  │  - GET  /api/listing/:id                                 │   │
│  │  - SSE  /api/search/:id/stream                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
┌─────────────────────────────┐ ┌──────────────────────────────┐
│   Orchestration Layer       │ │     Data Layer               │
│  ┌─────────────────────┐    │ │  ┌────────────────────────┐ │
│  │  BullMQ Workers     │    │ │  │  PostgreSQL            │ │
│  │  - eBay Fetcher     │────┼─┼──│  - searches            │ │
│  │  - Card Parser      │    │ │  │  - listings            │ │
│  │  - Image Grader     │    │ │  │  - evaluations         │ │
│  │  - Pricer           │    │ │  │  - pricing_cache       │ │
│  │  - Scorer/Ranker    │    │ │  └────────────────────────┘ │
│  └─────────────────────┘    │ │                              │
│                              │ │  ┌────────────────────────┐ │
│  ┌─────────────────────┐    │ │  │  Redis                 │ │
│  │  Job Queue (Redis)  │    │ │  │  - Job Queue           │ │
│  └─────────────────────┘    │ │  │  - API Cache           │ │
└─────────────────────────────┘ │  │  - Rate Limiting       │ │
                                │  └────────────────────────┘ │
                                └──────────────────────────────┘
                  │                       │
                  └───────────┬───────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                     External Services                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  eBay API    │  │   JustTCG    │  │  OpenAI GPT-4V      │  │
│  │  Browse API  │  │     API      │  │  Vision + Text      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

1. **Intelligent Search**: Flexible eBay search with multiple criteria
2. **AI Grading**: Vision-based condition assessment using GPT-4V
3. **Market Pricing**: Real-time pricing data from JustTCG
4. **Smart Scoring**: Multi-factor deal score combining price, condition, and seller data
5. **Real-time Updates**: Server-sent events for live result updates
6. **Caching**: Aggressive caching for pricing and API responses
7. **Rate Limiting**: Respectful API usage with retries and backoff

## Tech Stack

### Frontend
- Next.js 14 (App Router)
- React 18
- TypeScript
- TailwindCSS
- React Query
- Zustand (state management)

### Backend
- Node.js 20+
- Express
- TypeScript
- BullMQ (job queue)
- Prisma ORM
- PostgreSQL 15+
- Redis 7+
- OpenAI SDK
- Winston (logging)
- Pino (structured logs)

## Project Structure

```
pokemon-card-finder/
├── client/                 # Next.js frontend
│   ├── src/
│   │   ├── app/           # App router pages
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom hooks
│   │   ├── lib/           # Utilities
│   │   ├── services/      # API client
│   │   └── types/         # TypeScript types
│   ├── public/
│   └── package.json
│
├── server/                # Express API + Workers
│   ├── src/
│   │   ├── api/          # Express routes
│   │   ├── workers/      # BullMQ workers
│   │   ├── services/     # Business logic
│   │   │   ├── ebay/     # eBay integration
│   │   │   ├── pricing/  # JustTCG integration
│   │   │   ├── llm/      # OpenAI integration
│   │   │   └── scoring/  # Evaluation logic
│   │   ├── db/           # Database/Prisma
│   │   ├── queue/        # Job queue setup
│   │   ├── utils/        # Utilities
│   │   └── types/        # TypeScript types
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
│
├── shared/               # Shared types/constants
│   └── types/
│
├── docker/               # Docker configs
│   ├── docker-compose.yml
│   └── Dockerfile.*
│
├── docs/                 # Documentation
│   ├── architecture.md
│   ├── api.md
│   └── deployment.md
│
└── README.md
```

## Getting Started

See [docs/deployment.md](docs/deployment.md) for setup instructions.

## License

MIT
