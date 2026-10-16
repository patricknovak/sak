// Security headers on every Worker response (static assets also get them from public/_headers /
// landing/_headers; Worker-built pages and /api/* need them here). WebSocket upgrades are left alone.
const SECURITY: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function withSecurity(res: Response): Response {
  // a live-room upgrade must stay the Response the Durable Object returned
  if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
