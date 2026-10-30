// Makes the page installable as an app. It caches nothing: the app needs its local server
// anyway, and a cache would serve stale code after updates.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
