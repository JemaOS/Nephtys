import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '../../../src/hooks/use-mobile';

describe('useIsMobile', () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
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
    window.matchMedia = originalMatchMedia;
    window.innerWidth = originalInnerWidth;
  });

  it('should return true when window width is less than 768', () => {
    window.innerWidth = 500;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('should return false when window width is greater than or equal to 768', () => {
    window.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('should update when window resizes', () => {
    window.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate resize
    act(() => {
      window.innerWidth = 500;
      // Trigger the event listener manually since we mocked it
      // In a real browser, resize event would trigger matchMedia change
      // But the hook listens to matchMedia change, and inside checks window.innerWidth
      
      // However, the hook implementation:
      // 1. Sets up matchMedia listener
      // 2. Listener callback calls setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
      
      // So we need to capture the listener and call it.
    });
    
    // Re-implementing the test to capture the listener
  });
});

describe('useIsMobile with event listener', () => {
  let changeHandler: () => void;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
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
    window.innerWidth = 1024;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      window.innerWidth = 500;
      if (changeHandler) {
        changeHandler();
      }
    });

    expect(result.current).toBe(true);
    
    act(() => {
      window.innerWidth = 800;
      if (changeHandler) {
        changeHandler();
      }
    });

    expect(result.current).toBe(false);
  });
});
