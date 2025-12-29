# GitHub Copilot Instructions for Pokemon Card Deal Finder

## Running the Application

### ✅ ALWAYS Use Helper Scripts

**To start the application:**
```cmd
.\start.bat
```

This will automatically:
- Start the backend server (port 3001)
- Start the frontend client (port 3000)
- Handle all dependencies and environment setup

**To restart the application:**
```cmd
.\restart.bat
```

**To stop all services:**
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

### ❌ DO NOT Run Components Directly

**DO NOT use these commands:**
- ❌ `cd server && npm run dev` (in one terminal)
- ❌ `cd client && npm run dev` (in another terminal)
- ❌ `npm run worker` (worker not needed without Redis)
- ❌ Multiple manual terminal commands

**Why?** The batch files handle:
- Proper working directory setup
- Environment variable loading
- Process management
- Multiple terminal windows
- Graceful shutdown

## Project Structure

```
pokemon_project/
├── start.bat          # START HERE - Launches all services
├── restart.bat        # Restarts all services
├── server/            # Backend API (Express + Prisma)
│   ├── .env          # Configuration (eBay keys, DB, etc)
│   ├── src/
│   │   ├── index.ts       # Main server
│   │   ├── processors.ts  # Job processors (in-memory)
│   │   ├── routes/        # API routes
│   │   └── services/      # eBay, LLM, etc
│   └── prisma/
│       └── schema.prisma  # Database schema
└── client/            # Frontend (Next.js)
    └── src/
```

## Key Configuration Files

### server/.env
Contains:
- eBay API credentials (SANDBOX or PRODUCTION)
- Database URL (SQLite)
- Redis URL (leave empty for in-memory)
- OpenAI API key (for future features)

**Important:** `EBAY_ENVIRONMENT` must be `SANDBOX` or `PRODUCTION` (uppercase)

## Architecture Notes

### Queue Processing
- **Without Redis:** Uses in-memory queue (no separate worker needed)
- **With Redis:** Requires separate worker process (`npm run worker`)
- **Current setup:** In-memory (processors.ts runs in main server)

### Job Flow
1. User submits search via frontend
2. Backend creates search record in DB
3. Job added to in-memory queue
4. Processor fetches from eBay API
5. Results saved to DB
6. Frontend polls for results

## Testing & Validation

### Check eBay API Connection
```powershell
Invoke-WebRequest -Uri "http://localhost:3001/api/health/ebay" -UseBasicParsing | Select-Object -ExpandProperty Content
```

Expected response:
```json
{
  "status": "connected",
  "environment": "SANDBOX",
  "testResults": 13,
  "message": "eBay API is working correctly"
}
```

### Check Configuration
```powershell
Invoke-WebRequest -Uri "http://localhost:3001/api/health/ebay/config" -UseBasicParsing | Select-Object -ExpandProperty Content
```

## Troubleshooting

### Issue: No search results
**Cause:** eBay sandbox has limited test data
**Solution:** 
- Use simple keywords like "pokemon"
- Don't add too many filters in sandbox mode
- For real data, switch to production eBay credentials

### Issue: Port already in use
**Solution:**
```powershell
Get-Process -Name node | Stop-Process -Force
.\start.bat
```

### Issue: Database errors
**Solution:**
```powershell
cd server
npx prisma generate
npx prisma migrate deploy
```

## Development Workflow

### Making Code Changes

1. **Stop services:** Close the command windows or run:
   ```powershell
   Get-Process -Name node | Stop-Process -Force
   ```

2. **Make your changes** to source files

3. **Restart:** 
   ```cmd
   .\restart.bat
   ```

### Database Schema Changes

1. **Edit:** `server/prisma/schema.prisma`
2. **Generate migration:**
   ```powershell
   cd server
   npx prisma migrate dev --name your_migration_name
   ```
3. **Restart app:** `.\start.bat`

### Clean Rebuild

```powershell
cd server
Remove-Item node_modules -Recurse -Force
npm install
npx prisma generate

cd ..\client
Remove-Item node_modules, .next -Recurse -Force
npm install

cd ..
.\start.bat
```

## URLs

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001
- **Health Check:** http://localhost:3001/api/health
- **eBay Test:** http://localhost:3001/api/health/ebay

## Quick Reference

| Action | Command |
|--------|---------|
| Start app | `.\start.bat` |
| Restart app | `.\restart.bat` |
| Stop services | `Get-Process -Name node \| Stop-Process -Force` |
| Test eBay | Browse to http://localhost:3001/api/health/ebay |
| View logs | Check the "Backend Server" command window |
| Clean build | Remove node_modules, run npm install, restart |

---

**Remember:** Always use `start.bat` for launching the application!
