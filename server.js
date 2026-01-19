/**
 * SIMPLE HTTP SERVER FOR ENERGY PREDICTION DASHBOARD
 * 
 * Serves the HTML dashboard and provides API endpoint for predictions
 * No external dependencies - uses only Node.js built-in modules
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchReadingsInRange, fetchAvailableMonths, testDbConnection, dbConfig } = require('./data_source');

// Import forecast module - using ultra-fast version with aggregated data
// For 458x faster performance, ensure you've run: node aggregate_data.js
// Falls back to optimized version if aggregated data not available
let generateNextMonthForecast;
try {
  const fastForecast = require('./forecast_fast.js');
  generateNextMonthForecast = fastForecast.generateFastForecast;
  console.log('✓ Using ULTRA-FAST forecast module (aggregated data)');
} catch (error) {
  const optimizedForecast = require('./forecast_optimized.js');
  generateNextMonthForecast = optimizedForecast.generateNextMonthForecast;
  console.log('✓ Using OPTIMIZED forecast module (caching)');
}

// Import prediction logic from index.js
const ROLLING_WINDOW_HOURS = 6;
const MIN_HOURS_REQUIRED = 3;
// Allow current-month projection even when only a single day exists
const MIN_DAYS_REQUIRED = 1;
// Hybrid mode threshold: use previous month when current data < 3 days
const HYBRID_THRESHOLD = 3;

// ============================================
// PREDICTION FUNCTIONS (from index.js)
// ============================================

function getDaysInMonth(year, month) {
  // Use UTC to avoid DST / timezone edge cases.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatUtcYmd(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function utcMidnightMs(year, month, day) {
  return Date.UTC(year, month - 1, day);
}

/**
 * Server-side validation: block future selections.
 * - If year/month provided without day: block future year/month.
 * - If year/month/day provided: block future full date.
 * Uses UTC to avoid timezone/DST ambiguity.
 */
function validateNotFutureSelection(year, month, day) {
  const now = new Date();
  const todayYear = now.getUTCFullYear();
  const todayMonth = now.getUTCMonth() + 1;
  const todayDay = now.getUTCDate();

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    if (Number.isFinite(day)) {
      return { ok: false, code: 'INVALID_DATE', message: 'day requires year and month' };
    }
    return { ok: true };
  }

  if (month < 1 || month > 12) {
    return { ok: false, code: 'INVALID_DATE', message: 'month out of range (1-12)' };
  }

  // Block future months/years even when day is omitted.
  if (year > todayYear || (year === todayYear && month > todayMonth)) {
    return { ok: false, code: 'FUTURE_DATE', message: 'Future months/years are not allowed' };
  }

  if (Number.isFinite(day)) {
    const dim = getDaysInMonth(year, month);
    if (day < 1 || day > dim) {
      return { ok: false, code: 'INVALID_DATE', message: `day out of range (1-${dim})` };
    }

    const selected = utcMidnightMs(year, month, day);
    const today = utcMidnightMs(todayYear, todayMonth, todayDay);
    if (selected > today) {
      return { ok: false, code: 'FUTURE_DATE', message: 'Future dates are not allowed' };
    }
  }

  return { ok: true };
}

function groupByMeter(data) {
  const grouped = {};
  data.forEach(row => {
    const meterId = row.meter_id;
    if (!grouped[meterId]) {
      grouped[meterId] = [];
    }
    grouped[meterId].push(row);
  });
  return grouped;
}

function parseTimestamp(timestamp) {
  const parts = timestamp.split(' ');
  const datePart = parts[0];
  const timePart = parts[1];
  
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: datePart,
    time: timePart,
    fullDate: new Date(year, month - 1, day, hour, minute, second)
  };
}

async function loadMonthReadings(year, month, day) {
  const { getMonthRange, fetchLatestMonthRange } = require('./data_source');
  const pad = (n) => String(n).padStart(2, '0');

  if (year && month) {
    const range = getMonthRange(year, month);

    if (Number.isFinite(day)) {
      const daysInMonth = getDaysInMonth(year, month);
      const nextDay = Math.min(day + 1, daysInMonth + 1);
      // If nextDay rolls past month end, use next month's start as exclusive upper bound
      if (nextDay > daysInMonth) {
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        return fetchReadingsInRange(range.start, `${nextYear}-${pad(nextMonth)}-01`);
      }
      return fetchReadingsInRange(range.start, `${year}-${pad(month)}-${pad(nextDay)}`);
    }

    return fetchReadingsInRange(range.start, range.end);
  }

  const range = await fetchLatestMonthRange();
  return fetchReadingsInRange(range.start, range.end);
}

function calculateHourlyTotals(meterData) {
  const hourlyData = {};
  
  meterData.forEach(row => {
    const timestamp = parseTimestamp(row.timestamp);
    const hourKey = `${timestamp.date} ${String(timestamp.hour).padStart(2, '0')}:00`;
    
    if (!hourlyData[hourKey]) {
      hourlyData[hourKey] = {
        timestamp: hourKey,
        hour: timestamp.hour,
        date: timestamp.date,
        energyKwh: 0,
        count: 0
      };
    }
    
    const energyConsumed = parseFloat(row.energy_consumed_kwh) || 0;
    hourlyData[hourKey].energyKwh += energyConsumed;
    hourlyData[hourKey].count++;
  });
  
  return Object.values(hourlyData).sort((a, b) => 
    a.timestamp.localeCompare(b.timestamp)
  );
}

function calculateDailyTotals(hourlyData) {
  const dailyData = {};
  
  hourlyData.forEach(hour => {
    const date = hour.date;
    
    if (!dailyData[date]) {
      dailyData[date] = {
        date: date,
        energyKwh: 0,
        hoursCount: 0
      };
    }
    
    dailyData[date].energyKwh += hour.energyKwh;
    dailyData[date].hoursCount++;
  });
  
  return Object.values(dailyData).sort((a, b) => 
    a.date.localeCompare(b.date)
  );
}

function predictToday(hourlyData) {
  if (hourlyData.length < MIN_HOURS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_HOURS_REQUIRED} hours of data. Currently have ${hourlyData.length} hour(s).`
    };
  }
  
  const todayDate = hourlyData[hourlyData.length - 1].date;
  const todayHours = hourlyData.filter(h => h.date === todayDate);
  
  if (todayHours.length < MIN_HOURS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_HOURS_REQUIRED} hours of today's data. Currently have ${todayHours.length} hour(s).`
    };
  }
  
  const totalEnergyToday = todayHours.reduce((sum, h) => sum + h.energyKwh, 0);
  const hoursPassedToday = todayHours.length;
  
  const basicPrediction = (totalEnergyToday / hoursPassedToday) * 24;
  
  const rollingWindowSize = Math.min(ROLLING_WINDOW_HOURS, todayHours.length);
  const recentHours = todayHours.slice(-rollingWindowSize);
  const recentAverage = recentHours.reduce((sum, h) => sum + h.energyKwh, 0) / recentHours.length;
  const rollingPrediction = recentAverage * 24;
  
  return {
    success: true,
    date: todayDate,
    hoursPassedToday: hoursPassedToday,
    totalEnergyToday: totalEnergyToday,
    basicPrediction: basicPrediction,
    rollingPrediction: rollingPrediction,
    rollingWindowUsed: rollingWindowSize,
    averageHourlyRate: totalEnergyToday / hoursPassedToday,
    recentHourlyRate: recentAverage
  };
}

function predictMonth(dailyData, targetYear, targetMonth, targetDay) {
  if (dailyData.length < MIN_DAYS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_DAYS_REQUIRED} days of data. Currently have ${dailyData.length} day(s).`
    };
  }

  // Prefer the requested period when provided so UI labels match the selector
  let year = targetYear;
  let month = targetMonth;

  if (!year || !month) {
    const latestDate = dailyData[dailyData.length - 1].date;
    [year, month] = latestDate.split('-').map(Number);
  }

  const monthData = dailyData.filter(d => {
    const [y, m, day] = d.date.split('-').map(Number);
    if (y !== year || m !== month) return false;
    // If targetDay is specified, only include data up to that day
    if (Number.isFinite(targetDay) && day > targetDay) return false;
    return true;
  });

  if (monthData.length < MIN_DAYS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_DAYS_REQUIRED} days of ${year}-${String(month).padStart(2, '0')}. Currently have ${monthData.length} day(s).`
    };
  }

  const totalEnergyMonth = monthData.reduce((sum, d) => sum + d.energyKwh, 0);
  const daysPassedMonth = monthData.length;
  const daysInCurrentMonth = getDaysInMonth(year, month);
  
  // Use targetDay as the reference if provided, otherwise use actual data days
  const effectiveDayLimit = Number.isFinite(targetDay) ? targetDay : daysPassedMonth;
  const percentComplete = Math.min((effectiveDayLimit / daysInCurrentMonth) * 100, 100);
  const isComplete = effectiveDayLimit >= daysInCurrentMonth;
  
  const predictedMonthKwh = isComplete
    ? totalEnergyMonth
    : (totalEnergyMonth / daysPassedMonth) * daysInCurrentMonth;
  const averageDailyRate = totalEnergyMonth / daysPassedMonth;

  return {
    success: true,
    year,
    month,
    daysPassedMonth,
    daysInCurrentMonth,
    totalEnergyMonth,
    predictedMonthKwh,
    averageDailyRate,
    percentMonthComplete: percentComplete.toFixed(1),
    isComplete,
    valueSource: isComplete ? 'actual' : 'projection',
    targetDay: Number.isFinite(targetDay) ? targetDay : null
  };
}

// ============================================
// HYBRID PREDICTION ENHANCEMENT
// ============================================

/**
 * Get previous month year and month (handles year boundary)
 */
function getPreviousMonth(year, month) {
  if (month === 1) {
    // January → Previous December
    return { prevYear: year - 1, prevMonth: 12 };
  } else {
    return { prevYear: year, prevMonth: month - 1 };
  }
}

/**
 * Calculate adaptive weight for current month data
 * More current data → higher current month weight
 */
function calculateCurrentMonthWeight(daysAnalyzed) {
  const weights = {
    // Default mapping aligned with requirement examples
    // 1 day  -> 30% current, 70% previous
    // 2 days -> 50% current, 50% previous
    1: 0.30,
    2: 0.50,
  };
  
  return weights[daysAnalyzed] || 0.30;
}

/**
 * Load complete previous month data for hybrid prediction
 * 
 * @param {number} year - Previous month year
 * @param {number} month - Previous month (1-12)
 * @param {string} meterId - Meter ID to filter data
 * @returns {Array|null} Daily totals for entire previous month
 */
async function loadPreviousMonthData(year, month, meterId) {
  const { getMonthRange } = require('./data_source');
  const pad = (n) => String(n).padStart(2, '0');
  
  try {
    // Get full previous month range (no day cutoff)
    const range = getMonthRange(year, month);
    const rawData = await fetchReadingsInRange(range.start, range.end, meterId);
    
    if (!rawData || rawData.length === 0) {
      return null;
    }
    
    // Calculate hourly then daily totals
    const hourlyData = calculateHourlyTotals(rawData);
    const dailyData = calculateDailyTotals(hourlyData);
    
    // Validate sufficient data (>50% of month)
    const daysInMonth = getDaysInMonth(year, month);
    const dataCompleteness = (dailyData.length / daysInMonth) * 100;
    
    if (dataCompleteness < 50) {
      console.warn(`Previous month ${year}-${pad(month)} only ${dataCompleteness.toFixed(1)}% complete for meter ${meterId}`);
      return null;
    }
    
    return dailyData;
    
  } catch (error) {
    console.error(`Failed to load previous month data (${year}-${pad(month)}, ${meterId}):`, error.message);
    return null;
  }
}

/**
 * Enhanced confidence calculation considering hybrid mode
 */
function calculateConfidenceHybrid(daysAnalyzed, totalDays, isHybridMode, hasPreviousData) {
  const percentComplete = (daysAnalyzed / totalDays) * 100;
  
  if (percentComplete === 100) {
    return {
      level: 'exact',
      score: 100,
      description: 'Complete month data - actual value'
    };
  }
  
  if (percentComplete >= 80) {
    return {
      level: 'very_high',
      score: 90,
      description: 'Near-complete month data'
    };
  }
  
  if (percentComplete >= 50) {
    return {
      level: 'high',
      score: 80,
      description: 'Majority of month data available'
    };
  }
  
  if (percentComplete >= 25) {
    return {
      level: 'medium',
      score: 65,
      description: 'Moderate data available'
    };
  }
  
  // Low data scenarios - hybrid mode improves confidence
  if (isHybridMode && hasPreviousData) {
    // Hybrid mode increases confidence by ~20 points
    if (daysAnalyzed === 2) {
      return {
        level: 'medium_hybrid',
        score: 55,
        description: '2 days + previous month hybrid - improved accuracy',
        enhancement: 'Confidence boosted by previous month data'
      };
    } else {
      return {
        level: 'low_hybrid',
        score: 45,
        description: '1 day + previous month hybrid - stabilized prediction',
        enhancement: 'Confidence boosted by previous month data'
      };
    }
  }
  
  // Low data without hybrid (fallback)
  if (daysAnalyzed === 2) {
    return {
      level: 'low',
      score: 35,
      description: 'Only 2 days - limited reliability',
      warning: 'Previous month data unavailable'
    };
  }
  
  return {
    level: 'very_low',
    score: 25,
    description: `Only ${daysAnalyzed} day(s) - minimal reliability`,
    warning: 'Previous month data unavailable'
  };
}

/**
 * Enhanced monthly prediction with hybrid mode for low data scenarios
 * Uses previous month data when current month has <3 days
 * 
 * @param {Array} dailyData - Current month daily totals [{date, energyKwh}]
 * @param {Number} targetYear - Selected year
 * @param {Number} targetMonth - Selected month (1-12)
 * @param {Number} targetDay - Selected day cutoff (1-31)
 * @param {String} meterId - Meter ID for previous month data lookup
 * @returns {Object} Prediction results with hybrid metadata
 */
async function predictMonthHybrid(dailyData, targetYear, targetMonth, targetDay, meterId) {
  // ==========================================
  // STEP 1: Validate Minimum Data
  // ==========================================
  if (dailyData.length < MIN_DAYS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_DAYS_REQUIRED} days of data. Currently have ${dailyData.length} day(s).`
    };
  }

  // ==========================================
  // STEP 2: Determine Target Period
  // ==========================================
  let year = targetYear;
  let month = targetMonth;
  if (!year || !month) {
    const latestDate = dailyData[dailyData.length - 1].date;
    [year, month] = latestDate.split('-').map(Number);
  }

  // ==========================================
  // STEP 3: Filter Current Month Data
  // ==========================================
  const monthData = dailyData.filter(d => {
    const [y, m, day] = d.date.split('-').map(Number);
    if (y !== year || m !== month) return false;
    if (Number.isFinite(targetDay) && day > targetDay) return false;
    return true;
  });

  if (monthData.length < MIN_DAYS_REQUIRED) {
    return {
      success: false,
      message: `Need at least ${MIN_DAYS_REQUIRED} days of ${year}-${String(month).padStart(2, '0')}.`
    };
  }

  // ==========================================
  // STEP 4: Calculate Current Month Metrics
  // ==========================================
  const totalEnergyMonth = monthData.reduce((sum, d) => sum + d.energyKwh, 0);
  const daysPassedMonth = monthData.length;
  const daysInCurrentMonth = getDaysInMonth(year, month);
  const avgCurrentMonth = totalEnergyMonth / daysPassedMonth;
  
  const effectiveDayLimit = Number.isFinite(targetDay) ? targetDay : daysPassedMonth;
  const percentComplete = Math.min((effectiveDayLimit / daysInCurrentMonth) * 100, 100);
  const isComplete = effectiveDayLimit >= daysInCurrentMonth;

  // ==========================================
  // STEP 5: Decide Mode (Standard vs Hybrid)
  // ==========================================
  const useHybridMode = daysPassedMonth < HYBRID_THRESHOLD && !isComplete;
  
  let predictedMonthKwh;
  let averageDailyRate;
  let hybridMetadata = null;

  if (!useHybridMode) {
    // ======================================
    // STANDARD MODE (3+ days or complete)
    // ======================================
    predictedMonthKwh = isComplete
      ? totalEnergyMonth
      : avgCurrentMonth * daysInCurrentMonth;
    
    averageDailyRate = avgCurrentMonth;
    
  } else {
    // ======================================
    // HYBRID MODE (<3 days)
    // ======================================
    
    // Step 5.1: Calculate previous month period
    const { prevYear, prevMonth } = getPreviousMonth(year, month);
    
    // Step 5.2: Fetch previous month data
    const previousMonthData = await loadPreviousMonthData(prevYear, prevMonth, meterId);
    
    if (previousMonthData && previousMonthData.length > 0) {
      // Step 5.3: Calculate previous month average
      const totalEnergyPrevious = previousMonthData.reduce((sum, d) => sum + d.energyKwh, 0);
      const daysInPreviousMonth = getDaysInMonth(prevYear, prevMonth);
      const avgPreviousMonth = totalEnergyPrevious / previousMonthData.length;
      
      // Step 5.4: Calculate adaptive weights
      const weightCurrent = calculateCurrentMonthWeight(daysPassedMonth);
      const weightPrevious = 1 - weightCurrent;
      
      // Step 5.5: Compute hybrid average
      const avgHybrid = (avgCurrentMonth * weightCurrent) + (avgPreviousMonth * weightPrevious);
      
      // Step 5.6: Project to full month
      // Preserve actual-to-date usage and forecast remaining days using the hybrid average.
      predictedMonthKwh = totalEnergyMonth + (avgHybrid * Math.max(daysInCurrentMonth - daysPassedMonth, 0));
      averageDailyRate = avgHybrid;
      
      // Step 5.7: Store hybrid metadata
      hybridMetadata = {
        mode: 'hybrid',
        previousMonth: {
          year: prevYear,
          month: prevMonth,
          daysUsed: previousMonthData.length,
          totalDays: daysInPreviousMonth,
          totalEnergy: parseFloat(totalEnergyPrevious.toFixed(2)),
          avgDaily: parseFloat(avgPreviousMonth.toFixed(2))
        },
        currentMonth: {
          daysUsed: daysPassedMonth,
          totalEnergy: parseFloat(totalEnergyMonth.toFixed(2)),
          avgDaily: parseFloat(avgCurrentMonth.toFixed(2))
        },
        weights: {
          current: weightCurrent,
          previous: weightPrevious
        },
        hybridAvgDaily: parseFloat(avgHybrid.toFixed(2)),
        improvement: `Using previous month data (${prevYear}-${String(prevMonth).padStart(2, '0')}) to stabilize prediction`
      };
      
    } else {
      // Previous month data not available - fall back to standard mode
      predictedMonthKwh = avgCurrentMonth * daysInCurrentMonth;
      averageDailyRate = avgCurrentMonth;
      
      hybridMetadata = {
        mode: 'standard_fallback',
        reason: 'Previous month data not available',
        warning: 'Prediction based on limited current month data only'
      };
    }
  }

  // ==========================================
  // STEP 6: Calculate Confidence
  // ==========================================
  const confidence = calculateConfidenceHybrid(
    daysPassedMonth, 
    daysInCurrentMonth, 
    useHybridMode, 
    hybridMetadata?.previousMonth != null
  );

  // ==========================================
  // STEP 7: Return Comprehensive Result
  // ==========================================
  return {
    success: true,
    year,
    month,
    daysPassedMonth,
    daysInCurrentMonth,
    totalEnergyMonth: parseFloat(totalEnergyMonth.toFixed(2)),
    predictedMonthKwh: parseFloat(predictedMonthKwh.toFixed(2)),
    averageDailyRate: parseFloat(averageDailyRate.toFixed(2)),
    percentMonthComplete: percentComplete.toFixed(1),
    isComplete,
    valueSource: isComplete ? 'actual' : 'projection',
    targetDay: Number.isFinite(targetDay) ? targetDay : null,
    
    // Enhanced hybrid metadata
    predictionMode: hybridMetadata?.mode || 'standard',
    hybrid: hybridMetadata,
    confidence
  };
}

async function getPredictions() {
  const data = await loadCurrentMonthReadings();
  const meterGroups = groupByMeter(data);
  const meterIds = Object.keys(meterGroups);
  
  const results = {
    totalRecords: data.length,
    meters: []
  };
  
  meterIds.forEach(meterId => {
    const meterData = meterGroups[meterId];
    const hourlyData = calculateHourlyTotals(meterData);
    const dailyData = calculateDailyTotals(hourlyData);
    
    const todayResult = predictToday(hourlyData);
    const monthResult = predictMonth(dailyData, year, month);
    
    results.meters.push({
      meterId: meterId,
      hoursProcessed: hourlyData.length,
      today: todayResult,
      month: monthResult
    });
  });
  
  return results;
}

// ============================================
// HTTP SERVER
// ============================================

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // Handle current day/month prediction API endpoint
  if (req.url.startsWith('/api/predict')) {
    try {
      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const year = urlObj.searchParams.get('year') ? parseInt(urlObj.searchParams.get('year'), 10) : null;
      const month = urlObj.searchParams.get('month') ? parseInt(urlObj.searchParams.get('month'), 10) : null;
      const day = urlObj.searchParams.get('day') ? parseInt(urlObj.searchParams.get('day'), 10) : null;

      const validation = validateNotFutureSelection(year, month, day);
      if (!validation.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: validation.message,
          code: validation.code,
          serverTodayUtc: formatUtcYmd(new Date())
        }));
        return;
      }

      const data = await loadMonthReadings(year, month, day);
      const meterGroups = groupByMeter(data);
      const meterIds = Object.keys(meterGroups);
      const results = {
        totalRecords: data.length,
        meters: []
      };

      // Process each meter with hybrid prediction
      for (const meterId of meterIds) {
        const meterData = meterGroups[meterId];
        const hourlyData = calculateHourlyTotals(meterData);
        const dailyData = calculateDailyTotals(hourlyData);
        const todayResult = predictToday(hourlyData);
        
        // Use hybrid prediction (async, so use for...of loop)
        const monthResult = await predictMonthHybrid(dailyData, year, month, day, meterId);

        results.meters.push({
          meterId,
          hoursProcessed: hourlyData.length,
          today: todayResult,
          month: monthResult
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (error) {
      console.error('Predict API error:', error.stack || error.message || error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Available months endpoint
  if (req.url.startsWith('/api/months')) {
    try {
      const months = await fetchAvailableMonths();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ months }));
    } catch (error) {
      console.error('Months API error:', error.stack || error.message || error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // Handle next-month forecast API endpoint
  if (req.url.startsWith('/api/forecast')) {
    try {
      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const year = urlObj.searchParams.get('year') ? parseInt(urlObj.searchParams.get('year'), 10) : null;
      const month = urlObj.searchParams.get('month') ? parseInt(urlObj.searchParams.get('month'), 10) : null;
      const forecast = await generateNextMonthForecast({ year, month });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(forecast));
    } catch (error) {
      console.error('Forecast API error:', error.stack || error.message || error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // Serve HTML dashboard
  if (req.url === '/' || req.url === '/dashboard.html') {
    const htmlPath = path.join(__dirname, 'dashboard.html');
    fs.readFile(htmlPath, 'utf-8', (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Dashboard not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  }
  
  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

async function start() {
  try {
    console.log('🔄 Testing database connection...');
    await testDbConnection();
    console.log(`✅ Database connected (${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    server.listen(PORT, () => {
      console.log('\n==============================================');
      console.log('  ⚡ ENERGY PREDICTION DASHBOARD SERVER');
      console.log('==============================================\n');
      console.log(`  🌐 Server running at: http://localhost:${PORT}`);
      console.log(`  📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
      console.log(`  🔌 Current Predictions: http://localhost:${PORT}/api/predict`);
      console.log(`  📈 Next Month Forecast: http://localhost:${PORT}/api/forecast`);
      console.log('\n  Press Ctrl+C to stop the server\n');
      console.log('==============================================\n');
    });
  } catch (err) {
    console.error('❌ Database connection failed:', err.message || err);
    console.error('Make sure PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD are set.');
    process.exit(1);
  }
}

start();
