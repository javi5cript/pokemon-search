/**
 * Test Card Grading with Local or Remote Images
 * 
 * Usage:
 *   node test-grading.js <image-path-or-url>
 * 
 * Examples:
 *   node test-grading.js https://i.ebayimg.com/images/g/HiQAAOSwZDxnS7qQ/s-l1600.webp
 *   node test-grading.js ./test-images/charizard.jpg
 *   node test-grading.js (uses default test image)
 */

const { llmService } = require('./dist/services/llm');
const fs = require('fs');
const path = require('path');

async function testGrading() {
  console.log('🎴 Testing Card Grading System\n');

  // Get image from command line or use default
  const imageArg = process.argv[2];
  let imageUrl;

  if (!imageArg) {
    // Default test image (eBay listing)
    imageUrl = 'https://i.ebayimg.com/images/g/HiQAAOSwZDxnS7qQ/s-l1600.webp';
    console.log('ℹ️  No image specified, using default test image');
  } else if (imageArg.startsWith('http://') || imageArg.startsWith('https://')) {
    // Remote URL
    imageUrl = imageArg;
    console.log('🌐 Using remote image URL');
  } else {
    // Local file - convert to base64 data URL
    const imagePath = path.resolve(imageArg);
    if (!fs.existsSync(imagePath)) {
      console.error(`❌ Image file not found: ${imagePath}`);
      process.exit(1);
    }
    
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    }[ext] || 'image/jpeg';
    
    imageUrl = `data:${mimeType};base64,${base64}`;
    console.log('📁 Using local image file');
    console.log(`   Path: ${imagePath}`);
    console.log(`   Size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
  }

  console.log(`   URL: ${imageUrl.substring(0, 80)}${imageUrl.length > 80 ? '...' : ''}`);
  console.log('');

  // Test card info (you can customize this)
  const cardInfo = {
    name: 'Charizard',
    set: 'Base Set',
    year: '1999'
  };

  console.log('Card Information:');
  console.log(`  Name: ${cardInfo.name}`);
  console.log(`  Set: ${cardInfo.set}`);
  console.log(`  Year: ${cardInfo.year}`);
  console.log('');

  console.log('🔍 Calling OpenAI Vision API for grading...');
  console.log('⏳ This may take 10-30 seconds...\n');

  try {
    const startTime = Date.now();
    
    const result = await llmService.gradeCard(
      [imageUrl],
      cardInfo.name,
      cardInfo.set,
      cardInfo.year
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('✅ Grading Complete!\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('                     GRADING RESULTS                        ');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`📊 Predicted Grade: PSA ${result.predictedGradeMin}-${result.predictedGradeMax}`);
    console.log(`🎯 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`⏱️  Processing Time: ${duration}s\n`);

    console.log('📐 CENTERING:');
    console.log(`   Front H: ${result.centering.frontHorizontal}`);
    console.log(`   Front V: ${result.centering.frontVertical}`);
    console.log(`   Back H: ${result.centering.backHorizontal}`);
    console.log(`   Back V: ${result.centering.backVertical}`);
    console.log(`   Assessment: ${result.centering.assessment}`);
    console.log(`   Impact: ${result.centering.impactOnGrade}\n`);

    console.log('🔲 CORNERS:');
    console.log(`   Top Left: ${result.corners.topLeft}`);
    console.log(`   Top Right: ${result.corners.topRight}`);
    console.log(`   Bottom Left: ${result.corners.bottomLeft}`);
    console.log(`   Bottom Right: ${result.corners.bottomRight}`);
    console.log(`   Assessment: ${result.corners.assessment}`);
    console.log(`   Impact: ${result.corners.impactOnGrade}\n`);

    console.log('📏 EDGES:');
    console.log(`   Top: ${result.edges.top}`);
    console.log(`   Right: ${result.edges.right}`);
    console.log(`   Bottom: ${result.edges.bottom}`);
    console.log(`   Left: ${result.edges.left}`);
    console.log(`   Assessment: ${result.edges.assessment}`);
    console.log(`   Impact: ${result.edges.impactOnGrade}\n`);

    console.log('✨ SURFACE:');
    console.log(`   Front: ${result.surface.frontCondition}`);
    console.log(`   Back: ${result.surface.backCondition}`);
    console.log(`   Defects: ${result.surface.defects.length > 0 ? result.surface.defects.join(', ') : 'None detected'}`);
    console.log(`   Assessment: ${result.surface.assessment}`);
    console.log(`   Impact: ${result.surface.impactOnGrade}\n`);

    if (result.defectFlags.length > 0) {
      console.log('⚠️  DEFECT FLAGS:');
      result.defectFlags.forEach(flag => console.log(`   - ${flag}`));
      console.log('');
    }

    console.log('📸 IMAGE QUALITY:');
    console.log(`   Adequate for Grading: ${result.imageQuality.adequateForGrading ? 'Yes' : 'No'}`);
    if (result.imageQuality.missingViews.length > 0) {
      console.log(`   Missing Views: ${result.imageQuality.missingViews.join(', ')}`);
    }
    if (result.imageQuality.photoQualityIssues.length > 0) {
      console.log(`   Quality Issues: ${result.imageQuality.photoQualityIssues.join(', ')}`);
    }
    console.log('');

    console.log('💭 OVERALL CONDITION:');
    console.log(`   ${result.overallCondition}\n`);

    console.log('🤔 GRADING REASONING:');
    console.log(`   ${result.gradingReasoning}\n`);

    if (result.recommendations.length > 0) {
      console.log('💡 RECOMMENDATIONS:');
      result.recommendations.forEach(rec => console.log(`   - ${rec}`));
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════\n');

    // Save detailed results to JSON
    const outputFile = 'test-grading-result.json';
    fs.writeFileSync(outputFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      cardInfo,
      imageUrl: imageUrl.length > 200 ? imageUrl.substring(0, 200) + '...[truncated]' : imageUrl,
      processingTime: duration,
      result
    }, null, 2));

    console.log(`📄 Detailed results saved to: ${outputFile}`);
    console.log('');
    console.log('✅ Grading test completed successfully!');

  } catch (error) {
    console.error('❌ Grading test failed!\n');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Check if running as a built script
if (!fs.existsSync(path.join(__dirname, 'dist', 'services', 'llm.js'))) {
  console.error('❌ Server code not built yet!');
  console.error('');
  console.error('Please run:');
  console.error('  npm run build');
  console.error('');
  console.error('Then try again.');
  process.exit(1);
}

testGrading().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
