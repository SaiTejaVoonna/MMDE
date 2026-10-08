import slime from '../../data/seeds/slime.sample.json';
import type { SeedFile } from '../providers/curated.ts';
import { createBrowserApi } from './browserApi.ts';
import { createServerApi } from './serverApi.ts';
// @ts-ignore plain JS module
import { mountUI } from './ui.js';

// Entry point for the single-file bundle (web/mmde.js). Works from file:// (double-click index.html),
// from any static host, or served by the optional Node server (then it uses the server API).
async function start() {
  const root = document.getElementById('app')!;
  let api = createBrowserApi({ seeds: [slime as unknown as SeedFile] });
  // Public deploy-time setting from web/config.js (never a secret): '' = same origin as this page.
  const base = String((globalThis as { MMDE_CONFIG?: { apiBaseUrl?: string } }).MMDE_CONFIG?.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (location.protocol.startsWith('http')) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok && (await r.json()).ok) api = createServerApi(base);
    } catch { /* no reachable backend: stay in direct-browser mode */ }
  }
  mountUI(root, api);
}
void start();
