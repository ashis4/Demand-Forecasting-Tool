from flask import Flask, render_template, request, jsonify
import pandas as pd
import numpy as np
import json
import warnings
warnings.filterwarnings('ignore')

app = Flask(__name__)

# ─── helpers ────────────────────────────────────────────────────────────────

def detect_columns(df):
    """Auto-detect date, product, sales/qty/revenue columns."""
    col_map = {}
    for col in df.columns:
        cl = col.lower().strip()
        if any(k in cl for k in ['date','time','month','week','day','period']):
            col_map.setdefault('date', col)
        elif any(k in cl for k in ['product','item','sku','category','name']):
            col_map.setdefault('product', col)
        elif any(k in cl for k in ['revenue','sales','amount','total','income']):
            col_map.setdefault('revenue', col)
        elif any(k in cl for k in ['quantity','qty','units','demand','volume']):
            col_map.setdefault('quantity', col)
        elif 'sales' in cl:
            col_map.setdefault('sales', col)
    return col_map


def safe_json(obj):
    if isinstance(obj, (np.integer,)): return int(obj)
    if isinstance(obj, (np.floating,)): return float(obj)
    if isinstance(obj, (np.ndarray,)): return obj.tolist()
    if pd.isna(obj): return None
    return obj


def df_to_json(df):
    return json.loads(df.to_json(orient='records', date_format='iso'))


# ─── routes ─────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/preview', methods=['POST'])
def preview():
    try:
        f = request.files.get('file')
        if not f:
            return jsonify({'error': 'No file uploaded'}), 400

        fname = f.filename.lower()
        if fname.endswith('.csv'):
            try:
                df = pd.read_csv(f, encoding='utf-8')
            except UnicodeDecodeError:
                f.seek(0)
                try:
                    df = pd.read_csv(f, encoding='latin-1')
                except:
                    f.seek(0)
                    df = pd.read_csv(f, encoding='cp1252')
        elif fname.endswith(('.xls', '.xlsx')):
            df = pd.read_excel(f)
        else:
            return jsonify({'error': 'Only CSV/Excel supported'}), 400

        col_map = detect_columns(df)

        # basic clean
        if col_map.get('date'):
            df[col_map['date']] = pd.to_datetime(df[col_map['date']], errors='coerce')

        missing = {c: int(df[c].isna().sum()) for c in df.columns}
        summary = {}
        for c in df.select_dtypes(include='number').columns:
            summary[c] = {
                'min':   safe_json(df[c].min()),
                'max':   safe_json(df[c].max()),
                'mean':  round(safe_json(df[c].mean()), 2),
                'std':   round(safe_json(df[c].std()), 2),
                'count': int(df[c].count()),
            }

        head = df.head(5).copy()
        for col in head.select_dtypes(include='datetime').columns:
            head[col] = head[col].dt.strftime('%Y-%m-%d')

        # store in session-like temp (use global for simplicity in single-user demo)
        app.config['_df'] = df
        app.config['_col_map'] = col_map

        return jsonify({
            'rows': len(df), 'cols': len(df.columns),
            'columns': list(df.columns),
            'col_map': col_map,
            'head': df_to_json(head),
            'missing': missing,
            'summary': summary,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/visualize', methods=['POST'])
def visualize():
    try:
        df: pd.DataFrame = app.config.get('_df')
        col_map: dict    = app.config.get('_col_map', {})
        if df is None:
            return jsonify({'error': 'Upload a file first'}), 400

        body = request.get_json(force=True)
        date_col    = body.get('date_col')    or col_map.get('date')
        value_col   = body.get('value_col')   or col_map.get('revenue') or col_map.get('quantity') or col_map.get('sales')
        product_col = body.get('product_col') or col_map.get('product')

        if not date_col or not value_col:
            return jsonify({'error': 'Could not detect date/value columns'}), 400

        df2 = df[[c for c in [date_col, value_col, product_col] if c]].copy()
        df2[date_col] = pd.to_datetime(df2[date_col], errors='coerce')
        df2 = df2.dropna(subset=[date_col])
        df2 = df2.sort_values(date_col)

        # ── 1. Time-series trend ──────────────────────────────────────────
        ts = df2.groupby(date_col)[value_col].sum().reset_index()
        trend_data = {
            'x': ts[date_col].dt.strftime('%Y-%m-%d').tolist(),
            'y': [safe_json(v) for v in ts[value_col]],
        }

        # ── 2. Monthly demand ────────────────────────────────────────────
        df2['_month'] = df2[date_col].dt.to_period('M').astype(str)
        monthly = df2.groupby('_month')[value_col].sum().reset_index()
        monthly_data = {
            'x': monthly['_month'].tolist(),
            'y': [safe_json(v) for v in monthly[value_col]],
        }

        # ── 3. Product-wise demand ───────────────────────────────────────
        product_data = {}
        if product_col:
            prod = df2.groupby(product_col)[value_col].sum().sort_values(ascending=False).head(10)
            product_data = {
                'labels': prod.index.tolist(),
                'values': [safe_json(v) for v in prod.values],
            }

        # ── 4. Day-of-week pattern ───────────────────────────────────────
        df2['_dow'] = df2[date_col].dt.day_name()
        dow_order = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
        dow = df2.groupby('_dow')[value_col].mean().reindex(dow_order).fillna(0)
        dow_data = {
            'labels': dow.index.tolist(),
            'values': [safe_json(v) for v in dow.values],
        }

        # ── 5. Yearly comparison ─────────────────────────────────────────
        df2['_year']  = df2[date_col].dt.year
        df2['_monthN'] = df2[date_col].dt.month
        yearly_raw = df2.groupby(['_year','_monthN'])[value_col].sum().reset_index()
        years = sorted(yearly_raw['_year'].unique().tolist())
        yearly_data = {
            'months': list(range(1,13)),
            'series': {}
        }
        for yr in years:
            ysub = yearly_raw[yearly_raw['_year']==yr].set_index('_monthN')[value_col]
            yearly_data['series'][str(yr)] = [safe_json(ysub.get(m, 0)) for m in range(1,13)]

        return jsonify({
            'trend':   trend_data,
            'monthly': monthly_data,
            'product': product_data,
            'dow':     dow_data,
            'yearly':  yearly_data,
            'value_col':   value_col,
            'date_col':    date_col,
            'product_col': product_col,
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/forecast', methods=['POST'])
def forecast():
    try:
        df: pd.DataFrame = app.config.get('_df')
        col_map: dict    = app.config.get('_col_map', {})
        if df is None:
            return jsonify({'error': 'Upload a file first'}), 400

        body = request.get_json(force=True)
        date_col  = body.get('date_col')  or col_map.get('date')
        value_col = body.get('value_col') or col_map.get('revenue') or col_map.get('quantity') or col_map.get('sales')
        model_type = body.get('model', 'arima')
        horizon    = int(body.get('horizon', 30))

        if not date_col or not value_col:
            return jsonify({'error': 'Could not detect columns'}), 400

        df2 = df[[date_col, value_col]].copy()
        df2[date_col] = pd.to_datetime(df2[date_col], errors='coerce')
        df2 = df2.dropna().sort_values(date_col)
        ts = df2.groupby(date_col)[value_col].sum()

        # Infer frequency
        idx = pd.DatetimeIndex(ts.index)
        if len(idx) > 1:
            delta = (idx[-1] - idx[0]).days / max(len(idx)-1, 1)
            freq = 'D' if delta <= 1.5 else ('W' if delta <= 8 else 'MS')
        else:
            freq = 'D'

        ts = ts.asfreq(freq, method='pad')

        hist_x = [d.strftime('%Y-%m-%d') for d in ts.index]
        hist_y = [safe_json(v) for v in ts.values]

        last_date = ts.index[-1]
        if freq == 'D':
            future_dates = [last_date + pd.Timedelta(days=i+1) for i in range(horizon)]
        elif freq == 'W':
            future_dates = [last_date + pd.Timedelta(weeks=i+1) for i in range(horizon)]
        else:
            future_dates = [last_date + pd.DateOffset(months=i+1) for i in range(horizon)]

        forecast_x = [d.strftime('%Y-%m-%d') for d in future_dates]
        forecast_y = []
        lower_y    = []
        upper_y    = []
        model_info = {}

        # ── ARIMA ──────────────────────────────────────────────────────
        if model_type in ('arima', 'sarima'):
            from statsmodels.tsa.statespace.sarimax import SARIMAX
            order = (1,1,1)
            seasonal_order = (1,1,1,12) if model_type == 'sarima' and len(ts) >= 24 else (0,0,0,0)
            mod = SARIMAX(ts, order=order, seasonal_order=seasonal_order,
                          enforce_stationarity=False, enforce_invertibility=False)
            res = mod.fit(disp=False, maxiter=200)
            pred = res.get_forecast(steps=horizon)
            forecast_y = [safe_json(v) for v in pred.predicted_mean.values]
            ci = pred.conf_int()
            lower_y = [safe_json(v) for v in ci.iloc[:,0].values]
            upper_y = [safe_json(v) for v in ci.iloc[:,1].values]
            model_info = {'aic': round(res.aic,2), 'bic': round(res.bic,2)}

        # ── Prophet ────────────────────────────────────────────────────
        elif model_type == 'prophet':
            from prophet import Prophet
            prophet_df = pd.DataFrame({'ds': ts.index, 'y': ts.values})
            m = Prophet(yearly_seasonality=True, weekly_seasonality=True, daily_seasonality=False)
            m.fit(prophet_df)
            future_df = m.make_future_dataframe(periods=horizon, freq=freq)
            forecast_df = m.predict(future_df)
            fc = forecast_df.tail(horizon)
            forecast_y = [safe_json(v) for v in fc['yhat'].values]
            lower_y    = [safe_json(v) for v in fc['yhat_lower'].values]
            upper_y    = [safe_json(v) for v in fc['yhat_upper'].values]
            model_info = {'trend_changepoints': len(m.changepoints)}

        # ── Moving Average ─────────────────────────────────────────────
        elif model_type == 'moving_avg':
            window = min(7, len(ts))
            ma = ts.rolling(window).mean().iloc[-1]
            std = ts.rolling(window).std().iloc[-1]
            noise = np.random.normal(0, std * 0.05, horizon)
            forecast_y = [safe_json(max(0, ma + n)) for n in noise]
            lower_y    = [safe_json(max(0, ma - 1.96*std)) for _ in range(horizon)]
            upper_y    = [safe_json(ma + 1.96*std) for _ in range(horizon)]
            model_info = {'window': window}

        # ── Exponential Smoothing ──────────────────────────────────────
        elif model_type == 'exp_smooth':
            from statsmodels.tsa.holtwinters import ExponentialSmoothing
            trend_t = 'add' if len(ts) >= 4 else None
            seasonal_t = 'add' if len(ts) >= 24 else None
            seasonal_p = 12 if seasonal_t else None
            mod = ExponentialSmoothing(ts, trend=trend_t, seasonal=seasonal_t, seasonal_periods=seasonal_p)
            res = mod.fit()
            preds = res.forecast(horizon)
            forecast_y = [safe_json(v) for v in preds.values]
            residuals_std = float(np.std(res.resid))
            lower_y = [safe_json(max(0, v - 1.96*residuals_std)) for v in preds.values]
            upper_y = [safe_json(v + 1.96*residuals_std) for v in preds.values]
            model_info = {'alpha': round(res.params.get('smoothing_level', 0), 3)}

        # clip negatives
        forecast_y = [max(0, v) if v is not None else 0 for v in forecast_y]
        lower_y    = [max(0, v) if v is not None else 0 for v in lower_y]

        # ── KPI stats ─────────────────────────────────────────────────
        hist_mean   = float(ts.mean())
        fc_mean     = float(np.mean(forecast_y))
        growth_pct  = round((fc_mean - hist_mean) / hist_mean * 100, 1) if hist_mean else 0
        next7_total = round(sum(forecast_y[:7]), 2)
        next30_total= round(sum(forecast_y[:30]), 2) if horizon >= 30 else round(sum(forecast_y), 2)

        return jsonify({
            'model': model_type,
            'hist_x': hist_x,
            'hist_y': hist_y,
            'forecast_x': forecast_x,
            'forecast_y': forecast_y,
            'lower_y': lower_y,
            'upper_y': upper_y,
            'model_info': model_info,
            'kpi': {
                'growth_pct':   growth_pct,
                'next7_total':  next7_total,
                'next30_total': next30_total,
                'hist_mean':    round(hist_mean, 2),
                'fc_mean':      round(fc_mean, 2),
            }
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/kpi', methods=['GET'])
def kpi():
    try:
        df: pd.DataFrame = app.config.get('_df')
        col_map: dict    = app.config.get('_col_map', {})
        if df is None:
            return jsonify({'error': 'No data'}), 400

        value_col   = col_map.get('revenue') or col_map.get('quantity') or col_map.get('sales')
        product_col = col_map.get('product')
        date_col    = col_map.get('date')

        result = {}
        if value_col:
            result['total_sales']    = safe_json(df[value_col].sum())
            result['avg_demand']     = round(safe_json(df[value_col].mean()), 2)
            result['max_val']        = safe_json(df[value_col].max())
            result['min_val']        = safe_json(df[value_col].min())

        if product_col and value_col:
            top = df.groupby(product_col)[value_col].sum().idxmax()
            result['top_product'] = str(top)
            result['num_products'] = int(df[product_col].nunique())

        if date_col:
            result['date_range'] = {
                'start': str(df[date_col].min())[:10],
                'end':   str(df[date_col].max())[:10],
            }
            result['total_days'] = (pd.to_datetime(df[date_col].max()) - pd.to_datetime(df[date_col].min())).days

        result['total_rows'] = len(df)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
