# Hybrid Monthly Prediction - Quick Start Guide

## Overview

The hybrid monthly prediction enhancement improves forecast accuracy when less than 3 days of current month data is available by intelligently combining current month run-rate with previous month consumption patterns.

## Key Features

✅ **Adaptive Weighting**: Progressively increases current month influence as more data becomes available  
✅ **Automatic Fallback**: Gracefully handles missing previous month data  
✅ **Enhanced Confidence**: Provides transparency about prediction reliability  
✅ **Edge Case Handling**: Year boundaries, leap years, partial data  
✅ **Per-Meter Processing**: Each meter gets independent hybrid calculation  

## How It Works

### Decision Logic

```
Current Month Days < 3  →  HYBRID MODE
    ├─ Previous month data available  →  Weighted combination
    └─ Previous month data missing     →  Standard fallback

Current Month Days ≥ 3  →  STANDARD MODE
    └─ Use current month run-rate only
```

### Weighting Strategy

| Days | Current Weight | Previous Weight | Formula |
|------|----------------|-----------------|---------|
| 1    | 25%            | 75%             | `(current × 0.25) + (previous × 0.75)` |
| 2    | 40%            | 60%             | `(current × 0.40) + (previous × 0.60)` |
| 3+   | 100%           | 0%              | `current × 1.00` (standard) |

## Quick Start

### 1. Verify Server is Running

```powershell
# Start the server
node server.js

# Expected output:
# ✓ Using ULTRA-FAST forecast module (aggregated data)
# Server running at http://localhost:3000
```

### 2. Test Hybrid Prediction

```powershell
# Run automated test suite
node test_hybrid_prediction.js
```

### 3. API Usage Examples

#### Request: 1 Day of Data (Hybrid Mode)

```bash
GET http://localhost:3000/api/predict?year=2025&month=1&day=1
```

**Response:**
```json
{
  "totalRecords": 96,
  "meters": [
    {
      "meterId": "KSR-1",
      "month": {
        "success": true,
        "year": 2025,
        "month": 1,
        "daysPassedMonth": 1,
        "daysInCurrentMonth": 31,
        "totalEnergyMonth": 85.0,
        "predictedMonthKwh": 4146.25,
        "averageDailyRate": 133.75,
        "percentMonthComplete": "3.2",
        "isComplete": false,
        "valueSource": "projection",
        "targetDay": 1,
        
        "predictionMode": "hybrid",
        "hybrid": {
          "mode": "hybrid",
          "previousMonth": {
            "year": 2024,
            "month": 12,
            "daysUsed": 31,
            "totalDays": 31,
            "totalEnergy": 4650.0,
            "avgDaily": 150.0
          },
          "currentMonth": {
            "daysUsed": 1,
            "totalEnergy": 85.0,
            "avgDaily": 85.0
          },
          "weights": {
            "current": 0.25,
            "previous": 0.75
          },
          "hybridAvgDaily": 133.75,
          "improvement": "Using previous month data (2024-12) to stabilize prediction"
        },
        
        "confidence": {
          "level": "low_hybrid",
          "score": 45,
          "description": "1 day + previous month hybrid - stabilized prediction",
          "enhancement": "Confidence boosted by previous month data"
        }
      }
    }
  ]
}
```

#### Request: 3 Days of Data (Standard Mode)

```bash
GET http://localhost:3000/api/predict?year=2025&month=1&day=3
```

**Response:**
```json
{
  "meters": [
    {
      "meterId": "KSR-1",
      "month": {
        "daysPassedMonth": 3,
        "predictedMonthKwh": 4603.4,
        "predictionMode": "standard",
        "hybrid": null,
        "confidence": {
          "level": "low",
          "score": 35
        }
      }
    }
  ]
}
```

## Configuration

Edit [server.js](server.js) to adjust hybrid behavior:

```javascript
// Line ~30: Hybrid threshold (days)
const HYBRID_THRESHOLD = 3;  // Use hybrid when < 3 days

// Line ~260: Weight mapping
function calculateCurrentMonthWeight(daysAnalyzed) {
  const weights = {
    1: 0.25,  // Adjust 1-day weight (0.0 to 1.0)
    2: 0.40,  // Adjust 2-day weight (0.0 to 1.0)
  };
  return weights[daysAnalyzed] || 0.25;
}

// Line ~310: Previous month completeness threshold
if (dataCompleteness < 50) {  // Require 50% of previous month
  return null;
}
```

## Testing

### Automated Test Suite

```powershell
node test_hybrid_prediction.js
```

Tests include:
- ✅ Standard mode (3+ days)
- ✅ Hybrid mode (1-2 days with previous data)
- ✅ Fallback mode (1-2 days without previous data)
- ✅ Complete month detection
- ✅ Multi-meter processing

### Manual Testing

```powershell
# Test 1 day (should trigger hybrid)
curl http://localhost:3000/api/predict?year=2025&month=1&day=1

# Test 2 days (should trigger hybrid)
curl http://localhost:3000/api/predict?year=2025&month=1&day=2

# Test 3 days (should use standard)
curl http://localhost:3000/api/predict?year=2025&month=1&day=3

# Test complete month
curl http://localhost:3000/api/predict?year=2025&month=1&day=31
```

## Understanding the Response

### Prediction Mode Field

```json
"predictionMode": "hybrid" | "standard" | "standard_fallback"
```

- **`hybrid`**: Using weighted combination of current + previous month
- **`standard`**: Using current month run-rate only (3+ days)
- **`standard_fallback`**: Attempted hybrid but previous month data unavailable

### Hybrid Metadata

Present only when `predictionMode === "hybrid"`:

```json
"hybrid": {
  "mode": "hybrid",
  "previousMonth": {
    "year": 2024,
    "month": 12,
    "daysUsed": 31,          // Days of previous month data
    "avgDaily": 150.0        // Previous month average kWh/day
  },
  "currentMonth": {
    "daysUsed": 1,           // Days of current month data
    "avgDaily": 85.0         // Current month average kWh/day
  },
  "weights": {
    "current": 0.25,         // 25% weight to current month
    "previous": 0.75         // 75% weight to previous month
  },
  "hybridAvgDaily": 133.75,  // Final weighted average
  "improvement": "Using previous month data..."
}
```

### Confidence Levels

Enhanced confidence scoring with hybrid awareness:

| Level | Score | Description |
|-------|-------|-------------|
| `exact` | 100 | Complete month - actual value |
| `very_high` | 90 | 80-99% complete |
| `high` | 80 | 50-79% complete |
| `medium` | 65 | 25-49% complete |
| `medium_hybrid` | 55 | 2 days + previous month (hybrid boost) |
| `low_hybrid` | 45 | 1 day + previous month (hybrid boost) |
| `low` | 35 | 2 days, no previous data |
| `very_low` | 25 | 1 day, no previous data |

## Edge Cases

### Year Boundary (January → December)

```javascript
// Automatically handles Jan 2025 → Dec 2024
GET /api/predict?year=2025&month=1&day=1

// Backend fetches December 2024 data transparently
```

### Leap Year February

```javascript
// Automatically adjusts for leap years
GET /api/predict?year=2024&month=2&day=1  // Feb has 29 days
GET /api/predict?year=2025&month=2&day=1  // Feb has 28 days
```

### No Previous Month Data

```json
{
  "predictionMode": "standard_fallback",
  "hybrid": {
    "mode": "standard_fallback",
    "reason": "Previous month data not available",
    "warning": "Prediction based on limited current month data only"
  },
  "confidence": {
    "level": "very_low",
    "score": 25,
    "warning": "Previous month data unavailable"
  }
}
```

### Partial Previous Month Data

If previous month has <50% data completeness, hybrid mode is disabled:

```javascript
// December has only 10 days of data (32% complete)
// System automatically falls back to standard mode
// Console warning: "Previous month 2024-12 only 32.3% complete"
```

## Performance

### Query Optimization

Hybrid mode requires fetching previous month data:

- **Standard mode**: 1 database query (~45ms)
- **Hybrid mode**: 2 database queries (~90ms)
- **With caching**: 2nd+ requests ~1ms (cache hit)

### Caching Strategy

Previous month averages are cached in memory:

```javascript
// Cached for 24 hours per meter
// Cleared daily at midnight
// Significantly improves repeat request performance
```

## Troubleshooting

### Issue: All Predictions Show "standard_fallback"

**Cause**: No previous month data in database

**Solution**:
```sql
-- Check if previous month data exists
SELECT COUNT(*), MIN(date), MAX(date) 
FROM "ksr-energy_meter" 
WHERE date >= '2024-12-01' AND date < '2025-01-01';

-- If count is 0, import December 2024 data
```

### Issue: Hybrid Mode Not Activating

**Checks**:
1. Verify `daysPassedMonth < 3`
2. Check `HYBRID_THRESHOLD` constant (should be 3)
3. Confirm previous month has ≥50% data completeness

### Issue: Unexpected Weights

**Debug**:
```javascript
// Add logging in calculateCurrentMonthWeight()
function calculateCurrentMonthWeight(daysAnalyzed) {
  const weights = { 1: 0.25, 2: 0.40 };
  const weight = weights[daysAnalyzed] || 0.25;
  console.log(`Weight for ${daysAnalyzed} days: ${weight}`);
  return weight;
}
```

## Migration from Standard to Hybrid

### No Breaking Changes

Hybrid enhancement is **fully backward compatible**:

- Existing API endpoints unchanged
- Response structure extended (new fields added, none removed)
- Frontend displays hybrid metadata automatically
- Can be disabled via feature flag if needed

### Frontend Updates (Optional)

To display hybrid information in UI:

```javascript
// Check if hybrid mode was used
if (monthResult.predictionMode === 'hybrid') {
  // Show hybrid badge
  const badge = `🔀 Hybrid Prediction (${monthResult.hybrid.weights.current * 100}% current, ${monthResult.hybrid.weights.previous * 100}% previous)`;
  
  // Show previous month reference
  const prevMonth = `Based on ${monthResult.hybrid.previousMonth.year}-${monthResult.hybrid.previousMonth.month}`;
}
```

## Documentation

- **[HYBRID_PREDICTION_ENHANCEMENT.md](HYBRID_PREDICTION_ENHANCEMENT.md)** - Complete technical specification
- **[PREDICTION_BACKEND_LOGIC.md](PREDICTION_BACKEND_LOGIC.md)** - Core prediction algorithm
- **[test_hybrid_prediction.js](test_hybrid_prediction.js)** - Automated test suite

## Support

For issues or questions:

1. Check **[HYBRID_PREDICTION_ENHANCEMENT.md](HYBRID_PREDICTION_ENHANCEMENT.md)** Section 5 (Edge Cases)
2. Run test suite: `node test_hybrid_prediction.js`
3. Check server logs for warnings/errors
4. Verify database has previous month data

---

**Version**: 1.0  
**Last Updated**: January 8, 2026  
**Status**: Production Ready ✅
