/**
 * Test pricing functionality end-to-end
 */

import { justTCGService } from './src/services/justtcg';

async function testPricing() {
  console.log('🧪 Testing Pricing Lookup\n');
  
  const testCard = {
    name: "Erika's Oddish",
    set: 'Gym Challenge',
    number: '70',
  };
  
  console.log(`Testing: ${testCard.name} - ${testCard.set} #${testCard.number}\n`);
  
  try {
    const result = await justTCGService.lookupPrice(
      testCard.name,
      testCard.set,
      testCard.number,
      'English'
    );
    
    console.log('Result:');
    console.log(`  Found: ${result.found}`);
    console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`  Reasoning: ${result.reasoning}`);
    
    if (result.priceData) {
      console.log('\n💰 Pricing Data:');
      console.log(`  Ungraded: $${result.priceData.loosePrice?.toFixed(2) || 'N/A'}`);
      console.log(`  PSA 7: $${result.priceData.gradedPrices.psa7?.toFixed(2) || 'N/A'}`);
      console.log(`  PSA 8: $${result.priceData.gradedPrices.psa8?.toFixed(2) || 'N/A'}`);
      console.log(`  PSA 9: $${result.priceData.gradedPrices.psa9?.toFixed(2) || 'N/A'}`);
      console.log(`  PSA 10: $${result.priceData.gradedPrices.psa10?.toFixed(2) || 'N/A'}`);
      
      console.log('\n✅ Pricing lookup successful!');
    } else {
      console.log('\n❌ No pricing data returned');
      console.log(`Reason: ${result.reasoning}`);
    }
    
  } catch (error: any) {
    console.error('\n❌ Error during pricing lookup:');
    console.error(error.message);
    console.error(error);
  }
}

testPricing();
