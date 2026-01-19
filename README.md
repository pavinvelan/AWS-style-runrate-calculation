# Smart Energy Intelligence (Run-Rate Forecast)

Energy consumption run-rate forecasting (AWS-style) with a real-time dashboard.

## Features
- Hour → day and day → month run-rate projections (same math AWS uses for billing)
- Dashboard with Chart.js visuals and fast API endpoints
- Works with PostgreSQL; configurable via environment variables (see [data_source.js](data_source.js#L5-L36))
- Optional ultra-fast mode using pre-aggregated data (`npm run aggregate` + `npm run forecast:fast`)

## Requirements
- Node.js 18+
- PostgreSQL with a table (default `ksr-energy_meter`) containing: `meter_id` (text), `date` (date), `time` (time), `energy_consumed_kwh` (numeric)
- Environment variables: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PG_TABLE` (defaults are safe for local docker-compose)
- Optional: Docker and docker-compose

## Run with Docker
```powershell
# If using an external DB, set env vars first
# set PGHOST=...
# set PGPORT=...
# set PGDATABASE=...
# set PGUSER=...
# set PGPASSWORD=...
# set PG_TABLE=ksr-energy_meter

docker-compose up -d
```

Dashboard: http://localhost:3000/dashboard.html

## Run locally (without Docker)
```bash
npm install
npm run server   # starts server.js on port 3000
```

Useful scripts:
- `npm run aggregate` – build aggregated data for ultra-fast forecasts
- `npm run forecast:fast` – run fast forecast using aggregated data
- `npm run forecast:optimized` – cached forecast without aggregates

## API
- `GET /api/predict?year=YYYY&month=M&day=D`
- `GET /api/forecast?year=YYYY&month=M`

## Troubleshooting
- `relation "..." does not exist`: set `PG_TABLE` to the correct table name or create the table with the columns above.
- Auth errors: verify `PGHOST/PGUSER/PGPASSWORD` and that the DB is reachable.
- Docker healthcheck stuck on starting: give it a few seconds; if it loops, check `docker-compose logs -f app`.

## Data assumptions
- Timestamps are stored as separate `date` and `time` columns; queries combine them for ordering and aggregation.
- Rolling averages use the last 6 hours for smoother daily projections; monthly projections need at least 3 days of data.# AWS-Style Run-Rate Calculation

**Smart Energy Intelligence System** - Energy consumption prediction using AWS-style run-rate forecasting

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Performance](https://img.shields.io/badge/Performance-456x_Faster-brightgreen.svg)](QUICK_START.md)

---

## 🎯 Overview

This system predicts energy consumption using the same mathematical approach AWS uses for billing forecasts. It provides real-time predictions without requiring Machine Learning models.

**Key Features:**
- 📈 **Hour → Day Prediction**: Projects today's total consumption from hourly data
- 📊 **Day → Month Prediction**: Projects monthly total consumption from daily data
- 🎨 **Interactive Dashboard**: Professional dark-theme UI with Chart.js visualizations
- ⚡ **Real-time Updates**: Instant predictions as new data arrives
- 🚀 **Zero Dependencies**: Pure Node.js implementation (except Chart.js for UI)
- ⚡ **Ultra-Fast**: 456x faster forecasting (1,245ms → 2.7ms) - [See Quick Start](QUICK_START.md)

---

## ⚡ Quick Start (Ultra-Fast Mode)

```bash
# 1. Setup (one-time) - aggregates data for 456x faster forecasting
npm run aggregate

# 2. Run fast forecast
npm run forecast:fast

# 3. Start dashboard with auto-optimization
npm run dashboard
```

**Result:** Forecasts in ~3ms instead of ~1,245ms! 🚀

See [QUICK_START.md](QUICK_START.md) for details or [PERFORMANCE_OPTIMIZATION.md](PERFORMANCE_OPTIMIZATION.md) for technical details.

---

## 📊 How It Works

### 1. HOUR → DAY PREDICTION

**Formula (AWS-Style):**
```
predicted_today_kwh = (sum_energy_so_far / hours_passed) × 24
```

**Example:**
- Time: 10:00 AM (10 hours passed)
- Energy so far: 375 kWh
- Average rate: 375 / 10 = 37.5 kWh/hour
- **Predicted today: 37.5 × 24 = 900 kWh**

**Enhanced with Rolling Average:**
- Uses last 6 hours instead of all hours
- Reduces impact of unusual spikes/drops
- More accurate for recent consumption patterns

```
recent_average = sum(last_6_hours) / 6
predicted_today = recent_average × 24
```

---

### 2. DAY → MONTH PREDICTION

**Formula (AWS-Style):**
```
predicted_month_kwh = (sum_daily_energy / days_passed) × days_in_month
```

**Example:**
- Current date: January 10
- Energy so far: 9,000 kWh (over 10 days)
- Average daily rate: 9,000 / 10 = 900 kWh/day
- Days in January: 31
- **Predicted month: 900 × 31 = 27,900 kWh**

---

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- PostgreSQL with table containing `meter_id`, `timestamp`, `energy_consumed_kwh`
- Connection defaults (override with env):
   - host: 192.168.0.137
   - port: 5432
   - db: ksr_meter
   - user: cubeai
   - password: 123456

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/pavinvelan/AWS-style-runrate-calculation.git
   cd AWS-style-runrate-calculation
   ```

2. **Start the server**
   ```bash
   node server.js
   ```

3. **Open the dashboard**
   ```
   http://localhost:3000
   ```

### Running Predictions via Command Line

```bash
node index.js
```

---

## 📁 Project Structure

```
smart-energy-intelligence/
├── server.js                   # Node.js HTTP server
├── index.js                    # Core prediction logic
├── dashboard.html              # Interactive UI with Chart.js
├── package.json                # Project configuration
├── 2025-01-*.csv              # Energy data files
├── README.md                   # This file
├── TECHNICAL_DOCUMENTATION.md  # Detailed technical docs
└── SYSTEM_DIAGRAMS.md         # System architecture diagrams
```

---

## 📁 CSV File Format

The system expects CSV files named in `YYYY-MM-DD.csv` format with these columns:
- `meter_id`: Identifier for the meter (e.g., KSR-1, KSR-2)
- `timestamp`: Date and time in `YYYY-MM-DD HH:mm:ss` format
- `energy_consumed_kwh`: Energy consumed in kWh

**Example:**
```csv
meter_id,timestamp,energy_consumed_kwh
KSR-1,2025-01-01 00:00:00,0.64
KSR-1,2025-01-01 00:01:00,0.63
KSR-2,2025-01-01 00:00:00,0.78
```

**Note:** The system automatically aggregates minute-level data into hourly and daily totals.

---

## 🎨 Dashboard Features

- **Dark Theme UI**: Professional, futuristic design with glass-morphism effects
- **Chart.js Visualizations**: 
  - Doughnut charts for today's energy breakdown
  - Bar charts for monthly progress
- **Real-time Predictions**: Click "Run Prediction Analysis" to get instant results
- **Multi-meter Support**: Automatically processes all meters in your CSV files
- **Responsive Design**: Works on desktop, tablet, and mobile

---

## 🔧 API Endpoints

### GET `/api/predict`

Returns prediction data for all meters in JSON format.

**Response:**
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
        "rollingPrediction": 895.04,
        "recentHourlyRate": 37.29
      },
      "month": {
        "success": true,
        "year": 2025,
        "month": 1,
        "daysPassedMonth": 8,
        "totalEnergyMonth": 7200.24,
        "predictedMonthKwh": 27900.93,
        "averageDailyRate": 900.03
      }
    }
  ]
}
```

---

## 📈 Sample Output

```
==============================================
  ENERGY CONSUMPTION PREDICTION SYSTEM        
  AWS-Style Run-Rate Forecasting
==============================================

📊 Reading data from: 2025-01-01.csv
   Total records: 2880
   Meters found: KSR-1, KSR-2

==============================================
  METER: KSR-1
==============================================

✅ Processed 24 hours of data

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📈 TODAY'S PREDICTION (Hour → Day)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Date: 2025-01-01
   Hours of data available: 24 hours
   Energy consumed so far: 899.88 kWh

   📊 FORMULA (Basic AWS Style):
   predicted_today = (899.88 kWh / 24 hours) × 24 hours
   predicted_today = 37.49 kWh/hour × 24
   ➜ Basic Prediction: 899.88 kWh

   📊 FORMULA (Rolling Average - Last 6 hours):
   predicted_today = 37.52 kWh/hour × 24 hours
   ➜ Rolling Prediction: 900.60 kWh (Recommended)

   💡 Status: ESTIMATED
      (Accuracy improves as more hours pass)
```

---

## ⚙️ Configuration

You can adjust these settings in `index.js`:

```javascript
const CSV_FILE = '2025-01-01.csv';        // Your data file
const ROLLING_WINDOW_HOURS = 6;            // Hours for rolling average
const MIN_HOURS_REQUIRED = 3;              // Minimum hours for prediction
const MIN_DAYS_REQUIRED = 3;               // Minimum days for monthly prediction
```

---

## 🎯 Accuracy Notes

### Why This Approach is Accurate

1. **No Overfitting**: Unlike ML models, this doesn't learn patterns that may not repeat
2. **Simple Math**: Basic average × time period = projection
3. **AWS-Proven**: Same formula used by AWS for billing forecasts
4. **Real-time**: Updates instantly as new data comes in

### When Predictions Are Most Accurate

| Time of Day | Accuracy | Reason |
|-------------|----------|--------|
| 6:00 AM | Low | Only 6 hours of data |
| 12:00 PM | Medium | 12 hours = half day |
| 6:00 PM | High | 18 hours = most of day |
| 11:59 PM | Exact | Complete day |

### Monthly Predictions

- **Day 1-2**: Not available (need 3 days minimum)
- **Day 3-7**: Fair estimate (70-80% accurate)
- **Day 8-15**: Good estimate (85-90% accurate)
- **Day 16+**: Excellent estimate (90-95% accurate)

---

## 🔧 How the Code Works

### Main Functions

1. **`readCSV()`**
   - Reads CSV file without external libraries
   - Parses into JavaScript objects

2. **`calculateHourlyTotals()`**
   - Aggregates minute-level data into hourly totals
   - Groups by timestamp hour

3. **`calculateDailyTotals()`**
   - Aggregates hourly data into daily totals
   - Sums all hours in each day

4. **`predictToday()`**
   - Implements Hour → Day formula
   - Returns basic and rolling predictions

5. **`predictMonth()`**
   - Implements Day → Month formula
   - Automatically detects days in month

---

## 📝 Edge Cases Handled

✅ **Multiple meters** - Processes each meter separately  
✅ **Insufficient data** - Shows clear warnings  
✅ **Partial days** - Uses only complete hours  
✅ **Different month lengths** - Auto-detects (28/29/30/31 days)  
✅ **Minute-level data** - Aggregates to hourly automatically

---

## 🆚 Why Not Machine Learning?

| Aspect | This Approach | ML Approach |
|--------|---------------|-------------|
| Setup | Zero setup | Requires training |
| Accuracy | High for run-rate | High for patterns |
| Explainability | 100% transparent | Black box |
| Data needed | Few hours/days | Months/years |
| Computation | Instant | Slow |
| Maintenance | None | Retraining needed |

**For run-rate forecasting, simple math wins.**

---

## 🎓 Learning Resources

### Understanding the Formula

**Why does this work?**

If you consume 100 kWh in 4 hours:
- Rate = 100 / 4 = 25 kWh/hour
- If this continues: 25 × 24 = 600 kWh/day

**AWS uses this because:**
- Simple and reliable
- No assumptions about future
- Updates in real-time
- Easy to explain to customers

---

## 🔍 Example Scenarios

### Scenario 1: Mid-Morning Check (10:00 AM)

```
Hours passed: 10
Energy so far: 375 kWh
Average: 375 / 10 = 37.5 kWh/hour
Predicted: 37.5 × 24 = 900 kWh
```

### Scenario 2: End of Day (11:00 PM)

```
Hours passed: 23
Energy so far: 897 kWh
Average: 897 / 23 = 39 kWh/hour
Predicted: 39 × 24 = 936 kWh
```

### Scenario 3: Monthly (15 days in)

```
Days passed: 15
Energy so far: 13,500 kWh
Average: 13,500 / 15 = 900 kWh/day
Days in month: 31
Predicted: 900 × 31 = 27,900 kWh
```

---

## 🐛 Troubleshooting

### Error: "File not found"
- Ensure CSV file is in the same directory as `index.js`
- Check filename matches `CSV_FILE` constant

### Warning: "Need at least 3 hours"
- Normal for early morning hours
- Wait until more data is available

### Warning: "Need at least 3 days"
- Normal at start of month
- Monthly predictions start from day 3

---

## 📊 Extending This System

### Want to add more features?

**Easy additions:**
- Export predictions to CSV
- Compare predicted vs actual
- Send alerts if consumption exceeds threshold
- Track accuracy over time

**The code is structured for easy modification:**
- Clear function separation
- Well-commented formulas
- Beginner-friendly style

---

## 💡 Key Takeaways

1. ✅ **Simple is better** - No ML needed for run-rate forecasting
2. ✅ **AWS-proven formula** - Used by cloud providers worldwide
3. ✅ **Real-time accuracy** - Updates as data comes in
4. ✅ **Transparent math** - Every step is explainable
5. ✅ **Production-ready** - Handles edge cases properly

---

## 📞 Support

This system is designed to be:
- **Self-explanatory** through code comments
- **Easy to modify** with clear function structure
- **Beginner-friendly** with simple variable names

Read the comments in `index.js` for detailed explanations of each step.

---

**Built with accuracy and simplicity in mind. No external dependencies. Pure Node.js.**
#   A W S - s t y l e - r u n r a t e - c a l c u l a t i o n 
 
 