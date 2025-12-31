# Test Images Directory

This directory is for storing test card images to validate the grading system.

## How to Add Test Images

1. **Download card images** from eBay, TCGPlayer, or take your own photos
2. **Save them here** in `server/test-images/`
3. **Supported formats:** JPG, PNG, WEBP, GIF
4. **Recommended:** Use clear, high-resolution images

## Example Test Images to Add

Good test images should show:
- ✅ Full card visible
- ✅ Good lighting
- ✅ Sharp focus
- ✅ Multiple angles (front/back if possible)
- ✅ Close-ups of corners and edges

## File Naming Convention (Optional but Helpful)

Examples:
- `charizard-base-set-psa9.jpg` - Known PSA 9 card
- `pikachu-damaged.jpg` - Heavily played card
- `mewtwo-mint.png` - Near-mint condition
- `blastoise-front.jpg` - Front view
- `blastoise-back.jpg` - Back view

## Usage

Once you've added images here, test them with:

```bash
# Test with your local image
npm run test-grading ./test-images/charizard.jpg

# Or just the filename
npm run test-grading test-images/your-card.png
```

## Sample Images

You can download sample Pokémon card images from:
- **eBay listings** - Find high-quality listing photos
- **PSA website** - Look for graded examples
- **TCGPlayer** - Product images
- **Reddit r/pkmntcg** - Community posts with card photos

## .gitignore

Images in this directory are ignored by git (see `.gitignore`), so you can add your own test images without committing them to the repository.

If you want to commit specific test images for the project, remove them from `.gitignore` or add them to a `samples/` subdirectory.

---

**Quick Start:**
1. Drop a card image file here
2. Run: `npm run test-grading test-images/your-image.jpg`
3. Get detailed PSA-style grading results!
