/**
 * Test script for JustTCG API integration
 * Run with: npx tsx server/test-justtcg.ts
 */

import { justTCGService } from './src/services/justtcg';
import logger from './src/lib/logger';

async function testJustTCG() {
  console.log('🧪 Testing JustTCG API Integration\n');
  console.log('='.repeat(60));

  // Test cases - real Pokemon cards
  const testCards = [
    {
      name: 'Dachsbun ex',
      set: 'Surging Sparks',
      number: '160',
      description: 'Full Art card from recent set'
    },
    {
      name: 'Pikachu',
      set: 'Base Set',
      number: '58',
      description: 'Classic Base Set Pikachu'
    },
    {
      name: 'Charizard',
      set: 'Base Set',
      number: '4',
      description: 'Iconic Charizard'
    },
    {
      name: 'Mew ex',
      set: 'Obsidian Flames',
      number: '151',
      description: 'Special illustration rare'
    }
  ];

  for (const testCard of testCards) {
    console.log(`\n📋 Testing: ${testCard.name} (${testCard.set} #${testCard.number})`);
    console.log(`   ${testCard.description}`);
    console.log('-'.repeat(60));

    try {
      // Test the main lookup method
      const result = await justTCGService.lookupPrice(
        testCard.name,
        testCard.set,
        testCard.number,
        'English'
      );

      console.log(`\n✅ Search Result:`);
      console.log(`   Found: ${result.found}`);
      console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`   Reasoning: ${result.reasoning}`);

      if (result.priceData) {
        console.log(`\n💰 Price Data:`);
        console.log(`   Card ID: ${result.priceData.cardId}`);
        console.log(`   Card Name: ${result.priceData.cardName}`);
        console.log(`   Set: ${result.priceData.setName}`);
        console.log(`   Currency: ${result.priceData.currency}`);
        console.log(`\n📊 Prices:`);
        console.log(`   Ungraded (Loose): $${result.priceData.loosePrice?.toFixed(2) || 'N/A'}`);
        console.log(`   Market Price: $${result.priceData.marketPrice?.toFixed(2) || 'N/A'}`);
        console.log(`\n🏆 Graded Prices (PSA):`);
        console.log(`   PSA 7:  $${result.priceData.gradedPrices.psa7?.toFixed(2) || 'N/A'}`);
        console.log(`   PSA 8:  $${result.priceData.gradedPrices.psa8?.toFixed(2) || 'N/A'}`);
        console.log(`   PSA 9:  $${result.priceData.gradedPrices.psa9?.toFixed(2) || 'N/A'}`);
        console.log(`   PSA 10: $${result.priceData.gradedPrices.psa10?.toFixed(2) || 'N/A'}`);
        
        console.log(`\n📦 Available Variants (${result.priceData.allVariants.length}):`);
        result.priceData.allVariants.forEach((variant, idx) => {
          console.log(`   ${idx + 1}. ${variant.condition} | ${variant.printing} | $${variant.price.toFixed(2)}`);
        });
      }

      // Test the simplified getCardPrices method (used by processors)
      console.log(`\n🔧 Testing getCardPrices method:`);
      const prices = await justTCGService.getCardPrices(
        testCard.name,
        testCard.set,
        testCard.number
      );

      if (prices) {
        console.log(`   ✅ Prices retrieved successfully`);
        console.log(`   Ungraded: $${prices.ungraded?.toFixed(2) || 'N/A'}`);
        console.log(`   PSA 7:  $${prices.psa7?.toFixed(2) || 'N/A'}`);
        console.log(`   PSA 8:  $${prices.psa8?.toFixed(2) || 'N/A'}`);
        console.log(`   PSA 9:  $${prices.psa9?.toFixed(2) || 'N/A'}`);
        console.log(`   PSA 10: $${prices.psa10?.toFixed(2) || 'N/A'}`);
        console.log(`   Confidence: ${(prices.confidence * 100).toFixed(1)}%`);
        console.log(`   Source: ${prices.source}`);
      } else {
        console.log(`   ❌ No prices found`);
      }

    } catch (error: any) {
      console.error(`\n❌ Error testing ${testCard.name}:`);
      console.error(`   ${error.message}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, error.response.data);
      }
    }

    console.log('\n' + '='.repeat(60));
  }

  console.log('\n✨ Testing complete!\n');
  process.exit(0);
}

// Run the tests
testJustTCG().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
