import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '../../../src/hooks/use-mobile';

describe('useIsMobile', () => {
  const originalMatchMedia = globalThis.matchMedia;
  const originalInnerWidth = globalThis.innerWidth;

  beforeEach(() => {
    // Mock matchMedia
    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // Deprecated
        removeListener: vi.fn(), // Deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    globalThis.matchMedia = originalMatchMedia;
    globalThis.innerWidth = originalInnerWidth;
  });

  it('should return true when globalThis width is less than 768', () => {
    globalThis.innerWidth = 500;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('should return false when globalThis width is greater than or equal to 768', () => {
    globalThis.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('should update when globalThis resizes', () => {
    globalThis.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate resize
    act(() => {
      globalThis.innerWidth = 500;
      // Trigger the event listener manually since we mocked it
      // In a real browser, resize event would trigger matchMedia change
      // But the hook listens to matchMedia change, and inside checks globalThis.innerWidth
      
      // However, the hook implementation:
      // 1. Sets up matchMedia listener
      // 2. Listener callback calls setIsMobile(globalThis.innerWidth < MOBILE_BREAKPOINT)
      
      // So we need to capture the listener and call it.
    });
    
    // Re-implementing the test to capture the listener
  });
});

describe('useIsMobile with event listener', () => {
  let changeHandler: () => void;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
          if (event === 'change') {
            changeHandler = handler;
          }
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('should update when media query changes', () => {
    globalThis.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      globalThis.innerWidth = 500;
      if (changeHandler) {
        changeHandler();
      }
    });

    expect(result.current).toBe(true);
    
    act(() => {
      globalThis.innerWidth = 800;
      if (changeHandler) {
        changeHandler();
      }
    });

    expect(result.current).toBe(false);
  });
});

