// Security headers (Nov 11, 2026). Two layers:
//   harden(res): every answer the Worker gives. Browsers are told to use https only for a year, never to guess a file's
//     type, and (for pages that set no policy of their own) never to load plugins, obey an injected <base>, or let another
//     site put the page in a frame.
//   SITE_CSP: the public website's pages (index.js withSiteHeaders). It names everything those pages load: our own files,
//     Google Fonts, Cloudflare's visitor counter (Web Analytics, which Cloudflare adds to each page), and for the map
//     MapLibre from cdnjs with OpenFreeMap tiles. Anything else a page tries to load is
//     refused by the browser, so a stray script can't call out. The pages' scripts and styles are written into the page,
//     so 'unsafe-inline' stays. tools/phonecheck.mjs serves the pages with this same policy and fails on any refusal, so a
//     page that starts loading from somewhere new is caught before it goes live.
// The client app keeps its own, stricter policy (app.js CSP).
export const HSTS = 'max-age=31536000; includeSubDomains';
export const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "media-src 'self' blob: data:",
  "connect-src 'self' https://tiles.openfreemap.org https://cloudflareinsights.com",
  "worker-src blob:", "child-src blob:", "manifest-src 'self'",
  "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'"
].join('; ');
// The draft home page (public/draft/, Nov 13 2026: Christopher's "Do all", a draft to look at before anything changes)
// shows the day piece in a frame from this same site, which the site policy refuses (frames fall back to child-src). Only
// the draft's pages get that one extra line, and they are never indexed. The live pages keep SITE_CSP exactly.
export const DRAFT_CSP = SITE_CSP + "; frame-src 'self'";
export const isDraft = pathname => /^\/draft(\/|$)/.test(pathname);
export function draftPolicy(res) {
  const sets = [['x-robots-tag', 'noindex, nofollow']];
  if (isHtml(res)) sets.push(['content-security-policy', DRAFT_CSP]);
  return put(res, sets);
}
// Pages with no policy of their own. One that already refuses every frame (x-frame-options: DENY) keeps refusing them.
export const BASE_CSP = "base-uri 'self'; object-src 'none'; frame-ancestors 'self'";
export const BASE_CSP_NOFRAME = "base-uri 'self'; object-src 'none'; frame-ancestors 'none'";
// What a page that asked for nothing may not use.
export const PERMISSIONS = 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()';

const isHtml = res => /^text\/html\b/i.test(res.headers.get('content-type') || '');

function put(res, sets) {
  try { for (const [k, v] of sets) res.headers.set(k, v); return res; }
  catch (e) { const out = new Response(res.body, res); for (const [k, v] of sets) out.headers.set(k, v); return out; }
}

export function harden(res) {
  // a WebSocket handshake (Max's live calls) is passed through untouched
  if (!res || res.status === 101 || res.webSocket) return res;
  const sets = [['strict-transport-security', HSTS]];
  if (!res.headers.has('x-content-type-options')) sets.push(['x-content-type-options', 'nosniff']);
  if (isHtml(res) && !res.headers.has('content-security-policy')) sets.push(['content-security-policy', /deny/i.test(res.headers.get('x-frame-options') || '') ? BASE_CSP_NOFRAME : BASE_CSP]);
  return put(res, sets);
}

// The public pages: the full policy, on pages only (a picture or a script file needs none).
export function sitePolicy(res) {
  if (!isHtml(res)) return res;
  return put(res, [['content-security-policy', SITE_CSP], ['permissions-policy', PERMISSIONS]]);
}
