import { mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { App } from "../webview-ui/src/App";
import { motionReduced } from "../webview-ui/src/motion";
const act = (React as any).act;
async function run() {
  document.documentElement.dataset.reducedMotion = 'true';
  const root = createRoot(mountPoint());
  await act(() => root.render(<App />));
  assert.equal(document.documentElement.dataset.reducedMotion, 'true', 'initial host preference survives until config');
  for (const reduceMotion of [undefined, false, true, undefined, true, false, undefined]) {
    await act(() => window.dispatchEvent({ type: 'message', data: { type: 'config', config: {
      model: 'test', hasToken: false, proxyUrl: '', reduceMotion,
      coach: { configured: false, name: '', personality: '' },
    } } } as any));
    assert.equal(document.documentElement.dataset.reducedMotion, reduceMotion === undefined ? undefined : String(reduceMotion), 'live host setting applied');
    for (const os of [true, false]) assert.equal(motionReduced(document, { matchMedia: () => ({ matches: os }) } as any), reduceMotion ?? os);
  }
  await act(() => root.unmount());
  console.log('reduced-motion live App updates PASS');
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
