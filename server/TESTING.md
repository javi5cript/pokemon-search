# Testing Guide - Card Grading System

This guide explains how to test the card grading functionality.

## Prerequisites

1. **Server must be built:**
   ```bash
   npm run build
   ```

2. **Environment configured** (`.env` file with HiCap API key)

3. **Server running** (for end-to-end testing):
   ```bash
   npm run dev
   ```

---

## Test 1: OpenAI Connection Test

Verifies that the HiCap API is configured correctly and working.

```bash
node test-openai.js
```

**Expected Output:**
```
✅ Test 1: Text Completion - PASSED
✅ Test 2: Vision API - PASSED
✅ Test 3: Card Grading Simulation - PASSED
```

**What it tests:**
- API authentication
- Text completion
- Vision API with images
- JSON response format

---

## Test 2: Standalone Grading Test

Tests the complete grading system with real card images.

### Using Remote URLs (easiest)

```bash
node test-grading.js https://i.ebayimg.com/images/g/HiQAAOSwZDxnS7qQ/s-l1600.webp
```

### Using Local Images

**Step 1:** Add test images to `test-images/` directory

Download or add card images:
- Save to `server/test-images/`
- Formats: JPG, PNG, WEBP, GIF
- Recommended: High-resolution, clear images

**Step 2:** Run the test

```bash
node test-grading.js test-images/charizard.jpg
```

### Using Default Test Image

```bash
node test-grading.js
```

**Expected Output:**
```
═══════════════════════════════════════════════════════════
                     GRADING RESULTS                        
═══════════════════════════════════════════════════════════

📊 Predicted Grade: PSA 7-9
🎯 Confidence: 75.0%
⏱️  Processing Time: 12.34s

📐 CENTERING:
   Front H: 60/40
   Front V: 55/45
   ...

✅ Grading test completed successfully!
📄 Detailed results saved to: test-grading-result.json
```

---

## Test 3: End-to-End Integration Test

Tests the complete workflow through the web application.

**Prerequisites:** Server must be running (`npm run dev`)

### Step 1: Start a Search

1. Open http://localhost:3000
2. Search for "Charizard" or any card
3. Wait for results to load

### Step 2: Test Manual Grading

1. Find a listing with images
2. Click "Grade This Card" button
3. Wait 10-30 seconds for grading
4. Verify:
   - ✅ Loading spinner appears
   - ✅ Grade displays (e.g., "PSA 8-9")
   - ✅ Only THAT listing shows a grade
   - ✅ Other listings still show "Grade This Card" button

### Step 3: Verify in HiCap Dashboard

1. Go to https://hicap.ai/dashboard
2. Check API usage
3. Should see:
   - Recent API calls
   - Token usage
   - Vision API calls (high token count)

---

## Test 4: Database Verification

Verify that grades are stored correctly per-listing.

```bash
# Enter the server directory
cd server

# Open SQLite database
sqlite3 prisma/dev.db

# Check evaluations
SELECT 
  l.id as listing_id,
  l.title,
  e.predictedGradeMin,
  e.predictedGradeMax,
  e.gradeConfidence
FROM listings l
LEFT JOIN evaluations e ON e.listing_id = l.id
LIMIT 10;

# Exit SQLite
.quit
```

**Verify:**
- Each listing has at most ONE evaluation
- Grades are stored correctly
- Confidence scores are between 0-1

---

## Troubleshooting

### Error: "Server code not built yet!"

**Solution:**
```bash
npm run build
```

### Error: "401 Unauthorized"

**Causes:**
1. Invalid API key
2. Wrong base URL
3. Missing `api-key` header

**Solution:**
Check `.env` file:
```bash
OPENAI_API_KEY=your-key-here
OPENAI_BASE_URL=https://api.hicap.ai/v2/openai
OPENAI_VISION_MODEL=gpt-4o
```

### Error: "No images available for grading"

**Causes:**
1. Listing has no images
2. Images failed to download

**Solution:**
- Try a different listing with images
- Verify image URLs are accessible

### Grading Takes Too Long

**Normal:** 10-30 seconds for vision API
**If longer:** Check HiCap dashboard for rate limits

### Grade Appears on Multiple Listings

**Cause:** Background worker auto-grading is enabled

**Solution:** Already disabled in `processors.ts`
- If still happening, restart server
- Verify auto-grading is commented out

---

## Performance Benchmarks

**Expected Performance:**

| Operation | Time | Tokens |
|-----------|------|--------|
| Text parsing | 1-3s | ~50-100 |
| Image grading | 10-30s | ~300-800 |
| Full evaluation | 15-40s | ~400-1000 |

**Cost Estimate (HiCap):**
- Parsing: ~$0.001 per listing
- Grading: ~$0.005-0.01 per listing
- Total: ~$0.01 per graded listing

---

## Test Image Recommendations

**Good Test Cases:**

1. **Mint Condition Card**
   - Sharp corners
   - Perfect centering
   - No surface defects
   - Expected: PSA 9-10

2. **Near Mint Card**
   - Minor corner wear
   - Good centering
   - Few surface scratches
   - Expected: PSA 7-9

3. **Played Card**
   - Rounded corners
   - Off-center
   - Visible wear
   - Expected: PSA 4-6

4. **Damaged Card**
   - Creases
   - Heavy wear
   - Multiple defects
   - Expected: PSA 1-3

**Image Quality:**
- ✅ High resolution (1000px+)
- ✅ Good lighting
- ✅ Sharp focus
- ✅ Full card visible
- ✅ Multiple angles if available

---

## Automated Testing (Future)

For CI/CD integration, you can create automated tests:

```javascript
// tests/grading.test.js
const { llmService } = require('../dist/services/llm');

describe('Card Grading', () => {
  it('should grade a card image', async () => {
    const result = await llmService.gradeCard(
      ['https://example.com/card.jpg'],
      'Charizard',
      'Base Set',
      '1999'
    );
    
    expect(result.predictedGradeMin).toBeGreaterThan(0);
    expect(result.predictedGradeMax).toBeLessThanOrEqual(10);
    expect(result.confidence).toBeGreaterThan(0);
  });
});
```

---

## Getting Help

**Check logs:**
```bash
# Server logs show detailed grading process
npm run dev

# Look for:
# - "Starting card grading"
# - "OpenAI Vision API call"
# - "Card graded successfully"
```

**Common Issues:**
1. API key not configured → Check `.env`
2. Server not built → Run `npm run build`
3. No images → Choose listing with images
4. Slow grading → Normal for vision API

**Still stuck?**
1. Check `GRADING_SYSTEM_AUDIT.md` for architecture details
2. Run `node test-openai.js` to verify API connection
3. Check HiCap dashboard for quota/errors

---

## Quick Reference

```bash
# Test API connection
node test-openai.js

# Test grading with remote URL
node test-grading.js https://example.com/card.jpg

# Test grading with local image
node test-grading.js test-images/charizard.jpg

# Build server
npm run build

# Run server
npm run dev

# Clear all cached grades
node clear-evaluations.js
```

---

**Happy Testing! 🎴**
