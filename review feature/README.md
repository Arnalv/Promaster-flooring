# Angi Reviews Widget

Automated Angi (HomeAdvisor) reviews widget. Captures reviews as images and serves them via a Flask widget with auto-refresh every 24 hours.

## Files

| File | Purpose |
|------|---------|
| `reviews_widget_server_v2.py` | Flask widget server (port 5555) — run this |
| `capture_reviews_smart.py` | Playwright-based review capture script |
| `requirements.txt` | Python dependencies |
| `_reviews_images/` | Generated folder — stores review screenshots |
| `dev/` | Development/debug tools (not needed in production) |

## Quick Start

### 1. Install dependencies (one-time)
```powershell
cd "review feature"
pip install -r requirements.txt
playwright install chromium
```

### 2. Activate virtual environment
```powershell
.\venv\Scripts\Activate.ps1
```
Or create a new one:
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install chromium
```

### 3. Run the widget server (starts capture + auto-refresh)
```powershell
$env:PYTHONIOENCODING='utf-8'
python reviews_widget_server_v2.py
```

The server will:
- Run an initial review capture on startup
- Start serving the widget at http://localhost:5555/
- Re-capture every 24 hours automatically

### 4. Open in browser
```
http://localhost:5555/
```

## Manual Capture (if needed)

```powershell
$env:PYTHONIOENCODING='utf-8'
python capture_reviews_smart.py "https://www.homeadvisor.com/rated.PromasterFloors.96522923.html#reviews" True
```

- `True` = headless mode (no browser window)
- `False` = visible browser (useful for debugging)

## Configuration

Edit the URL in `reviews_widget_server_v2.py`:
```python
ANGI_URL = "https://www.homeadvisor.com/rated.YOUR_COMPANY_ID.html"
```

Change port (default 5555) in the last line:
```python
app.run(host="127.0.0.1", port=5555, ...)
```

Change refresh interval in `run_capture_loop()` (default 24h):
```python
time.sleep(86400)  # seconds
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Widget HTML page |
| `GET /api/summary` | JSON with rating, review count |
| `GET /api/images` | JSON list of captured review images |
| `GET /image/{filename}` | Serve individual review PNG |

## Embedding in Your Website

### Iframe
```html
<iframe src="http://your-server:5555/" width="100%" height="1200" frameborder="0"></iframe>
```

### API
```javascript
fetch('http://your-server:5555/api/images')
  .then(r => r.json())
  .then(data => console.log(data.images));
```

## Troubleshooting

- **Blank page / "Just a moment"**: Cloudflare blocking the capture. Run with `False` (headful) to solve manually, or the stealth mode should handle it automatically.
- **No images**: Check `_reviews_images/` folder exists and has PNG files.
- **Port conflict**: Change `port=5555` in the last line.

## Dev Tools

The `dev/` folder contains inspection scripts for debugging:
- `find_selectors.py` — Scans page for working CSS selectors
- `inspect_page.py` — Opens browser to inspect page structure

These are not needed in production.
