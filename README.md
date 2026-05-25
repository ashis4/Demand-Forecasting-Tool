# DemandIQ — Demand Forecasting Tool

A full-featured demand forecasting dashboard built with Flask, Plotly, and statsmodels.

## Features
- **CSV/Excel upload** with auto column detection
- **Data Preview** — first 5 rows, missing values, summary stats
- **KPI Dashboard** — total sales, avg demand, top product, date range
- **5 Visualizations** — trend, monthly demand, product-wise, day-of-week, year-over-year
- **4 Forecasting Models** — ARIMA, SARIMA, Prophet, Exponential Smoothing, Moving Average
- **Forecast Output** — next 7 / 30 / 60 / 90 days with confidence intervals
- **Sample Datasets** — Retail, E-Commerce, Seasonal built-in

## Setup

### 1. Install Python 3.9+
Make sure you have Python installed: https://python.org

### 2. Create a virtual environment (recommended)
```bash
python -m venv venv
source venv/bin/activate      # Mac/Linux
venv\Scripts\activate         # Windows
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Run the app
```bash
python app.py
```

### 5. Open in browser
```
http://localhost:5000
```

## Usage

1. **Upload Data** — drag & drop your CSV/Excel file, or click a sample dataset button
2. **Dashboard** — view KPIs and trend charts
3. **Visualize** — explore day-of-week patterns and year-over-year comparisons
4. **Forecast** — choose a model (ARIMA/SARIMA/Prophet/etc.), set horizon, click "Run Forecast"

## Expected CSV Format
```
Date,Product,Sales,Quantity,Revenue
2024-01-01,Widget A,150,30,4500
2024-01-02,Widget B,200,40,8000
...
```

Column names are auto-detected — any date-like, product-like, and numeric columns work.

## Models

| Model | Best For |
|-------|----------|
| ARIMA | Stationary time series, short horizons |
| SARIMA | Seasonal data (monthly, quarterly) |
| Prophet | Business data with holidays/trends |
| Exp. Smoothing | Smooth trends with seasonality |
| Moving Avg | Quick baseline estimate |

## Project Structure
```
demand-forecasting-tool/
├── app.py                  # Flask backend + forecasting logic
├── requirements.txt        # Python dependencies
├── README.md
├── templates/
│   └── index.html          # Main UI
└── static/
    ├── css/style.css       # Styles
    └── js/app.js           # Frontend logic + Plotly charts
```
