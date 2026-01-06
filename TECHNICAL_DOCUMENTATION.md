# Technical Documentation: Energy Prediction System

## Table of Contents
1. [Data Reading Process](#1-data-reading-process)
2. [Data Calculation & Aggregation](#2-data-calculation--aggregation)
3. [Prediction Algorithms](#3-prediction-algorithms)
4. [Backend Operations & API](#4-backend-operations--api)
5. [Frontend Dashboard & Data Flow](#5-frontend-dashboard--data-flow)
6. [Examples & Formulas](#6-examples--formulas)

---

## 1. Data Reading Process

### 1.1 File Discovery

**How it works:**
The system automatically scans the directory for CSV files matching the pattern `YYYY-MM-DD.csv`.

```javascript
function getAllCSVFiles() {
  const files = fs.readdirSync(__dirname);
  return files.filter(file => 
    file.endsWith('.csv') && 
    file.match(/^\d{4}-\d{2}-\d{2}\.csv$/)  // Matches: 2025-01-01.csv
  ).sort();  // Alphabetical = chronological order
}
```

**Input:** Folder containing CSV files
**Output:** Sorted array of filenames: `['2025-01-01.csv', '2025-01-04.csv', ...]`

**Example:**
```
Directory contents:
- 2025-01-01.csv  ✓ (matches pattern)
- 2025-01-04.csv  ✓ (matches pattern)
- dashboard.html  ✗ (not CSV)
- sample_data.csv ✗ (doesn't match date pattern)

Result: ['2025-01-01.csv', '2025-01-04.csv']
```

---

### 1.2 CSV Parsing

**How it works:**
Each CSV file is read as text, then parsed line by line into JavaScript objects.

```javascript
function readCSV(filePath) {
  // Step 1: Read entire file as text
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  
  // Step 2: Split into lines, remove empty lines
  const lines = fileContent.split('\n').filter(line => line.trim() !== '');
  
  // Step 3: First line = headers
  const headers = lines[0].split(',').map(h => h.trim());
  // Result: ['meter_id', 'timestamp', 'energy_consumed_kwh', ...]
  
  // Step 4: Convert each data line to an object
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index].trim();
    });
    data.push(row);
  }
  
  return data;
}
```

**Input CSV Example:**
```csv
meter_id,timestamp,energy_consumed_kwh
KSR-1,2025-01-01 00:00:00,0.64
KSR-1,2025-01-01 00:01:00,0.64
```

**Output (JavaScript objects):**
```javascript
[
  {
    meter_id: 'KSR-1',
    timestamp: '2025-01-01 00:00:00',
    energy_consumed_kwh: '0.64'
  },
  {
    meter_id: 'KSR-1',
    timestamp: '2025-01-01 00:01:00',
    energy_consumed_kwh: '0.64'
  }
]
```

---

### 1.3 Multi-File Aggregation

**How it works:**
All CSV files are read and their data is combined into a single array.

```javascript
function readAllCSVFiles() {
  const csvFiles = getAllCSVFiles();  // ['2025-01-01.csv', '2025-01-04.csv']
  let allData = [];
  
  csvFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    const fileData = readCSV(filePath);  // Parse one file
    allData = allData.concat(fileData);  // Add to master array
  });
  
  return allData;
}
```

**Example:**
```
File 1 (2025-01-01.csv): 2,880 records
File 2 (2025-01-04.csv): 2,880 records
File 3 (2025-01-05.csv): 2,880 records

Combined Array: 8,640 records (all in chronological order)
```

---

### 1.4 Meter Grouping

**How it works:**
Data is separated by `meter_id` so each meter can be analyzed independently.

```javascript
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
```

**Input:** Mixed records from all meters
```javascript
[
  { meter_id: 'KSR-1', timestamp: '2025-01-01 00:00:00', ... },
  { meter_id: 'KSR-2', timestamp: '2025-01-01 00:00:00', ... },
  { meter_id: 'KSR-1', timestamp: '2025-01-01 00:01:00', ... },
  ...
]
```

**Output:** Grouped by meter
```javascript
{
  'KSR-1': [
    { meter_id: 'KSR-1', timestamp: '2025-01-01 00:00:00', ... },
    { meter_id: 'KSR-1', timestamp: '2025-01-01 00:01:00', ... },
    ...
  ],
  'KSR-2': [
    { meter_id: 'KSR-2', timestamp: '2025-01-01 00:00:00', ... },
    ...
  ]
}
```

---

## 2. Data Calculation & Aggregation

### 2.1 Timestamp Parsing

**How it works:**
Timestamps are broken down into components for aggregation.

```javascript
function parseTimestamp(timestamp) {
  // Input: "2025-01-01 14:35:00"
  
  const parts = timestamp.split(' ');
  const datePart = parts[0];  // "2025-01-01"
  const timePart = parts[1];  // "14:35:00"
  
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  
  return {
    year: 2025,
    month: 1,
    day: 1,
    hour: 14,
    minute: 35,
    date: "2025-01-01",
    time: "14:35:00"
  };
}
```

**Why?** We need to group data by hour and by day.

---

### 2.2 Minute → Hourly Aggregation

**How it works:**
Your CSV has **minute-level** data (1,440 records per day per meter). We aggregate this into **hourly** totals (24 records per day per meter).

```javascript
function calculateHourlyTotals(meterData) {
  const hourlyData = {};
  
  meterData.forEach(row => {
    const timestamp = parseTimestamp(row.timestamp);
    
    // Create hour key: "2025-01-01 14:00" (ignores minutes)
    const hourKey = `${timestamp.date} ${String(timestamp.hour).padStart(2, '0')}:00`;
    
    // Initialize hour bucket if first time seeing this hour
    if (!hourlyData[hourKey]) {
      hourlyData[hourKey] = {
        timestamp: hourKey,
        hour: timestamp.hour,
        date: timestamp.date,
        energyKwh: 0,
        count: 0
      };
    }
    
    // Add this minute's energy to the hour total
    const energyConsumed = parseFloat(row.energy_consumed_kwh) || 0;
    hourlyData[hourKey].energyKwh += energyConsumed;
    hourlyData[hourKey].count++;
  });
  
  return Object.values(hourlyData).sort((a, b) => 
    a.timestamp.localeCompare(b.timestamp)
  );
}
```

**Example:**

**Input (Minute-level):**
```
2025-01-01 14:00:00 → 0.64 kWh
2025-01-01 14:01:00 → 0.63 kWh
2025-01-01 14:02:00 → 0.65 kWh
...
2025-01-01 14:59:00 → 0.62 kWh
(60 records)
```

**Output (Hourly):**
```
2025-01-01 14:00 → 38.5 kWh (sum of 60 minutes)
(1 record)
```

**Math:**
- 60 minutes × ~0.64 kWh per minute = ~38.5 kWh per hour

---

### 2.3 Hourly → Daily Aggregation

**How it works:**
Hourly data (24 records per day) is aggregated into **daily** totals (1 record per day).

```javascript
function calculateDailyTotals(hourlyData) {
  const dailyData = {};
  
  hourlyData.forEach(hour => {
    const date = hour.date;  // "2025-01-01"
    
    // Initialize day bucket if first time seeing this day
    if (!dailyData[date]) {
      dailyData[date] = {
        date: date,
        energyKwh: 0,
        hoursCount: 0
      };
    }
    
    // Add this hour's energy to the day total
    dailyData[date].energyKwh += hour.energyKwh;
    dailyData[date].hoursCount++;
  });
  
  return Object.values(dailyData).sort((a, b) => 
    a.date.localeCompare(b.date)
  );
}
```

**Example:**

**Input (Hourly):**
```
2025-01-01 00:00 → 37.5 kWh
2025-01-01 01:00 → 38.2 kWh
2025-01-01 02:00 → 35.8 kWh
...
2025-01-01 23:00 → 35.4 kWh
(24 records)
```

**Output (Daily):**
```
2025-01-01 → 900.0 kWh (sum of 24 hours)
(1 record)
```

**Math:**
- 24 hours × ~37.5 kWh per hour = ~900 kWh per day

---

## 3. Prediction Algorithms

### 3.1 Hour → Day Prediction (Today's Forecast)

**Purpose:** Predict total energy consumption for the current day based on hours elapsed.

**AWS-Style Formula:**
```
predicted_today_kwh = (energy_consumed_so_far / hours_passed) × 24
```

**Implementation:**

```javascript
function predictToday(hourlyData) {
  // Get today's date (from latest hour in data)
  const todayDate = hourlyData[hourlyData.length - 1].date;
  
  // Filter only today's hours
  const todayHours = hourlyData.filter(h => h.date === todayDate);
  
  // Check if we have enough data
  if (todayHours.length < 3) {
    return { success: false, message: "Need at least 3 hours of data" };
  }
  
  // Calculate total energy consumed so far today
  const totalEnergyToday = todayHours.reduce((sum, h) => sum + h.energyKwh, 0);
  const hoursPassedToday = todayHours.length;
  
  // BASIC PREDICTION: Average rate × 24 hours
  const averageHourlyRate = totalEnergyToday / hoursPassedToday;
  const basicPrediction = averageHourlyRate * 24;
  
  // ENHANCED PREDICTION: Use rolling average of last 6 hours
  const rollingWindowSize = Math.min(6, todayHours.length);
  const recentHours = todayHours.slice(-rollingWindowSize);  // Last 6 hours
  const recentTotal = recentHours.reduce((sum, h) => sum + h.energyKwh, 0);
  const recentAverage = recentTotal / recentHours.length;
  const rollingPrediction = recentAverage * 24;
  
  return {
    success: true,
    date: todayDate,
    hoursPassedToday: hoursPassedToday,
    totalEnergyToday: totalEnergyToday,
    basicPrediction: basicPrediction,
    rollingPrediction: rollingPrediction,  // More accurate
    averageHourlyRate: averageHourlyRate,
    recentHourlyRate: recentAverage
  };
}
```

**Example Calculation:**

**Scenario:** It's 2:00 PM (14:00), and we want to predict today's total.

**Data Available:**
```
Hour 00:00 → 37.5 kWh
Hour 01:00 → 38.2 kWh
Hour 02:00 → 35.8 kWh
...
Hour 13:00 → 38.9 kWh
(14 hours of data)
```

**Step 1: Sum energy so far**
```
Total = 37.5 + 38.2 + 35.8 + ... + 38.9 = 525.0 kWh
```

**Step 2: Calculate average hourly rate**
```
Average = 525.0 kWh / 14 hours = 37.5 kWh/hour
```

**Step 3: Project to 24 hours**
```
Predicted Today = 37.5 kWh/hour × 24 hours = 900.0 kWh
```

**Step 4: Enhanced (Rolling Average - Last 6 hours)**
```
Recent hours (08:00 to 13:00):
38.1 + 39.2 + 38.7 + 37.9 + 38.5 + 38.9 = 231.3 kWh

Recent Average = 231.3 / 6 = 38.55 kWh/hour

Rolling Prediction = 38.55 × 24 = 925.2 kWh (More accurate!)
```

**Why Rolling Average?**
- If energy usage spiked at 6 AM but normalized by noon, the rolling average reflects current patterns better
- Less affected by outliers or unusual early morning consumption

---

### 3.2 Day → Month Prediction (Monthly Forecast)

**Purpose:** Predict total energy consumption for the entire month based on days elapsed.

**AWS-Style Formula:**
```
predicted_month_kwh = (energy_consumed_so_far / days_passed) × days_in_month
```

**Implementation:**

```javascript
function predictMonth(dailyData) {
  // Check if we have enough data
  if (dailyData.length < 3) {
    return { success: false, message: "Need at least 3 days of data" };
  }
  
  // Get current month/year from latest day
  const latestDate = dailyData[dailyData.length - 1].date;
  const [year, month, day] = latestDate.split('-').map(Number);
  
  // Filter only current month's data
  const currentMonthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthData = dailyData.filter(d => d.date.startsWith(currentMonthPrefix));
  
  if (monthData.length < 3) {
    return { success: false, message: "Need at least 3 days of current month" };
  }
  
  // Calculate total energy consumed this month so far
  const totalEnergyMonth = monthData.reduce((sum, d) => sum + d.energyKwh, 0);
  const daysPassedMonth = monthData.length;
  
  // Get number of days in this month (28, 29, 30, or 31)
  const daysInCurrentMonth = getDaysInMonth(year, month);
  
  // Project to full month
  const averageDailyRate = totalEnergyMonth / daysPassedMonth;
  const predictedMonthKwh = averageDailyRate * daysInCurrentMonth;
  
  return {
    success: true,
    year: year,
    month: month,
    daysPassedMonth: daysPassedMonth,
    daysInCurrentMonth: daysInCurrentMonth,
    totalEnergyMonth: totalEnergyMonth,
    predictedMonthKwh: predictedMonthKwh,
    averageDailyRate: averageDailyRate
  };
}
```

**Example Calculation:**

**Scenario:** It's January 10, and we want to predict January's total.

**Data Available:**
```
2025-01-01 → 900.0 kWh
2025-01-04 → 895.2 kWh
2025-01-05 → 903.1 kWh
2025-01-06 → 898.7 kWh
2025-01-07 → 901.5 kWh
2025-01-08 → 899.3 kWh
2025-01-09 → 905.0 kWh
2025-01-10 → 897.5 kWh
(8 days of data)
```

**Step 1: Sum energy so far this month**
```
Total = 900.0 + 895.2 + 903.1 + ... + 897.5 = 7,200.3 kWh
```

**Step 2: Calculate average daily rate**
```
Average = 7,200.3 kWh / 8 days = 900.04 kWh/day
```

**Step 3: Get days in January**
```
Days in January = 31 days
```

**Step 4: Project to full month**
```
Predicted January = 900.04 kWh/day × 31 days = 27,901.2 kWh
```

---

## 4. Backend Operations & API

### 4.1 Server Architecture

**Technology Stack:**
- **Runtime:** Node.js (built-in HTTP module)
- **No External Dependencies:** Pure Node.js implementation
- **Port:** 3000 (configurable)

**Server File:** `server.js`

```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const server = http.createServer((req, res) => {
  // Route handling logic
});

server.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT}`);
});
```

---

### 4.2 HTTP Request Routing

**How it works:**
The server handles different URL paths and serves appropriate responses.

```javascript
const server = http.createServer((req, res) => {
  
  // ROUTE 1: API Endpoint - Returns JSON predictions
  if (req.url === '/api/predict') {
    try {
      const predictions = getPredictions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(predictions));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // ROUTE 2: Dashboard HTML - Returns the UI
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
  
  // ROUTE 3: 404 - Path not found
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});
```

**Routes:**

| URL | Method | Response Type | Description |
|-----|--------|---------------|-------------|
| `/` | GET | HTML | Serves dashboard UI |
| `/dashboard.html` | GET | HTML | Serves dashboard UI |
| `/api/predict` | GET | JSON | Returns prediction data |
| `/*` (other) | GET | Plain Text | 404 Not Found |

---

### 4.3 API Endpoint Logic

**Endpoint:** `GET /api/predict`

**Process Flow:**

```
Client Request
    ↓
Server receives /api/predict
    ↓
getPredictions() function called
    ↓
1. Read all CSV files
2. Group by meter
3. Calculate hourly totals
4. Calculate daily totals
5. Run prediction algorithms
6. Format response
    ↓
Return JSON to client
```

**Implementation:**

```javascript
function getPredictions() {
  // Step 1: Read all CSV files
  const data = readAllCSVFiles();
  
  // Step 2: Group data by meter
  const meterGroups = groupByMeter(data);
  const meterIds = Object.keys(meterGroups);
  
  // Step 3: Initialize response structure
  const results = {
    totalRecords: data.length,
    meters: []
  };
  
  // Step 4: Process each meter
  meterIds.forEach(meterId => {
    const meterData = meterGroups[meterId];
    
    // Calculate hourly aggregates
    const hourlyData = calculateHourlyTotals(meterData);
    
    // Calculate daily aggregates
    const dailyData = calculateDailyTotals(hourlyData);
    
    // Run predictions
    const todayResult = predictToday(hourlyData);
    const monthResult = predictMonth(dailyData);
    
    // Add to results
    results.meters.push({
      meterId: meterId,
      hoursProcessed: hourlyData.length,
      today: todayResult,
      month: monthResult
    });
  });
  
  return results;
}
```

**Response Format (JSON):**

```json
{
  "totalRecords": 23040,
  "meters": [
    {
      "meterId": "KSR-1",
      "hoursProcessed": 192,
      "today": {
        "success": true,
        "date": "2025-01-10",
        "hoursPassedToday": 24,
        "totalEnergyToday": 897.57,
        "basicPrediction": 897.57,
        "rollingPrediction": 895.04,
        "rollingWindowUsed": 6,
        "averageHourlyRate": 37.40,
        "recentHourlyRate": 37.29
      },
      "month": {
        "success": true,
        "year": 2025,
        "month": 1,
        "daysPassedMonth": 8,
        "daysInCurrentMonth": 31,
        "totalEnergyMonth": 7200.24,
        "predictedMonthKwh": 27900.93,
        "averageDailyRate": 900.03,
        "percentMonthComplete": "25.8"
      }
    },
    {
      "meterId": "KSR-2",
      "hoursProcessed": 192,
      "today": { /* ... */ },
      "month": { /* ... */ }
    }
  ]
}
```

---

### 4.4 Error Handling

**Server-Side Errors:**

```javascript
// Error Type 1: CSV Files Not Found
try {
  const data = readAllCSVFiles();
} catch (error) {
  // Response: 500 Internal Server Error
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    error: "No CSV files found in YYYY-MM-DD.csv format" 
  }));
}

// Error Type 2: Insufficient Data
const todayResult = predictToday(hourlyData);
if (!todayResult.success) {
  // Response includes error message in data
  return {
    success: false,
    message: "Need at least 3 hours of data. Currently have 2 hour(s)."
  };
}
```

**HTTP Status Codes:**

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful prediction response |
| 404 | Not Found | Invalid URL or dashboard.html missing |
| 500 | Internal Server Error | CSV read error or processing failure |

---

### 4.5 Backend Performance

**Processing Time:**

```
23,040 records (8 days, 2 meters)
    ↓
Read & Parse: ~50ms
Group by Meter: ~10ms
Hourly Aggregation: ~30ms
Daily Aggregation: ~5ms
Predictions: ~5ms
    ↓
Total: ~100ms (0.1 seconds)
```

**Optimization Techniques:**

1. **In-Memory Processing** - All data loaded into RAM (fast)
2. **Single-Pass Aggregation** - Process each record once
3. **No Database** - Eliminates query overhead
4. **Sorted File Reading** - Files processed in chronological order

---

## 5. Frontend Dashboard & Data Flow

### 5.1 Dashboard Architecture

**File:** `dashboard.html`

**Technologies:**
- **HTML5** - Structure
- **CSS3** - Styling (embedded)
- **Vanilla JavaScript** - Logic (no frameworks)

**Components:**
1. Header Section
2. Control Panel (Run Analysis button)
3. Meter Cards (dynamic, one per meter)
4. Info Box (static help text)

---

### 5.2 Client-Side Data Fetching

**How it works:**
When user clicks "Run Prediction Analysis", JavaScript makes an HTTP request to the API.

```javascript
async function loadPredictions() {
  const content = document.getElementById('content');
  
  // Step 1: Show loading state
  content.innerHTML = '<div class="loading">⏳ Running analysis... Please wait...</div>';

  try {
    // Step 2: Fetch data from API
    const response = await fetch('/api/predict');
    
    // Step 3: Check if request succeeded
    if (!response.ok) {
      throw new Error('Failed to load predictions');
    }

    // Step 4: Parse JSON response
    const data = await response.json();
    
    // Step 5: Display results in UI
    displayResults(data);

  } catch (error) {
    // Step 6: Show error message
    content.innerHTML = `
      <div class="error">
        ⚠️ Error: ${error.message}<br><br>
        Make sure the server is running: <code>node server.js</code>
      </div>
    `;
  }
}
```

**Fetch API Flow:**

```
User clicks button
    ↓
loadPredictions() called
    ↓
Display "Loading..." message
    ↓
fetch('/api/predict') sent to server
    ↓
Wait for server response...
    ↓
Receive JSON data
    ↓
displayResults(data) called
    ↓
Render meter cards in DOM
```

---

### 5.3 Data Rendering Process

**How JSON becomes HTML:**

```javascript
function displayResults(data) {
  const content = document.getElementById('content');
  
  // Validate data
  if (!data.meters || data.meters.length === 0) {
    content.innerHTML = '<div class="error">No meter data available</div>';
    return;
  }

  let html = '<div class="meter-grid">';

  // Loop through each meter
  data.meters.forEach(meter => {
    html += `
      <div class="meter-card">
        <div class="meter-header">
          <div class="meter-icon">⚡</div>
          <div class="meter-title">${meter.meterId}</div>
        </div>

        <!-- Today's Prediction Section -->
        <div class="prediction-section">
          <div class="section-title">📈 Today's Prediction</div>
          
          ${meter.today.success ? `
            <div class="stat-box">
              <span class="stat-label">Date</span>
              <span class="stat-value">${meter.today.date}</span>
            </div>
            
            <div class="stat-box">
              <span class="stat-label">Hours of Data</span>
              <span class="stat-value">${meter.today.hoursPassedToday} hours</span>
            </div>
            
            <div class="stat-box">
              <span class="stat-label">Energy So Far</span>
              <span class="stat-value">${meter.today.totalEnergyToday.toFixed(2)} kWh</span>
            </div>

            <div class="prediction-box">
              <div class="prediction-label">Predicted Today (Rolling Avg)</div>
              <div class="prediction-value">${meter.today.rollingPrediction.toFixed(2)} kWh</div>
              <div class="status-badge">ESTIMATED</div>
            </div>

            <div class="formula-box">
              Formula: ${meter.today.recentHourlyRate.toFixed(2)} kWh/hr × 24 hrs
            </div>
          ` : `
            <div class="stat-box">
              <span class="stat-label">⚠️ ${meter.today.message}</span>
            </div>
          `}
        </div>

        <!-- Monthly Prediction Section -->
        <div class="prediction-section">
          <div class="section-title">📊 Monthly Prediction</div>
          
          ${meter.month.success ? `
            <!-- Similar structure for monthly data -->
          ` : `
            <div class="stat-box">
              <span class="stat-label">⚠️ ${meter.month.message}</span>
            </div>
          `}
        </div>
      </div>
    `;
  });

  html += '</div>';
  content.innerHTML = html;
}
```

**Rendering Flow:**

```
JSON Data Received
    ↓
Loop through meters array
    ↓
For each meter:
  - Check if today.success === true
  - If yes: Render prediction data
  - If no: Show error message
    ↓
  - Check if month.success === true
  - If yes: Render monthly data
  - If no: Show error message
    ↓
Inject HTML into DOM
    ↓
Browser re-renders page
    ↓
User sees results
```

---

### 5.4 UI State Management

**Three UI States:**

**State 1: Initial (No Data)**
```html
<div class="loading">
  Click the button above to run prediction analysis...
</div>
```

**State 2: Loading**
```html
<div class="loading">
  ⏳ Running analysis... Please wait...
</div>
```

**State 3: Success (Data Displayed)**
```html
<div class="meter-grid">
  <div class="meter-card">
    <!-- KSR-1 data -->
  </div>
  <div class="meter-card">
    <!-- KSR-2 data -->
  </div>
</div>
```

**State 4: Error**
```html
<div class="error">
  ⚠️ Error: Failed to load predictions<br><br>
  Make sure the server is running: <code>node server.js</code>
</div>
```

---

### 5.5 Complete Request-Response Cycle

**Full Flow from User Click to Display:**

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (dashboard.html in browser)                        │
├─────────────────────────────────────────────────────────────┤
│ 1. User clicks "Run Prediction Analysis" button            │
│    → onclick="loadPredictions()" triggered                  │
│                                                             │
│ 2. JavaScript shows loading message                         │
│    → "⏳ Running analysis... Please wait..."                │
│                                                             │
│ 3. JavaScript makes HTTP request                            │
│    → fetch('http://localhost:3000/api/predict')            │
└─────────────────────────────────────────────────────────────┘
                          ↓
                    HTTP GET Request
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ BACKEND (server.js - Node.js)                               │
├─────────────────────────────────────────────────────────────┤
│ 4. Server receives request                                  │
│    → URL: /api/predict                                      │
│                                                             │
│ 5. getPredictions() function called                         │
│    a) readAllCSVFiles()                                     │
│       → Scan directory for YYYY-MM-DD.csv files            │
│       → Read and parse each file                           │
│       → Return: 23,040 raw records                         │
│                                                             │
│    b) groupByMeter(data)                                    │
│       → Separate KSR-1 and KSR-2 data                      │
│       → Return: { 'KSR-1': [...], 'KSR-2': [...] }        │
│                                                             │
│    c) For each meter:                                       │
│       → calculateHourlyTotals()                            │
│         · Aggregate minutes → hours                         │
│         · Return: 192 hourly records                       │
│                                                             │
│       → calculateDailyTotals()                             │
│         · Aggregate hours → days                            │
│         · Return: 8 daily records                          │
│                                                             │
│       → predictToday(hourlyData)                           │
│         · Calculate today's projection                     │
│         · Formula: (energy/hours) × 24                     │
│         · Return: prediction object                        │
│                                                             │
│       → predictMonth(dailyData)                            │
│         · Calculate monthly projection                     │
│         · Formula: (energy/days) × days_in_month          │
│         · Return: prediction object                        │
│                                                             │
│ 6. Format response as JSON                                  │
│    → Include totalRecords, meters array                    │
│                                                             │
│ 7. Send HTTP response                                       │
│    → Status: 200 OK                                         │
│    → Content-Type: application/json                         │
│    → Body: JSON data                                        │
└─────────────────────────────────────────────────────────────┘
                          ↓
                    HTTP Response (JSON)
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (dashboard.html in browser)                        │
├─────────────────────────────────────────────────────────────┤
│ 8. JavaScript receives response                             │
│    → await response.json()                                  │
│    → Parse JSON into JavaScript object                      │
│                                                             │
│ 9. displayResults(data) called                              │
│    → Loop through data.meters array                         │
│    → For each meter:                                        │
│      · Create HTML string for meter card                    │
│      · Include today's prediction (if success)              │
│      · Include monthly prediction (if success)              │
│      · Show error messages (if not success)                 │
│                                                             │
│ 10. Inject HTML into DOM                                    │
│     → document.getElementById('content').innerHTML = html   │
│                                                             │
│ 11. Browser re-renders                                      │
│     → CSS animations play (fade in, slide up)              │
│     → User sees meter cards with predictions                │
└─────────────────────────────────────────────────────────────┘
```

**Timing Breakdown:**

| Step | Component | Time | Description |
|------|-----------|------|-------------|
| 1-3 | Frontend | ~10ms | User interaction + request setup |
| 4 | Backend | ~5ms | Request routing |
| 5 | Backend | ~100ms | Data processing + predictions |
| 6-7 | Backend | ~10ms | JSON formatting + response |
| 8-9 | Frontend | ~20ms | JSON parsing + HTML generation |
| 10-11 | Frontend | ~50ms | DOM injection + rendering |
| **Total** | **End-to-End** | **~195ms** | **< 0.2 seconds** |

---

### 5.6 Dynamic Meter Card Generation

**Example: Converting One Meter's JSON to HTML**

**Input JSON:**
```json
{
  "meterId": "KSR-1",
  "today": {
    "success": true,
    "date": "2025-01-10",
    "totalEnergyToday": 897.57,
    "rollingPrediction": 895.04
  },
  "month": {
    "success": true,
    "month": 1,
    "totalEnergyMonth": 7200.24,
    "predictedMonthKwh": 27900.93
  }
}
```

**Output HTML:**
```html
<div class="meter-card">
  <div class="meter-header">
    <div class="meter-icon">⚡</div>
    <div class="meter-title">KSR-1</div>
  </div>
  
  <div class="prediction-section">
    <div class="section-title">📈 Today's Prediction</div>
    <div class="stat-box">
      <span class="stat-label">Energy So Far</span>
      <span class="stat-value">897.57 kWh</span>
    </div>
    <div class="prediction-box">
      <div class="prediction-value">895.04 kWh</div>
    </div>
  </div>
  
  <div class="prediction-section">
    <div class="section-title">📊 Monthly Prediction</div>
    <div class="stat-box">
      <span class="stat-label">Energy So Far</span>
      <span class="stat-value">7200.24 kWh</span>
    </div>
    <div class="prediction-box">
      <div class="prediction-value">27900.93 kWh</div>
    </div>
  </div>
</div>
```

**Rendered Result:**
```
┌─────────────────────────────────────────┐
│  ⚡ KSR-1                               │
├─────────────────────────────────────────┤
│  📈 Today's Prediction                  │
│  Energy So Far          897.57 kWh      │
│  ┌────────────────────────────────────┐ │
│  │ Predicted Today                    │ │
│  │ 895.04 kWh                         │ │
│  └────────────────────────────────────┘ │
│                                         │
│  📊 Monthly Prediction                  │
│  Energy So Far          7200.24 kWh     │
│  ┌────────────────────────────────────┐ │
│  │ Predicted Month Total              │ │
│  │ 27900.93 kWh                       │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

### 5.7 Conditional Rendering Logic

**Handle Success/Failure States:**

```javascript
// If prediction succeeded
if (meter.today.success) {
  // Show full prediction data
  html += `
    <div class="stat-box">...</div>
    <div class="prediction-box">...</div>
  `;
} else {
  // Show error message
  html += `
    <div class="stat-box">
      <span class="stat-label">⚠️ ${meter.today.message}</span>
    </div>
  `;
}
```

**Example Outputs:**

**Success Case:**
```
Date                    2025-01-10
Hours of Data           24 hours
Energy So Far           897.57 kWh
┌────────────────────────────────────┐
│ Predicted Today                    │
│ 895.04 kWh                         │
└────────────────────────────────────┘
```

**Failure Case:**
```
⚠️ Need at least 3 hours of data. Currently have 2 hour(s).
```

---

## 6. Examples & Formulas

### 4.1 Complete Data Flow Example

**Starting Point:** 8 CSV files, 2 meters

```
2025-01-01.csv (2,880 records)
2025-01-04.csv (2,880 records)
...
2025-01-10.csv (2,880 records)
-----------------------------------
Total: 23,040 records
```

**Step 1: Read & Combine**
```
23,040 raw records (minute-level)
↓
Grouped by meter_id
↓
KSR-1: 11,520 records
KSR-2: 11,520 records
```

**Step 2: Aggregate to Hours**
```
KSR-1: 11,520 minutes ÷ 60 = 192 hours
KSR-2: 11,520 minutes ÷ 60 = 192 hours
```

**Step 3: Aggregate to Days**
```
KSR-1: 192 hours ÷ 24 = 8 days
  2025-01-01 → 900.0 kWh
  2025-01-04 → 895.2 kWh
  ...
  2025-01-10 → 897.5 kWh

KSR-2: 192 hours ÷ 24 = 8 days
  2025-01-01 → 1,125.2 kWh
  2025-01-04 → 1,127.8 kWh
  ...
  2025-01-10 → 1,126.5 kWh
```

**Step 4: Predict Today (2025-01-10)**
```
KSR-1:
  Hours so far: 24 hours
  Energy so far: 897.5 kWh
  Average rate: 897.5 / 24 = 37.40 kWh/hour
  Prediction: 37.40 × 24 = 897.5 kWh (day complete)

KSR-2:
  Hours so far: 24 hours
  Energy so far: 1,126.5 kWh
  Average rate: 1,126.5 / 24 = 46.94 kWh/hour
  Prediction: 46.94 × 24 = 1,126.5 kWh (day complete)
```

**Step 5: Predict January 2025**
```
KSR-1:
  Days so far: 8 days
  Energy so far: 7,200.3 kWh
  Average rate: 7,200.3 / 8 = 900.04 kWh/day
  Days in January: 31
  Prediction: 900.04 × 31 = 27,901.2 kWh

KSR-2:
  Days so far: 8 days
  Energy so far: 9,021.6 kWh
  Average rate: 9,021.6 / 8 = 1,127.7 kWh/day
  Days in January: 31
  Prediction: 1,127.7 × 31 = 34,958.7 kWh
```

---

### 4.2 Formula Summary

| Prediction | Formula | Variables |
|------------|---------|-----------|
| **Today** | `(E_so_far / H_passed) × 24` | E = energy (kWh), H = hours |
| **Today (Rolling)** | `(E_last_6h / 6) × 24` | Last 6 hours only |
| **Month** | `(E_so_far / D_passed) × D_total` | E = energy (kWh), D = days |

---

### 4.3 Accuracy Over Time

**Today's Prediction:**

| Time | Hours | Accuracy | Reason |
|------|-------|----------|--------|
| 3:00 AM | 3 | ~50% | Very limited data, night patterns |
| 6:00 AM | 6 | ~65% | Still early, usage may change |
| 12:00 PM | 12 | ~85% | Half day complete, good average |
| 6:00 PM | 18 | ~95% | Most of day complete |
| 11:59 PM | 24 | 100% | Day complete, no prediction needed |

**Monthly Prediction:**

| Day | Days | Accuracy | Reason |
|-----|------|----------|--------|
| 1-2 | 1-2 | N/A | Insufficient data (need ≥3) |
| 3-5 | 3-5 | ~70% | Early estimate, may fluctuate |
| 6-10 | 6-10 | ~80% | Week+ of data, patterns emerging |
| 11-20 | 11-20 | ~90% | Good sample size |
| 21+ | 21+ | ~95% | Majority of month complete |

---

### 4.4 Why This Approach Works

**No Machine Learning Required Because:**

1. **Linear Projection** - Energy consumption follows relatively stable daily patterns
2. **AWS-Proven** - Same formula used for cloud billing forecasts worldwide
3. **Real-Time Updates** - Recalculates instantly with new data
4. **Transparent** - Every calculation can be explained and verified
5. **Accurate Enough** - For run-rate forecasting, average × time is mathematically sound

**When to Use ML Instead:**

- Predicting seasonal changes (summer vs winter)
- Detecting anomalies or unusual patterns
- Long-term forecasting (next year)
- Complex factor analysis (weather, events, etc.)

**For month-end forecasting, simple math is better than complex ML.**

---

## Summary Diagram: End-to-End System Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│                         USER INTERACTION                              │
└───────────────────────────────────────────────────────────────────────┘
                                  ↓
                  Opens http://localhost:3000
                                  ↓
┌───────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Browser)                            │
│  • Loads dashboard.html                                               │
│  • Displays "Run Prediction Analysis" button                          │
│  • User clicks button → JavaScript fetch('/api/predict')             │
└───────────────────────────────────────────────────────────────────────┘
                                  ↓
                          HTTP GET Request
                                  ↓
┌───────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Node.js)                             │
│  • server.js receives request                                         │
│  • Routes to getPredictions()                                         │
│  ├── readAllCSVFiles() → Reads 2025-01-*.csv files                   │
│  ├── groupByMeter() → Separates KSR-1, KSR-2                         │
│  ├── calculateHourlyTotals() → Minutes → Hours                       │
│  ├── calculateDailyTotals() → Hours → Days                           │
│  ├── predictToday() → (energy/hours) × 24                            │
│  └── predictMonth() → (energy/days) × days_in_month                  │
│  • Returns JSON response                                              │
└───────────────────────────────────────────────────────────────────────┘
                                  ↓
                         HTTP JSON Response
                                  ↓
┌───────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Browser)                            │
│  • Receives JSON data                                                 │
│  • displayResults() function processes data                           │
│  • Generates HTML for each meter card                                 │
│  • Injects HTML into DOM                                              │
│  • Browser renders predictions with CSS animations                    │
└───────────────────────────────────────────────────────────────────────┘
                                  ↓
┌───────────────────────────────────────────────────────────────────────┐
│                         USER SEES RESULTS                             │
│  ⚡ KSR-1: Today 895 kWh | Month 27,901 kWh                          │
│  ⚡ KSR-2: Today 1,129 kWh | Month 34,959 kWh                        │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack Summary

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | HTML5 + CSS3 + Vanilla JS | User interface & interactions |
| **Backend** | Node.js (http module) | API server & request handling |
| **Data Processing** | Pure JavaScript | CSV parsing & calculations |
| **Data Storage** | CSV Files | Raw energy consumption data |
| **Communication** | HTTP + JSON | Client-server data exchange |
| **Prediction** | Mathematical formulas | AWS-style run-rate forecasting |

**Zero External Dependencies** - Entire system runs on Node.js built-in modules only.

**Data Reading:** CSV files → Parsed objects → Grouped by meter

**Calculation:** Minutes → Hours → Days (aggregation at each level)

**Prediction:** 
- Today = (energy_so_far / hours) × 24
- Month = (energy_so_far / days) × days_in_month

**Result:** Accurate, explainable, real-time forecasts with zero machine learning.
