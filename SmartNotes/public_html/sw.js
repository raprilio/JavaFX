// SmartNotes service worker (v1.15). It only makes the app installable ("Add to Home screen" → full screen)
// and shows a friendly page when the phone is offline. Nothing is cached: notes always come from the server.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;font:16px/1.5 system-ui,sans-serif;background:#f5f6f8;color:#161a22;text-align:center;padding:24px">
<div><div style="font-size:42px">📶</div><h1 style="font-size:20px;margin:8px 0">You are offline</h1><p style="color:#586071;margin:0 0 18px">Connect to the internet to open your notes.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border:0;border-radius:10px;background:#6366f1;color:#fff">Try again</button></div></body>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // API calls, scripts and files go straight to the network
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
