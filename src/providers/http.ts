/**
 * Request headers for polite API clients. A server sends a descriptive User-Agent (MusicBrainz and Wikipedia ask for one). A browser cannot,
 * and a custom header would force a CORS preflight that several services answer with 403, so an empty userAgent means "send no custom headers".
 */
export const uaHeaders = (userAgent: string | null | undefined, extra: Record<string, string> = {}): Record<string, string> => ({
  ...extra,
  ...(userAgent ? { 'User-Agent': userAgent } : {}),
});
