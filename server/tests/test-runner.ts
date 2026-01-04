#!/usr/bin/env node
/**
 * Quick Test Runner
 * 
 * Usage:
 *   npm test                    # Run all tests
 *   npm test justtcg            # Run specific test
 *   npm test -- --quick         # Run quick tests only (< 10s)
 */

import { execSync } from 'child_process';

const args = process.argv.slice(2);
const testName = args[0];
const isQuick = args.includes('--quick');

const quickTests = [
  'test-scoring.ts',
  'test-pricing.ts',
  'check-pricing.ts',
];

const allTests = [
  'test-justtcg.ts',
  'test-scoring.ts',
  'test-pricing.ts',
  'test-models.ts',
  'check-pricing.ts',
  'test-grading-endpoint.ts',
  'test-openai.js',
  'test-grading.js',
];

function runSingleTest(filename: string) {
  console.log(`\n🧪 Running: ${filename}\n`);
  try {
    execSync(`npx tsx tests/${filename}`, {
      cwd: __dirname + '/..',
      stdio: 'inherit',
    });
    console.log(`\n✅ ${filename} PASSED\n`);
  } catch (error) {
    console.log(`\n❌ ${filename} FAILED\n`);
    process.exit(1);
  }
}

if (testName) {
  // Run specific test
  const matchingTest = allTests.find(t => t.includes(testName));
  if (matchingTest) {
    runSingleTest(matchingTest);
  } else {
    console.error(`❌ Test not found: ${testName}`);
    console.log('\nAvailable tests:');
    allTests.forEach(t => console.log(`  - ${t}`));
    process.exit(1);
  }
} else if (isQuick) {
  // Run quick tests only
  console.log('⚡ Running quick tests only...\n');
  quickTests.forEach(runSingleTest);
} else {
  // Run full test suite
  console.log('🧪 Running full test suite...\n');
  try {
    execSync('npx tsx tests/run-all-tests.ts', {
      cwd: __dirname + '/..',
      stdio: 'inherit',
    });
  } catch (error) {
    process.exit(1);
  }
}
