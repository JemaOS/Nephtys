import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // Timeouts - generous for stability
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  
  // Test discovery
  testDir: './test',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/*.test.ts', '**/*.spec.js'],
  
  // Parallelization
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  
  // Fail CI builds only if there are failures
  forbidOnly: !!process.env.CI,
  
  // Retry failed tests
  retries: process.env.CI ? 2 : 1,
  
  // Reporters - multiple for different needs
  reporter: [
    ['html', { 
      outputFolder: 'playwright-report',
      open: 'never',
    }],
    ['list'],
    ['json', { outputFile: 'playwright-results.json' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
  ],
  
  // Test artifacts
  outputDir: 'test-results',
  
  // Shared settings
  use: {
    baseURL: 'http://localhost:5173',
    
    // Tracing and debugging
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
    
    // Timeouts
    actionTimeout: 10000,
    navigationTimeout: 30000,
    
    // Locale and timezone
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    
    // Permissions
    permissions: ['geolocation', 'notifications'],
    
    // Network idle detection
    serviceWorkers: 'block',
  },
  
  // Projects - optimized for stability and coverage
  projects: [
    // Chromium - Primary browser (most stable)
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          args: [
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--no-first-run',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
          ]
        },
      },
      retries: 2,
      timeout: 90000,
    },
  ],
  
  // Web server - with extended timeout for stability
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 300000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
