// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Instrumentation performance ZÉRO-DÉPENDANCE (Web Vitals + long tasks + FPS).
 *
 * Objectif : disposer d'un **baseline mesuré** avant toute optimisation
 * (sinon on optimise « à l'aveugle »). Exposé sur `window.__nephtysPerf`.
 *
 * Mesures :
 *   • LCP  (largest-contentful-paint)
 *   • CLS  (layout-shift, hors interactions récentes)
 *   • INP  (plus longue durée d'événement, seuil 40 ms)
 *   • TTFB (responseStart de la navigation)
 *   • long tasks (compte + durée cumulée)
 *   • FPS échantillonné (1 s)
 *
 * Tout est encapsulé : si une API n'existe pas (jsdom, vieux navigateur), on
 * ignore silencieusement — jamais d'exception.
 */

export interface PerfSnapshot {
  lcp: number;
  cls: number;
  inp: number;
  ttfb: number;
  longTasks: number;
  longTasksMs: number;
  fps: number | null;
  memMB: number | null;
  at: number;
}

const state = {
  lcp: 0,
  cls: 0,
  inp: 0,
  ttfb: 0,
  longTasks: 0,
  longTasksMs: 0,
  fps: null as number | null,
};

function observe(type: string, cb: (entries: PerformanceEntryList) => void, opts?: object): void {
  try {
    if (typeof PerformanceObserver === 'undefined') return;
    const po = new PerformanceObserver(list => cb(list.getEntries()));
    po.observe({ type, buffered: true, ...(opts ?? {}) } as PerformanceObserverInit);
  } catch {
    // type non supporté → ignoré
  }
}

export function getPerfSnapshot(): PerfSnapshot {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    ...state,
    memMB: mem ? Math.round(mem.usedJSHeapSize / 1_048_576) : null,
    at: Date.now(),
  };
}

export function reportPerf(): PerfSnapshot {
  const snap = getPerfSnapshot();
  console.info('[perf]', snap);
  return snap;
}

export function initPerfMetrics(): void {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return;

  // LCP
  observe('largest-contentful-paint', entries => {
    const last = entries.at(-1) as PerformanceEntry | undefined;
    if (last) state.lcp = Math.round(last.startTime);
  });

  // CLS
  observe('layout-shift', entries => {
    for (const e of entries as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
      if (!e.hadRecentInput) state.cls += e.value;
    }
  });

  // INP (événements longs)
  observe(
    'event',
    entries => {
      for (const e of entries as Array<PerformanceEntry & { duration: number }>) {
        if (e.duration > state.inp) state.inp = Math.round(e.duration);
      }
    },
    { durationThreshold: 40 },
  );

  // Long tasks
  observe('longtask', entries => {
    state.longTasks += entries.length;
    for (const e of entries) state.longTasksMs += Math.round(e.duration);
  });

  // TTFB
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) state.ttfb = Math.round(nav.responseStart);
  } catch {
    // ignore
  }

  // FPS (échantillon 1 s)
  try {
    let frames = 0;
    const t0 = performance.now();
    const loop = () => {
      frames++;
      if (performance.now() - t0 < 1000) {
        requestAnimationFrame(loop);
      } else {
        state.fps = frames;
      }
    };
    requestAnimationFrame(loop);
  } catch {
    // ignore
  }

  (window as unknown as { __nephtysPerf?: unknown }).__nephtysPerf = {
    get: getPerfSnapshot,
    report: reportPerf,
  };

  // Rapport automatique 2,5 s après le load.
  window.addEventListener('load', () => setTimeout(reportPerf, 2500), { once: true });
}
