/**
 * Test script to query available models from HiCap endpoint
 */

import dotenv from 'dotenv';

dotenv.config();

async function testModelsEndpoint() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  
  console.log('🔍 Testing HiCap Models Endpoint');
  console.log('Base URL:', baseURL);
  console.log('API Key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'NOT SET');
  console.log('');
  
  try {
    // Query the /models endpoint - try multiple paths
    const modelsEndpoints = [
      'https://api.hicap.ai/v1/models',
      'https://api.hicap.ai/v2/models',
      'https://api.hicap.ai/v2/openai/models',
      baseURL.replace('/v2/openai', '/v1/models'),
      baseURL + '/models',
    ];
    
    let successfulEndpoint: string | null = null;
    let data: any = null;
    
    for (const endpoint of modelsEndpoints) {
      console.log(`📡 Trying: ${endpoint}`);
      
      try {
        const response = await fetch(endpoint, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          data = await response.json();
          successfulEndpoint = endpoint;
          console.log(`✅ Success! Status: ${response.status}`);
          break;
        } else {
          console.log(`❌ Failed with status: ${response.status}`);
        }
      } catch (err) {
        console.log(`❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
    if (!successfulEndpoint || !data) {
      throw new Error('All model endpoint attempts failed');
    }
    
    console.log('');
    console.log(`🎯 Successful endpoint: ${successfulEndpoint}`);
    
    console.log('✅ Successfully retrieved models');
    console.log(`Total models: ${data.data?.length || 0}`);
    console.log('');
    
    // Filter for GPT-5 family models
    const gpt5Models = data.data?.filter((model: any) => 
      model.id.includes('gpt-5')
    ) || [];
    
    console.log(`🤖 GPT-5 Family Models (${gpt5Models.length}):`);
    gpt5Models.forEach((model: any) => {
      console.log(`  • ${model.id}`);
      if (model.owned_by) console.log(`    Owned by: ${model.owned_by}`);
    });
    console.log('');
    
    // Filter for GPT-4 family models
    const gpt4Models = data.data?.filter((model: any) => 
      model.id.includes('gpt-4')
    ) || [];
    
    console.log(`🤖 GPT-4 Family Models (${gpt4Models.length}):`);
    gpt4Models.forEach((model: any) => {
      console.log(`  • ${model.id}`);
    });
    console.log('');
    
    // Show current configuration
    console.log('⚙️  Current Configuration:');
    console.log(`  Text Model: ${process.env.OPENAI_MODEL || 'gpt-5.2 (default)'}`);
    console.log(`  Vision Model: ${process.env.OPENAI_VISION_MODEL || 'gpt-5.2 (default)'}`);
    console.log('');
    
    // Check if configured models are available
    const currentModel = process.env.OPENAI_MODEL || 'gpt-5.2';
    const currentVisionModel = process.env.OPENAI_VISION_MODEL || 'gpt-5.2';
    
    const isModelAvailable = data.data?.some((m: any) => m.id === currentModel);
    const isVisionModelAvailable = data.data?.some((m: any) => m.id === currentVisionModel);
    
    console.log('🔍 Model Availability Check:');
    console.log(`  ${currentModel}: ${isModelAvailable ? '✅ Available' : '❌ Not found'}`);
    console.log(`  ${currentVisionModel}: ${isVisionModelAvailable ? '✅ Available' : '❌ Not found'}`);
    
    if (!isModelAvailable || !isVisionModelAvailable) {
      console.log('');
      console.log('⚠️  Warning: Some configured models are not available in the API');
      console.log('');
      console.log('💡 All available models:');
      data.data?.slice(0, 20).forEach((model: any) => {
        console.log(`  • ${model.id}`);
      });
      if (data.data?.length > 20) {
        console.log(`  ... and ${data.data.length - 20} more`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

testModelsEndpoint();
