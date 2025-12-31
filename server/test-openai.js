/**
 * Test OpenAI Connection
 * Verifies that the OpenAI API key and configuration work correctly
 */

const OpenAI = require('openai').default;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function testOpenAI() {
  console.log('🧪 Testing OpenAI Connection...\n');
  
  // Display configuration
  console.log('Configuration:');
  console.log('  API Key:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : 'MISSING');
  console.log('  Base URL:', process.env.OPENAI_BASE_URL || 'default (https://api.openai.com/v1)');
  console.log('  Model:', process.env.OPENAI_MODEL || 'gpt-4');
  console.log('  Vision Model:', process.env.OPENAI_VISION_MODEL || 'gpt-4o');
  console.log('');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is not set in .env file');
    process.exit(1);
  }

  // Create client
  const clientConfig = {
    apiKey: process.env.OPENAI_API_KEY,
  };

  if (process.env.OPENAI_BASE_URL) {
    clientConfig.baseURL = process.env.OPENAI_BASE_URL;
    
    // HiCap requires the api-key header
    if (process.env.OPENAI_BASE_URL.includes('hicap.ai')) {
      clientConfig.defaultHeaders = {
        'api-key': process.env.OPENAI_API_KEY,
      };
      console.log('  Using HiCap configuration with api-key header');
    }
  }

  const client = new OpenAI(clientConfig);

  // Test 1: Simple text completion
  console.log('Test 1: Text Completion');
  console.log('  Model:', process.env.OPENAI_MODEL);
  console.log('  Prompt: "Say hello"');
  
  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'user', content: 'Say "Hello, I am working!" and nothing else.' }
      ],
      max_tokens: 50,
    });

    console.log('  ✅ Response:', completion.choices[0].message.content);
    console.log('  📊 Usage:', completion.usage);
    console.log('');
  } catch (error) {
    console.error('  ❌ Text completion failed:', error.message);
    if (error.response) {
      console.error('  Response status:', error.response.status);
      console.error('  Response data:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('');
  }

  // Test 2: Vision API with a test image
  console.log('Test 2: Vision API');
  console.log('  Model:', process.env.OPENAI_VISION_MODEL);
  
  // Check for local test image first, fallback to URL
  const testImagePath = path.join(__dirname, 'test-images', 'test-file.jpeg');
  let imageUrl;
  
  if (fs.existsSync(testImagePath)) {
    console.log('  Using local test image: test-images/test-file.jpeg');
    const imageBuffer = fs.readFileSync(testImagePath);
    const base64 = imageBuffer.toString('base64');
    imageUrl = `data:image/jpeg;base64,${base64}`;
    console.log('  Image size:', (imageBuffer.length / 1024).toFixed(2), 'KB');
  } else {
    console.log('  Local test image not found, using remote URL');
    console.log('  (Add test-images/test-file.jpeg to use local image)');
    imageUrl = 'https://i.ebayimg.com/images/g/HiQAAOSwZDxnS7qQ/s-l1600.webp';
  }
  
  try {
    const visionCompletion = await client.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: 'Describe this image in one sentence.' 
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 100,
    });

    console.log('  ✅ Response:', visionCompletion.choices[0].message.content);
    console.log('  📊 Usage:', visionCompletion.usage);
    console.log('');
  } catch (error) {
    console.error('  ❌ Vision API failed:', error.message);
    if (error.response) {
      console.error('  Response status:', error.response.status);
      console.error('  Response data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.code) {
      console.error('  Error code:', error.code);
    }
    console.log('');
  }

  // Test 3: Card grading simulation with detailed criteria
  console.log('Test 3: Card Grading Simulation (Detailed)');
  console.log('  Testing full grading prompt with all PSA criteria');
  console.log('  Using same image from Test 2');
  
  try {
    const gradingTest = await client.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a professional PSA card grader. Analyze cards based on centering, corners, edges, and surface. Return ONLY valid JSON.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this Pokémon card and provide detailed PSA-style grading. Return JSON with this structure:
{
  "predictedGradeMin": <number 1-10>,
  "predictedGradeMax": <number 1-10>,
  "confidence": <number 0-1>,
  "centering": {
    "frontHorizontal": "<ratio like 55/45>",
    "frontVertical": "<ratio like 60/40>",
    "assessment": "<description>"
  },
  "corners": {
    "topLeft": "<condition>",
    "topRight": "<condition>",
    "bottomLeft": "<condition>",
    "bottomRight": "<condition>",
    "assessment": "<overall assessment>"
  },
  "edges": {
    "top": "<condition>",
    "right": "<condition>",
    "bottom": "<condition>",
    "left": "<condition>",
    "assessment": "<overall assessment>"
  },
  "surface": {
    "frontCondition": "<description>",
    "defects": ["<defect1>", "<defect2>"],
    "assessment": "<overall assessment>"
  },
  "overallCondition": "<summary>",
  "gradingReasoning": "<detailed explanation>"
}`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(gradingTest.choices[0].message.content);
    
    console.log('  ✅ Detailed Grading Results:');
    console.log('');
    console.log('  📊 GRADE: PSA', result.predictedGradeMin + '-' + result.predictedGradeMax);
    console.log('  🎯 Confidence:', (result.confidence * 100).toFixed(1) + '%');
    console.log('');
    
    if (result.centering) {
      console.log('  📐 CENTERING:');
      console.log('     Front H:', result.centering.frontHorizontal || 'N/A');
      console.log('     Front V:', result.centering.frontVertical || 'N/A');
      console.log('     Assessment:', result.centering.assessment || 'N/A');
      console.log('');
    }
    
    if (result.corners) {
      console.log('  🔲 CORNERS:');
      console.log('     Top Left:', result.corners.topLeft || 'N/A');
      console.log('     Top Right:', result.corners.topRight || 'N/A');
      console.log('     Bottom Left:', result.corners.bottomLeft || 'N/A');
      console.log('     Bottom Right:', result.corners.bottomRight || 'N/A');
      console.log('     Assessment:', result.corners.assessment || 'N/A');
      console.log('');
    }
    
    if (result.edges) {
      console.log('  📏 EDGES:');
      console.log('     Top:', result.edges.top || 'N/A');
      console.log('     Right:', result.edges.right || 'N/A');
      console.log('     Bottom:', result.edges.bottom || 'N/A');
      console.log('     Left:', result.edges.left || 'N/A');
      console.log('     Assessment:', result.edges.assessment || 'N/A');
      console.log('');
    }
    
    if (result.surface) {
      console.log('  ✨ SURFACE:');
      console.log('     Front:', result.surface.frontCondition || 'N/A');
      if (result.surface.defects && result.surface.defects.length > 0) {
        console.log('     Defects:', result.surface.defects.join(', '));
      }
      console.log('     Assessment:', result.surface.assessment || 'N/A');
      console.log('');
    }
    
    if (result.overallCondition) {
      console.log('  💭 OVERALL:', result.overallCondition);
      console.log('');
    }
    
    if (result.gradingReasoning) {
      console.log('  🤔 REASONING:', result.gradingReasoning);
      console.log('');
    }
    
    console.log('  📊 API Usage:', gradingTest.usage);
    console.log('');
  } catch (error) {
    console.error('  ❌ Grading test failed:', error.message);
    if (error.response) {
      console.error('  Response status:', error.response.status);
      console.error('  Response data:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('');
  }

  console.log('✅ OpenAI connection tests complete!');
  console.log('');
  console.log('If all tests passed, the grading system should work.');
  console.log('If tests failed, check:');
  console.log('  1. API key is valid');
  console.log('  2. Base URL is correct for your provider');
  console.log('  3. Model names are supported by your provider');
  console.log('  4. You have sufficient credits/quota');
}

testOpenAI().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
