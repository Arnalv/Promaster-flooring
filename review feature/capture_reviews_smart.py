#!/usr/bin/env python3
"""
Smart capture: Gets both the reviews summary card + clean reviews pages.
Uses stealth Playwright to bypass Cloudflare.

Usage:
  python capture_reviews_smart.py "https://www.homeadvisor.com/rated.PromasterFloors.96522923.html"
"""

import sys, os, asyncio, json
from pathlib import Path

try:
    from playwright.async_api import async_playwright
    from PIL import Image
except ImportError as e:
    print(f"ERROR: Missing dependency: {e}")
    print("Install with: pip install playwright pillow")
    sys.exit(1)

BASE_DIR = Path(__file__).resolve().parent
IMAGES_DIR = BASE_DIR / "_reviews_images"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

STEALTH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
]

STEALTH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

async def capture_smart(url: str, headless: bool = True):
    """Capture summary + clean reviews pages."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless, args=STEALTH_ARGS)
        context = await browser.new_context(
            user_agent=STEALTH_UA,
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        page = await context.new_page()
        await page.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )
        
        try:
            # Clear old captured images from previous runs
            for f in IMAGES_DIR.glob("*.png"):
                f.unlink()
            summary_path = IMAGES_DIR / "summary.json"
            if summary_path.exists():
                summary_path.unlink()
            print(f"Opening {url} ...")
            await page.goto(url, timeout=30000, wait_until="domcontentloaded")
            await page.wait_for_timeout(4000)
            
            # Scroll near reviews to trigger lazy load
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(2000)
            await page.evaluate("window.scrollTo(0, 0)")
            await page.wait_for_timeout(1000)
            
            # === EXTRACT SUMMARY DATA ===
            print("\nExtracting summary data...")
            summary_data = await extract_summary(page)
            if summary_data:
                out_path = IMAGES_DIR / "summary.json"
                with open(out_path, 'w') as f:
                    json.dump(summary_data, f, indent=2)
                print(f"  Saved to {out_path.name}")
            else:
                print("  Could not extract summary data")
            
            # === CAPTURE INDIVIDUAL REVIEW CARDS ===
            print("\nCapturing individual review cards...")
            
            page_num = 1
            while True:
                print(f"\n  [Page {page_num}] Loading...")
                
                # Navigate to page if not first
                if page_num > 1:
                    clicked = False
                    all_btns = await page.locator("button").all()
                    for btn in all_btns:
                        txt = (await btn.text_content() or "").strip()
                        if txt == str(page_num):
                            await btn.click(timeout=5000)
                            await page.wait_for_timeout(2000)
                            clicked = True
                            break
                    if not clicked:
                        print(f"    Page {page_num} button not found, stopping pagination")
                        break
                
                # Wait for review cards to render
                await page.wait_for_timeout(1000)
                
                # Get all review cards on current page
                cards = await page.locator('[data-testid="review-card"]').all()
                if not cards:
                    print(f"    No review cards found on page {page_num}")
                    if page_num == 1:
                        print("    Trying alternative selector...")
                        cards = await page.locator('[class*="ReviewCard_reviewCardRoot"]').all()
                    if not cards:
                        break
                
                print(f"    Found {len(cards)} review cards")
                
                # Screenshot each card individually
                for i, card in enumerate(cards):
                    card_index = (page_num - 1) * 25 + i + 1
                    out_path = IMAGES_DIR / f"review_{card_index:03d}.png"
                    try:
                        await card.screenshot(path=str(out_path))
                        print(f"    Saved review_{card_index:03d}.png")
                    except Exception as e:
                        print(f"    Error capturing review {card_index}: {e}")
                
                page_num += 1
                
                # Safety limit
                if page_num > 10:
                    break
            
            print(f"\nAll done. Images in: {IMAGES_DIR}/")
        
        finally:
            await browser.close()


async def extract_summary(page):
    """Extract rating, review count, and star breakdown from page DOM."""
    try:
        data = await page.evaluate("""
            () => {
                const result = {};
                
                // Rating number
                const ratingEl = document.querySelector('[class*="ReviewsBreakdown_overallRatingNumber"]');
                if (ratingEl) {
                    result.rating = parseFloat(ratingEl.textContent.trim());
                }
                
                // Review count
                const countEl = document.querySelector('[class*="ReviewsBreakdown_reviewCount"]');
                if (countEl) {
                    const m = countEl.textContent.trim().match(/(\\d+)/);
                    if (m) result.review_count = parseInt(m[1]);
                }
                
                // Star breakdown
                result.breakdown = {};
                const rows = document.querySelectorAll('[class*="ratingDistribution"]');
                rows.forEach(row => {
                    const label = row.querySelector('[class*="ratingDistributionNumber"]');
                    const bar = row.querySelector('[class*="ratingDistributionValue"]');
                    if (label && bar) {
                        const star = label.textContent.trim().replace(/[^\\d]/g, '');
                        const pct = bar.textContent.trim().replace(/[^\\d]/g, '');
                        if (star && pct) {
                            result.breakdown[star + '_star'] = parseInt(pct);
                        }
                    }
                });
                
                return result;
            }
        """)
        
        if data and (data.get('rating') or data.get('review_count')):
            print(f"  Rating: {data.get('rating', 'N/A')}")
            print(f"  Reviews: {data.get('review_count', 'N/A')}")
            if data.get('breakdown'):
                print(f"  Breakdown: {data['breakdown']}")
            return data
    except Exception as e:
        print(f"  Error extracting summary: {e}")
    
    return None

def crop_image(src: str, dst: str, top_crop_percent=0.12, bottom_crop_percent=0.02):
    """
    Open PNG, crop top (remove nav tabs) and minimal bottom, save.
    
    Args:
      src: source PNG path
      dst: destination PNG path
      top_crop_percent: % of image height to crop from top (removes "About Photos Reviews" nav)
      bottom_crop_percent: % to crop from bottom (safety margin)
    """
    try:
        img = Image.open(src)
        width, height = img.size
        
        # Calculate crop box: (left, top, right, bottom)
        left = 0
        top = int(height * top_crop_percent)  # Crop ~12% from top to remove nav
        right = width
        bottom = int(height * (1 - bottom_crop_percent))  # Crop ~2% from bottom
        
        # Ensure valid crop
        if top >= bottom:
            print(f"    Warning: crop invalid, keeping original")
            img.save(dst)
            return
        
        cropped = img.crop((left, top, right, bottom))
        cropped.save(dst, "PNG")
        print(f"    Cropped: removed top {int(height * top_crop_percent)}px, bottom {int(height * bottom_crop_percent)}px")
    except Exception as e:
        print(f"    Crop failed: {e}, saving original")
        Image.open(src).save(dst, "PNG")

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.homeadvisor.com/rated.PromasterFloors.96522923.html"
    headless = sys.argv[2].lower() != "false" if len(sys.argv) > 2 else True
    
    print(f"Mode: {'headless' if headless else 'headful (interactive)'}")
    print()
    
    asyncio.run(capture_smart(url, headless=headless))

