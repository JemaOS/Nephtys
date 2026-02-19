import '@testing-library/jest-dom'

// Mock ResizeObserver for all tests
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserver;
