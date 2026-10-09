import { createStaticApi } from './staticApi.ts';

// Exposes the in-browser backend to the page (web/mmde-phase1.js picks it up when no server is configured).
(window as unknown as { MMDE_STATIC: { create: typeof createStaticApi } }).MMDE_STATIC = { create: createStaticApi };
