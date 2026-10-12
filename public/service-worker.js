// Attendify Service Worker
// Handles asset caching and class time notifications

const CACHE_NAME = 'attendify-v5';
const STATIC_ASSETS = [
    '/logo.png',
    '/js/main.js',
    '/js/geo.js',
    '/manifest.json',
];

// ─── INSTALL: cache static assets ───────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS).catch(() => {
                // Non-fatal: some assets may not exist yet
            });
        }).then(() => self.skipWaiting())
    );
});

// ─── ACTIVATE: clear old caches ─────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ─── FETCH: network-first, fallback to cache ────────────
self.addEventListener('fetch', event => {
    // Only handle GET requests for same-origin
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    // API calls: always network-only (let browser handle directly)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') ||
        event.request.mode === 'navigate' || url.pathname.endsWith('.html')) return;

    // CRITICAL: Never intercept Clerk auth requests — let browser handle them directly
    // This includes __clerk_handshake tokens, sign-in/sign-up pages, and SSO callbacks
    if (url.search.includes('__clerk') ||
        url.pathname.startsWith('/sign-in') ||
        url.pathname.startsWith('/sign-up') ||
        url.pathname.startsWith('/sso-callback') ||
        url.hash.includes('sso-callback')) {
        return; // Do NOT call event.respondWith — hand off to network
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Cache successful responses for HTML and static files
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then(cached => {
                    return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
                });
            })
    );
});

// ─── NOTIFICATION CLICK ─────────────────────────────────
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.focus();
                    client.postMessage({ type: 'GEO_CHECK', subjectId: event.notification.data?.subjectId });
                    return;
                }
            }
            return clients.openWindow(url);
        })
    );
});

// ─── MESSAGE: schedule class notifications ──────────────
self.addEventListener('message', event => {
    if (event.data?.type === 'CLEAR_NOTIFICATIONS') {
        scheduledTimers.forEach(timer => clearTimeout(timer));
        scheduledTimers.length = 0;
        event.waitUntil(self.registration.getNotifications().then(notifications => notifications.filter(notification => notification.tag.startsWith('class-')).forEach(notification => notification.close())));
    }
    if (event.data?.type === 'SCHEDULE_NOTIFICATIONS') {
        scheduleTodayNotifications(event.data.slots);
    }
});

// Scheduled notification timers
const scheduledTimers = [];

function scheduleTodayNotifications(slots) {
    // Clear previous timers
    scheduledTimers.forEach(t => clearTimeout(t));
    scheduledTimers.length = 0;

    const now = new Date();
    const todayName = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    slots.forEach(slot => {
        if (slot.day !== todayName) return;

        const [h, m] = slot.startTime.split(':').map(Number);
        const classTime = new Date();
        classTime.setHours(h, m, 0, 0);

        const msUntil = classTime.getTime() - now.getTime();
        if (msUntil < -5 * 60 * 1000) return; // already more than 5 min past

        const delay = Math.max(0, msUntil);
        const timer = setTimeout(() => {
            self.registration.showNotification('📍 Class Starting Now!', {
                body: `${slot.subject_name} just started. Open Attendify to auto-mark attendance.`,
                icon: '/logo.png',
                badge: '/logo.png',
                tag: `class-${slot.id}`,
                requireInteraction: true,
                data: {
                    url: '/',
                    subjectId: slot.subjectId
                },
                actions: [
                    { action: 'open', title: 'Mark Attendance' },
                    { action: 'dismiss', title: 'Dismiss' }
                ]
            });
        }, delay);

        scheduledTimers.push(timer);
    });
}
