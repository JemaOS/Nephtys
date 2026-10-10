import baseConfig from './playwright.config';

// Config QA temporaire : désactive le mur d'abonnement via flag de build et
// pointe le mode privé sur un relais local. Usage test uniquement.
const base = baseConfig as any;

export default {
  ...base,
  testMatch: '**/qa-smoke.spec.ts',
  webServer: {
    ...base.webServer,
    reuseExistingServer: false,
    env: {
      VITE_DISABLE_SUBSCRIPTION_GUARD: '1',
      VITE_RELAY_URL: 'ws://127.0.0.1:8098',
    },
  },
  use: {
    ...base.use,
    actionTimeout: 30000,
    navigationTimeout: 60000,
  },
};
