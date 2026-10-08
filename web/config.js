// Deploy-time frontend settings. PUBLIC values only: this file is served to every visitor.
// NEVER put a TMDB token, API key or any other secret here (secrets live only in the server's environment).
//
// apiBaseUrl:
//   ""                                  -> same origin as this page (local dev, or Railway serving the site itself)
//   "https://<your-app>.up.railway.app" -> a separately deployed MMDE backend (e.g. when the page is on GitHub Pages)
// The publish-pages workflow overwrites this file from the repository variable MMDE_API_BASE_URL.
window.MMDE_CONFIG = { apiBaseUrl: "" };
