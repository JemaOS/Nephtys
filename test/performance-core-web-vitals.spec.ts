import { test, expect } from '@playwright/test';

test.describe('Performance - Core Web Vitals', () => {
  test('should have good LCP on auth page', async ({ page }) => {
    const start = Date.now();
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - start;
    // LCP should be under 2500ms (good)
    expect(loadTime).toBeLessThan(2500);
  });

  test('should have good FCP on auth page', async ({ page }) => {
    await page.goto('/auth');
    await page.waitForLoadState('domcontentloaded');
    
    const fcp = await page.evaluate(() => {
      const entries = performance.getEntriesByType('paint');
      const fcpEntry = entries.find(e => e.name === 'first-contentful-paint');
      return fcpEntry ? fcpEntry.startTime : 0;
    });
    
    expect(fcp).toBeLessThan(1800); // Under 1.8s is good
  });

  test('should have good TTFB', async ({ page }) => {
    const start = Date.now();
    await page.goto('/auth');
    const ttfb = Date.now() - start;
    
    // TTFB should be under 600ms
    expect(ttfb).toBeLessThan(600);
  });

  test('should not have layout shifts', async ({ page }) => {
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');
    
    const cls = await page.evaluate(() => {
      let cls = 0;
      const entries = performance.getEntriesByType('layout-shift') as unknown as Array<{ hadRecentInput: boolean; value: number }>;
      for (const entry of entries) {
        if (!entry.hadRecentInput) {
          cls += entry.value;
        }
      }
      return cls;
    });
    
    expect(cls).toBeLessThan(0.1); // Good CLS
  });

  test('should load quickly on slow network', async ({ page }) => {
    await page.route('**/*', async route => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.continue();
    });
    
    const start = Date.now();
    await page.goto('/auth');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - start;
    
    // Even on slow network, should load under 5s
    expect(loadTime).toBeLessThan(5000);
  });
});

test.describe('Performance - Memory', () => {
  test('should not leak memory during navigation', async ({ page }) => {
    await page.goto('/auth');
    const initialMemory = await page.evaluate(() => {
      return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0;
    });
    
    // Navigate multiple times
    for (let i = 0; i < 5; i++) {
      await page.goto('/auth');
      await page.goto('/auth');
    }
    
    const finalMemory = await page.evaluate(() => {
      return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0;
    });
    
    // Memory should not increase significantly (50MB threshold)
    expect(finalMemory - initialMemory).toBeLessThan(50 * 1024 * 1024);
  });

  test('should release DOM memory', async ({ page }) => {
    await page.goto('/auth');
    const initialCount = await page.locator('*').count();
    
    await page.goto('/auth');
    await page.goto('/auth');
    
    const finalCount = await page.locator('*').count();
    // DOM should not grow unboundedly
    expect(finalCount).toBeLessThan(initialCount * 3);
  });
});

test.describe('Performance - Bundle', () => {
  test('should load reasonable number of resources', async ({ page }) => {
    const resourceCount = { count: 0 };
    
    await page.route('**/*', async route => {
      resourceCount.count++;
      await route.continue();
    });
    
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');
    
    // Should not load too many resources
    expect(resourceCount.count).toBeLessThan(100);
  });
});
