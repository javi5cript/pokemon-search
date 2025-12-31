# Start Next.js with automatic cache cleanup
Write-Host "Cleaning Next.js cache..." -ForegroundColor Yellow

# Only remove .next directory, don't kill processes
# (server might be running from concurrently)
if (Test-Path .next) {
    Remove-Item .next -Recurse -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Write-Host "Starting Next.js..." -ForegroundColor Green
& npm run dev:raw
