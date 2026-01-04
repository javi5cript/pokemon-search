/**
 * Test Suite Orchestrator
 * 
 * Runs all tests in organized categories and generates a summary report
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  duration: number;
  error?: string;
  output?: string;
}

const tests = {
  'API Integration': [
    { name: 'JustTCG API', file: 'test-justtcg.ts', timeout: 30000 },
    { name: 'OpenAI API', file: 'test-openai.js', timeout: 60000 },
  ],
  'Core Services': [
    { name: 'Pricing Service', file: 'test-pricing.ts', timeout: 15000 },
    { name: 'Scoring System', file: 'test-scoring.ts', timeout: 5000 },
    { name: 'Model Configuration', file: 'test-models.ts', timeout: 10000 },
  ],
  'API Endpoints': [
    { name: 'Grading Endpoint', file: 'test-grading-endpoint.ts', timeout: 10000 },
    { name: 'Card Grading', file: 'test-grading.js', timeout: 60000 },
  ],
  'Database': [
    { name: 'Pricing Data Check', file: 'check-pricing.ts', timeout: 5000 },
  ],
};

const results: TestResult[] = [];
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(testName: string, testFile: string, category: string, timeout: number): TestResult {
  const startTime = Date.now();
  const testPath = resolve(__dirname, testFile);
  
  console.log(`\n▶️  Running: ${testName}`);
  console.log(`   File: ${testFile}`);
  
  try {
    const output = execSync(`npx tsx ${testPath}`, {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: timeout,
      stdio: 'pipe',
    });
    
    const duration = Date.now() - startTime;
    console.log(`✅ PASSED (${duration}ms)`);
    
    return {
      name: testName,
      category,
      passed: true,
      duration,
      output: output.slice(0, 500), // First 500 chars of output
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.log(`❌ FAILED (${duration}ms)`);
    if (error.stdout) {
      console.log(`   Output: ${error.stdout.slice(0, 200)}`);
    }
    if (error.stderr) {
      console.log(`   Error: ${error.stderr.slice(0, 200)}`);
    }
    
    return {
      name: testName,
      category,
      passed: false,
      duration,
      error: error.message || 'Test failed',
      output: error.stdout?.slice(0, 500),
    };
  }
}

async function runAllTests() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║        Pokemon Card Deal Finder - Test Suite Runner          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  const startTime = Date.now();
  
  for (const [category, categoryTests] of Object.entries(tests)) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📋 Category: ${category}`);
    console.log('='.repeat(70));
    
    for (const test of categoryTests) {
      totalTests++;
      const result = runTest(test.name, test.file, category, test.timeout);
      results.push(result);
      
      if (result.passed) {
        passedTests++;
      } else {
        failedTests++;
      }
    }
  }
  
  const totalDuration = Date.now() - startTime;
  
  // Generate Summary Report
  console.log('\n\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY REPORT                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  console.log(`Total Tests:    ${totalTests}`);
  console.log(`✅ Passed:       ${passedTests}`);
  console.log(`❌ Failed:       ${failedTests}`);
  console.log(`⏱️  Duration:     ${(totalDuration / 1000).toFixed(2)}s`);
  console.log('');
  
  // Category Breakdown
  console.log('Category Breakdown:');
  console.log('-'.repeat(70));
  for (const [category] of Object.entries(tests)) {
    const categoryResults = results.filter(r => r.category === category);
    const passed = categoryResults.filter(r => r.passed).length;
    const total = categoryResults.length;
    const status = passed === total ? '✅' : '⚠️';
    console.log(`${status} ${category}: ${passed}/${total} passed`);
  }
  console.log('');
  
  // Failed Tests Detail
  if (failedTests > 0) {
    console.log('\n❌ Failed Tests:');
    console.log('-'.repeat(70));
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`\n${r.category} > ${r.name}`);
        console.log(`   Error: ${r.error || 'Unknown error'}`);
        if (r.output) {
          console.log(`   Output Preview: ${r.output.slice(0, 150)}...`);
        }
      });
  }
  
  // Overall Result
  console.log('\n');
  console.log('='.repeat(70));
  if (failedTests === 0) {
    console.log('🎉 ALL TESTS PASSED! 🎉');
  } else {
    console.log(`⚠️  ${failedTests} TEST(S) FAILED`);
  }
  console.log('='.repeat(70));
  console.log('');
  
  // Exit code
  process.exit(failedTests > 0 ? 1 : 0);
}

// Run the test suite
runAllTests().catch(error => {
  console.error('Fatal error running test suite:', error);
  process.exit(1);
});
