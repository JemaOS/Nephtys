import { describe, it, expect } from 'vitest';
import { initPerfMetrics, getPerfSnapshot } from './perfMetrics';

describe('perfMetrics (instrumentation zéro-dépendance)', () => {
  it('initPerfMetrics ne lève jamais et expose un snapshot valide', () => {
    expect(() => initPerfMetrics()).not.toThrow();
    const s = getPerfSnapshot();
    expect(typeof s.lcp).toBe('number');
    expect(typeof s.cls).toBe('number');
    expect(typeof s.inp).toBe('number');
    expect(typeof s.longTasks).toBe('number');
    expect(typeof s.longTasksMs).toBe('number');
    expect(typeof s.at).toBe('number');
    expect(s.fps === null || typeof s.fps === 'number').toBe(true);
  });

  it('expose window.__nephtysPerf.get()', () => {
    initPerfMetrics();
    const api = (globalThis as any).window?.__nephtysPerf ?? (globalThis as any).__nephtysPerf;
    expect(typeof api?.get).toBe('function');
    expect(typeof api.get().at).toBe('number');
  });
});
