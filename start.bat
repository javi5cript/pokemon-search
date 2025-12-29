@echo off
echo Starting Pokemon Card Finder Application...
echo.
echo Starting Backend Server (Port 3001)...
start "Backend Server" cmd /k "cd server && npm run dev"
timeout /t 3 /nobreak >nul
echo.
REM Worker only needed if using Redis
REM Uncomment these lines if you install Redis:
REM echo Starting Worker Process...
REM start "Worker Process" cmd /k "cd server && npm run worker"
REM timeout /t 2 /nobreak >nul
REM echo.
echo Starting Frontend Client (Port 3000)...
start "Frontend Client" cmd /k "cd client && npm run dev"
echo.
echo ========================================
echo All services are starting!
echo.
echo Backend API: http://localhost:3001
echo Jobs: Processing in-memory (no Redis)
echo Frontend UI: http://localhost:3000
echo.
echo Open http://localhost:3000 in your browser
echo ========================================
pause
