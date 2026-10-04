import "fake-indexeddb/auto";

// capture.ts reads window/navigator for platform detection; Node 22 has navigator but not window.
const g = globalThis as Record<string, unknown>;
if (!("window" in g)) g.window = globalThis;
