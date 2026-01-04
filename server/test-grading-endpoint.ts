/**
 * Test the grading endpoint to debug pricing issues
 */

import axios from 'axios';

async function testGradingEndpoint() {
  console.log('🧪 Testing Grading Endpoint\n');

  const listingId = '79c5ace3-30b9-41fd-b703-08ef3d8d6b6b'; // Latest from database

  try {
    console.log(`Testing grading for listing: ${listingId}`);
    
    const response = await axios.post(`http://localhost:3001/api/search/grade/${listingId}`);
    
    console.log('\n✅ Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error: any) {
    if (error.response) {
      console.error('\n❌ API Error:', error.response.status, error.response.data);
    } else {
      console.error('\n❌ Error:', error.message);
    }
  }
}

testGradingEndpoint();
