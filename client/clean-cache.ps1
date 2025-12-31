# PowerShell script to clean Next.js cache on Windows
# Kills node processes and removes cache directory

Write-Host "Stopping all Node.js processes..." -ForegroundColor Yellow
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Write-Host "Removing Next.js cache directory..." -ForegroundColor Yellow
if (Test-Path ".next") {
    Remove-Item -Path ".next" -Recurse -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    
    # If directory still exists, try again
    if (Test-Path ".next") {
        Write-Host "Cache directory still locked, retrying..." -ForegroundColor Red
        Start-Sleep -Seconds 2
        Remove-Item -Path ".next" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Cache cleaned successfully!" -ForegroundColor Green
Write-Host "You can now run: npm run dev" -ForegroundColor Cyan
