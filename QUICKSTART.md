# 🚀 Quick Start Guide - Pokémon Card Finder

## ✅ Server is Running!

Your standalone Pokémon Card Finder server is now running on **http://localhost:3001**

### 🎯 Available Endpoints

#### 1. Health Check
```bash
curl http://localhost:3001/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-27T...",
  "services": {
    "database": "up",
    "redis": "up"
  }
}
```

#### 2. Create a Search
```bash
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": "Charizard Base Set",
    "listingType": "buyItNow",
    "minPrice": 10,
    "maxPrice": 500
  }'
```

Expected response:
```json
{
  "searchId": "abc-123-def",
  "status": "PENDING",
  "createdAt": "2025-12-27T..."
}
```

#### 3. Get Search Results
```bash
curl http://localhost:3001/api/search/{searchId}
```

Replace `{searchId}` with the ID from step 2.

#### 4. Get Listing Details
```bash
curl http://localhost:3001/api/search/{searchId}/listing/{listingId}
```

---

## 📊 Current Setup

✅ **Database**: SQLite (`server/prisma/dev.db`)
✅ **Cache**: In-memory (no Redis needed)
✅ **Queue**: In-memory (no Redis needed)
✅ **Server**: Express on port 3001
✅ **TypeScript**: Fully typed with strict mode

---

## 🔧 Configuration

The app is configured via environment variables in `server/.env`:

```bash
# Database (SQLite - local file)
DATABASE_URL=file:./dev.db

# Redis (optional - using in-memory)
REDIS_URL=

# API Keys (needed for full functionality)
EBAY_APP_ID=your_ebay_app_id_here
EBAY_CLIENT_ID=your_ebay_client_id_here
EBAY_CLIENT_SECRET=your_ebay_client_secret_here
JUSTTCG_API_KEY=your_justtcg_key_here
OPENAI_API_KEY=your_openai_key_here
```

---

## 📝 What Works Now

✅ **Server**: Running and accepting requests
✅ **Database**: SQLite with all tables created
✅ **API Endpoints**: Health check and search endpoints
✅ **Logging**: Structured logs with Pino
✅ **Job Queue**: In-memory queue system
✅ **Configuration**: Environment-based config with validation

---

## ⚠️ What Needs API Keys

To actually search eBay, get pricing data, and use AI evaluation, you need:

1. **eBay API**: Sign up at https://developer.ebay.com/
2. **JustTCG API**: Sign up at https://justtcg.com/ (free tier available)
3. **OpenAI API**: Sign up at https://platform.openai.com/

Once you have the keys, update them in `server/.env`

---

## 🎮 Next Steps

### Phase 2: Implement External Integrations
- [ ] eBay API client for searching listings
- [ ] PriceCharting API client for market prices
- [ ] OpenAI integration for card parsing and grading

### Phase 3: Core Business Logic
- [ ] Orchestration pipeline
- [ ] Scoring and qualification system
- [ ] Background job processors

### Phase 4: Build the UI
- [ ] Initialize Next.js client
- [ ] Create search form
- [ ] Create results dashboard
- [ ] Real-time updates

---

## 🛠️ Development Commands

```bash
# Start server (already running)
cd server && npm run dev

# View database
cd server && npx prisma studio

# Run migrations
cd server && npx prisma db push

# Format code
cd server && npm run format

# Type check
cd server && npm run type-check
```

---

## 📁 Project Structure

```
pokemon_project/
├── server/
│   ├── prisma/
│   │   ├── dev.db (SQLite database)
│   │   └── schema.prisma
│   ├── src/
│   │   ├── index.ts (Express server)
│   │   ├── config/ (Configuration)
│   │   ├── lib/ (Utilities)
│   │   ├── routes/ (API endpoints)
│   │   └── queues/ (Job system)
│   ├── .env (Your configuration)
│   └── package.json
├── docs/ (Complete documentation)
└── README.md
```

---

## 🎉 Success!

You now have a working standalone Pokémon Card Finder application running locally without any external infrastructure dependencies!

The server is using:
- **SQLite** for persistence (no PostgreSQL needed)
- **In-memory cache** (no Redis needed)
- **In-memory job queue** (no Redis needed)

Everything runs in a single process with a local database file!
