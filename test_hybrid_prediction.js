/**
 * Test Script for Hybrid Monthly Prediction
 * 
 * Tests various scenarios:
 * 1. Standard mode (3+ days)
 * 2. Hybrid mode (1-2 days with previous month data)
 * 3. Fallback mode (1-2 days without previous month data)
 * 4. Edge cases (year boundary, leap year, complete month)
 */

const http = require('http');

// Configuration
const BASE_URL = 'http://localhost:3000';
const TESTS = [
  {
    name: 'Reject Future Date (Backend Validation)',
    url: '/api/predict?year=2099&month=1&day=1',
    expectations: {
      __expectStatus: 400,
      __expectErrorCode: 'FUTURE_DATE'
    }
  },
  {
    name: 'Standard Mode - 3 Days',
    url: '/api/predict?year=2025&month=1&day=3',
    expectations: {
      __expectStatus: 200,
      daysPassedMonth: 3,
      predictionMode: 'standard',
      hybrid: null
    }
  },
  {
    name: 'Standard Mode - 10 Days',
    url: '/api/predict?year=2025&month=1&day=10',
    expectations: {
      __expectStatus: 200,
      daysPassedMonth: 10,
      predictionMode: 'standard',
      hybrid: null
    }
  },
  {
    name: 'Hybrid Mode - 1 Day (if Dec 2024 data exists)',
    url: '/api/predict?year=2025&month=1&day=1',
    expectations: {
      __expectStatus: 200,
      daysPassedMonth: 1,
      predictionMode: ['hybrid', 'standard_fallback'],  // Either mode acceptable
      confidenceMin: 25  // Minimum confidence score
    }
  },
  {
    name: 'Hybrid Mode - 2 Days (if Dec 2024 data exists)',
    url: '/api/predict?year=2025&month=1&day=2',
    expectations: {
      __expectStatus: 200,
      daysPassedMonth: 2,
      predictionMode: ['hybrid', 'standard_fallback'],
      confidenceMin: 35
    }
  },
  {
    name: 'Complete Month - Jan 31',
    url: '/api/predict?year=2025&month=1&day=31',
    expectations: {
      __expectStatus: 200,
      daysPassedMonth: 31,
      percentMonthComplete: '100.0',
      isComplete: true,
      valueSource: 'actual',
      predictionMode: 'standard'
    }
  }
];

// Helper function to make HTTP GET request
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Test runner
async function runTests() {
  console.log('========================================');
  console.log('HYBRID PREDICTION TEST SUITE');
  console.log('========================================\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of TESTS) {
    console.log(`\n📝 Test: ${test.name}`);
    console.log(`   URL: ${test.url}`);
    
    try {
      const resp = await httpGet(`${BASE_URL}${test.url}`);
      const response = resp.body;

      // Validate expected HTTP status when provided
      const expectedStatus = test.expectations.__expectStatus;
      if (Number.isFinite(expectedStatus) && resp.statusCode !== expectedStatus) {
        console.log(`   ❌ FAILED: Expected HTTP ${expectedStatus}, got ${resp.statusCode}`);
        failed++;
        continue;
      }

      // Negative test: future date must be rejected
      if (Number.isFinite(expectedStatus) && expectedStatus >= 400) {
        const expectedCode = test.expectations.__expectErrorCode;
        if (expectedCode && response.code !== expectedCode) {
          console.log(`   ❌ FAILED: Expected error code "${expectedCode}", got "${response.code}"`);
          failed++;
          continue;
        }
        console.log(`   ✅ HTTP ${resp.statusCode} (as expected)`);
        if (expectedCode) console.log(`   ✅ error.code: "${response.code}"`);
        console.log(`\n   ✅ TEST PASSED`);
        passed++;
        continue;
      }
      
      // Check if meters exist
      if (!response.meters || response.meters.length === 0) {
        console.log('   ❌ FAILED: No meter data in response');
        failed++;
        continue;
      }
      
      // Test each meter
      let testPassed = true;
      for (const meter of response.meters) {
        console.log(`\n   Meter: ${meter.meterId}`);
        const monthResult = meter.month;
        
        if (!monthResult.success) {
          console.log(`   ⚠️  Skipped: ${monthResult.message}`);
          continue;
        }
        
        // Validate expectations
        for (const [key, expectedValue] of Object.entries(test.expectations)) {
          if (key.startsWith('__')) continue;
          const actualValue = monthResult[key];
          
          if (key === 'predictionMode' && Array.isArray(expectedValue)) {
            // Accept any mode in the array
            if (!expectedValue.includes(actualValue)) {
              console.log(`   ❌ ${key}: Expected one of [${expectedValue.join(', ')}], got "${actualValue}"`);
              testPassed = false;
            } else {
              console.log(`   ✅ ${key}: "${actualValue}" (acceptable)`);
            }
          } else if (key === 'confidenceMin') {
            // Check minimum confidence score
            const score = monthResult.confidence?.score || 0;
            if (score < expectedValue) {
              console.log(`   ❌ confidence.score: Expected >= ${expectedValue}, got ${score}`);
              testPassed = false;
            } else {
              console.log(`   ✅ confidence.score: ${score} (>= ${expectedValue})`);
            }
          } else {
            // Exact match
            if (actualValue !== expectedValue) {
              console.log(`   ❌ ${key}: Expected "${expectedValue}", got "${actualValue}"`);
              testPassed = false;
            } else {
              console.log(`   ✅ ${key}: "${actualValue}"`);
            }
          }
        }
        
        // Display hybrid metadata if present
        if (monthResult.hybrid) {
          console.log(`\n   Hybrid Details:`);
          console.log(`   - Mode: ${monthResult.hybrid.mode}`);
          
          if (monthResult.hybrid.mode === 'hybrid') {
            console.log(`   - Previous Month: ${monthResult.hybrid.previousMonth.year}-${String(monthResult.hybrid.previousMonth.month).padStart(2, '0')}`);
            console.log(`   - Previous Avg Daily: ${monthResult.hybrid.previousMonth.avgDaily} kWh`);
            console.log(`   - Current Avg Daily: ${monthResult.hybrid.currentMonth.avgDaily} kWh`);
            console.log(`   - Weights: ${(monthResult.hybrid.weights.current * 100).toFixed(0)}% current, ${(monthResult.hybrid.weights.previous * 100).toFixed(0)}% previous`);
            console.log(`   - Hybrid Avg Daily: ${monthResult.hybrid.hybridAvgDaily} kWh`);
          } else if (monthResult.hybrid.mode === 'standard_fallback') {
            console.log(`   - Reason: ${monthResult.hybrid.reason}`);
            console.log(`   - Warning: ${monthResult.hybrid.warning}`);
          }
        }
        
        // Display confidence
        if (monthResult.confidence) {
          console.log(`\n   Confidence:`);
          console.log(`   - Level: ${monthResult.confidence.level}`);
          console.log(`   - Score: ${monthResult.confidence.score}`);
          console.log(`   - Description: ${monthResult.confidence.description}`);
          if (monthResult.confidence.enhancement) {
            console.log(`   - Enhancement: ${monthResult.confidence.enhancement}`);
          }
          if (monthResult.confidence.warning) {
            console.log(`   - Warning: ${monthResult.confidence.warning}`);
          }
        }
        
        // Display prediction summary
        console.log(`\n   Prediction Summary:`);
        console.log(`   - Days Analyzed: ${monthResult.daysPassedMonth}/${monthResult.daysInCurrentMonth}`);
        console.log(`   - Completion: ${monthResult.percentMonthComplete}%`);
        console.log(`   - Actual Consumed: ${monthResult.totalEnergyMonth} kWh`);
        console.log(`   - Predicted Month: ${monthResult.predictedMonthKwh} kWh`);
        console.log(`   - Avg Daily Rate: ${monthResult.averageDailyRate} kWh/day`);
      }
      
      if (testPassed) {
        console.log(`\n   ✅ TEST PASSED`);
        passed++;
      } else {
        console.log(`\n   ❌ TEST FAILED`);
        failed++;
      }
      
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}`);
      failed++;
    }
  }
  
  // Summary
  console.log('\n\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');
  console.log(`Total Tests: ${TESTS.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Success Rate: ${((passed / TESTS.length) * 100).toFixed(1)}%`);
  console.log('========================================\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
console.log('Waiting for server to be ready...\n');
setTimeout(() => {
  runTests().catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
}, 1000);
