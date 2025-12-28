@echo off
echo Restarting Pokemon Card Finder Application...
echo.
echo Cleaning Next.js cache...
cd client
if exist .next rmdir /s /q .next
cd ..
echo.
echo Starting Backend Server (Port 3001)...
start "Backend Server" cmd /k "cd server && npm run dev"
timeout /t 3 /nobreak >nul
echo.
echo Starting Frontend Client (Port 3000)...
start "Frontend Client" cmd /k "cd client && npm run dev"
echo.
echo ========================================
echo Both servers are starting with fresh cache!
echo.
echo Backend API: http://localhost:3001
echo Frontend UI: http://localhost:3000
echo.
echo Open http://localhost:3000 in your browser
echo ========================================
pause
