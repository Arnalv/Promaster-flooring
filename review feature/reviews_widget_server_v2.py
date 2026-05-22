#!/usr/bin/env python3
"""
Enhanced Flask widget server for Angi reviews.
- Shows summary card (rating) + Write Review button
- Heading is "Angi Reviews" link to Angi page
- Auto-refresh every 24h (background thread)
- No manual refresh button

Usage:
  python reviews_widget_server_v2.py

Open: http://localhost:5555/
"""

from flask import Flask, render_template_string, jsonify, send_from_directory
from pathlib import Path
import os, json, asyncio, threading, logging, time
from datetime import datetime, timedelta

from capture_reviews_smart import capture_smart

BASE_DIR = Path(__file__).resolve().parent
IMAGES_DIR = BASE_DIR / "_reviews_images"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

ANGI_URL = "https://www.homeadvisor.com/rated.PromasterFloors.96522923.html"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

def load_summary():
    summary_path = IMAGES_DIR / "summary.json"
    if summary_path.exists():
        try:
            with open(summary_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading summary: {e}")
    return None

def run_capture_loop():
    """Background thread: capture immediately, then every 24h."""
    logger.info("Auto-refresh thread started")
    while True:
        try:
            logger.info("Starting review capture...")
            asyncio.run(capture_smart(ANGI_URL + "#reviews", headless=True))
            logger.info("Capture completed successfully")
        except Exception as e:
            logger.error(f"Capture failed: {e}")
        next_run = datetime.now() + timedelta(hours=24)
        logger.info(f"Next capture: {next_run.strftime('%Y-%m-%d %H:%M:%S')}")
        time.sleep(86400)

app = Flask(__name__)

# Modern refined widget template
WIDGET_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Angi Reviews Widget</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
        
        .container {
            max-width: 1000px;
            margin: 0 auto;
        }
        
        .header {
            background: white;
            padding: 24px;
            border-radius: 12px 12px 0 0;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        
        .header h1 {
            font-size: 28px;
            font-weight: 700;
            margin: 0;
        }
        
        .header h1 a {
            color: #e74c3c;
            text-decoration: none;
            transition: color 0.2s;
        }
        
        .header h1 a:hover {
            color: #c0392b;
            text-decoration: underline;
        }
        
        .header-info {
            font-size: 13px;
            color: #999;
        }
        
        .widget-body {
            background: white;
            border-radius: 0 0 12px 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            overflow: hidden;
        }
        
        /* Summary card section */
        .summary-section {
            padding: 24px 32px;
            border-bottom: 2px solid #f0f0f0;
            background: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .rating-group {
            display: flex;
            align-items: baseline;
            gap: 12px;
        }
        
        .rating-number {
            font-size: 42px;
            font-weight: 700;
            color: #111;
            line-height: 1;
        }
        
        .rating-stars {
            font-size: 24px;
            color: #ffc107;
            letter-spacing: 2px;
        }
        
        .review-count {
            font-size: 14px;
            color: #666;
            font-weight: 500;
        }
        
        .write-review-btn {
            padding: 14px 40px;
            background: white;
            color: #5b5fd9;
            border: 2px solid #5b5fd9;
            border-radius: 24px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            text-decoration: none;
            display: inline-block;
        }
        
        .write-review-btn:hover {
            background: #5b5fd9;
            color: white;
        }
        
        /* Reviews scroll area */
        .reviews-scroll {
            height: 900px;
            overflow-y: auto;
            position: relative;
        }
        
        .reviews-scroll::-webkit-scrollbar {
            width: 10px;
        }
        
        .reviews-scroll::-webkit-scrollbar-track {
            background: #f1f1f1;
        }
        
        .reviews-scroll::-webkit-scrollbar-thumb {
            background: #bbb;
            border-radius: 5px;
        }
        
        .reviews-scroll::-webkit-scrollbar-thumb:hover {
            background: #888;
        }
        
        .image-wrapper {
            padding: 16px;
            border-bottom: 1px solid #f0f0f0;
            background: white;
        }
        
        .image-wrapper img {
            display: block;
            width: 100%;
            height: auto;
            border-radius: 6px;
            background: #fafafa;
        }
        
        .empty-state {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #999;
            font-size: 16px;
            text-align: center;
            padding: 40px;
        }
        
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            font-size: 16px;
            color: #666;
        }
        
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #e74c3c;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin-right: 12px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .footer {
            background: #fafafa;
            padding: 16px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #999;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <!-- HomeAdvisor Powered by Angi Logo -->
            <svg viewBox="0 0 320 80" width="220" height="55" style="margin-right: auto;">
                <!-- HomeAdvisor Logo -->
                <text x="10" y="35" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#003366">HomeAdvisor</text>
                <text x="10" y="55" font-family="Arial, sans-serif" font-size="11" fill="#666">Powered by Angi</text>
            </svg>
            <div class="header-info" id="status">Loading...</div>
        </div>
        
        <div class="widget-body">
            <!-- Summary Section (Overall Rating + Write Review Button) -->
            <div class="summary-section" id="summary-section">
                <div class="rating-group">
                    <span class="rating-number" id="rating-number">--</span>
                    <span class="rating-stars" id="star-display">?????</span>
                    <span class="review-count" id="review-count">-- Reviews</span>
                </div>
                <a class="write-review-btn" href="{{ angi_url }}" target="_blank" rel="noopener noreferrer">Write a review</a>
            </div>
            
            <!-- Reviews Scroll Area -->
            <div class="reviews-scroll" id="reviews-scroll">
                <div class="loading">
                    <div class="spinner"></div>
                    <span>Loading reviews...</span>
                </div>
            </div>
        </div>
        
        <div class="footer">
            Auto-updates every 24 hours · Reviews from Angi (formerly HomeAdvisor)
        </div>
    </div>
    
    <script>
        async function loadSummary() {
            try {
                const resp = await fetch('/api/summary');
                const data = await resp.json();
                if (data && data.rating) {
                    document.getElementById('rating-number').textContent = data.rating;
                    const fullStars = Math.round(data.rating);
                    document.getElementById('star-display').textContent = '\u2605'.repeat(fullStars) + '\u2606'.repeat(5 - fullStars);
                    if (data.review_count) {
                        document.getElementById('review-count').textContent = data.review_count + ' Reviews';
                    }
                }
            } catch (e) {}
        }
        
        async function loadReviews() {
            try {
                const response = await fetch('/api/images');
                const data = await response.json();
                
                const scroll = document.getElementById('reviews-scroll');
                const status = document.getElementById('status');
                
                if (!data.images || data.images.length === 0) {
                    scroll.innerHTML = '<div class="empty-state"><p>No reviews captured yet.<br><small>Run the capture script first</small></p></div>';
                    status.textContent = '0 reviews';
                    return;
                }
                
                let html = '';
                const reviewImages = data.images.filter(img => img.name.startsWith('review_'));
                reviewImages.forEach(img => {
                    html += '<div class="image-wrapper"><img src="' + img.url + '" alt="' + img.name + '"></div>';
                });
                
                scroll.innerHTML = html || '<div class="empty-state"><p>No reviews captured yet</p></div>';
                status.textContent = reviewImages.length + ' review' + (reviewImages.length !== 1 ? 's' : '');
            } catch (err) {
                document.getElementById('reviews-scroll').innerHTML = '<div class="empty-state"><p>Error loading reviews: ' + err.message + '</p></div>';
            }
        }
        
        loadSummary();
        loadReviews();
        setInterval(loadReviews, 5 * 60 * 1000);
    </script>
</body>
</html>
"""

@app.route("/")
def widget():
    """Serve the widget HTML."""
    return render_template_string(WIDGET_TEMPLATE, angi_url=ANGI_URL)

@app.route("/api/summary")
def api_summary():
    """Return summary data from summary.json."""
    summary = load_summary()
    if summary:
        return jsonify(summary)
    return jsonify({"rating": None, "review_count": None, "breakdown": {}})

@app.route("/api/images")
def api_images():
    """Return list of images in _reviews_images/ folder."""
    images = []
    if IMAGES_DIR.exists():
        for f in sorted(IMAGES_DIR.glob("*.png")):
            images.append({
                "name": f.name,
                "url": f"/image/{f.name}",
            })
    return jsonify({"images": images})

@app.route("//image/<filename>")
def serve_image(filename):
    """Serve image from _reviews_images/ folder."""
    if ".." in filename or "/" in filename:
        return "Invalid filename", 400
    filepath = IMAGES_DIR / filename
    if not filepath.exists():
        return "Not found", 404
    try:
        return send_from_directory(str(IMAGES_DIR), filename)
    except Exception as e:
        print(f"Error serving {filename}: {e}")
        return "Internal Server Error", 500

if __name__ == "__main__":
    print(__doc__)
    print(f"Angi URL: {ANGI_URL}")
    print("Starting on http://localhost:5555/")
    print("Auto-refresh: initial capture now, then every 24h")
    print("Press Ctrl+C to stop\n")
    
    t = threading.Thread(target=run_capture_loop, daemon=True)
    t.start()
    
    app.run(host="127.0.0.1", port=5555, debug=False, use_reloader=False)

