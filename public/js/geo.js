// Attendify Geofencing Auto-Attendance Module
// Runs on every page load to check if user is at college during a class

(function () {
    'use strict';

    const GEO = {
        // Haversine formula to calculate distance between two lat/lng points in meters
        distanceMeters(lat1, lng1, lat2, lng2) {
            const R = 6371000; // Earth radius in meters
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        },

        // Get current day name as lowercase
        today() {
            return new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        },

        // Check if current time is within a slot's window (+/- 5 min tolerance)
        isActiveNow(startTime, endTime) {
            const now = new Date();
            const [sh, sm] = startTime.split(':').map(Number);
            const [eh, em] = endTime.split(':').map(Number);
            const start = new Date(); start.setHours(sh, sm - 5, 0, 0); // 5 min early
            const end = new Date(); end.setHours(eh, em, 0, 0);
            return now >= start && now <= end;
        },

        // Check if this record was already auto-marked today for a subject
        wasMarkedToday(subjectId) {
            const today = window.getLocalDateString ? window.getLocalDateString() : new Date().toISOString().split('T')[0];
            const key = `geo_marked_${subjectId}_${today}`;
            return localStorage.getItem(key) === '1';
        },

        setMarkedToday(subjectId) {
            const today = window.getLocalDateString ? window.getLocalDateString() : new Date().toISOString().split('T')[0];
            const key = `geo_marked_${subjectId}_${today}`;
            localStorage.setItem(key, '1');
        },

        isExcluded(exceptions, subjectId) {
            const date = window.getLocalDateString();
            return exceptions.holidays.includes(date) || exceptions.cancellations.some(item => item.date === date && item.subjectId === subjectId);
        },

        // Main function: check geofence and auto-mark if applicable
        async run() {
            if (!navigator.geolocation) return;

            let timetable, location, exceptions, preferences;
            try {
                const [ttRes, locRes, exRes, prefRes] = await Promise.all([
                    fetch('/api/timetable'),
                    fetch('/api/settings/location'),
                    fetch('/api/calendar/exceptions'),
                    fetch('/api/settings/preferences')
                ]);

                // If not authenticated yet, skip silently
                if (![ttRes, locRes, exRes, prefRes].every(response => response.ok)) return;

                timetable = await ttRes.json();
                location = await locRes.json();
                exceptions = await exRes.json();
                preferences = await prefRes.json();
                if (!preferences.autoAttendance) return;
            } catch (e) {
                return; // Network error, skip silently
            }

            if (!location || location.lat == null || location.lng == null) return;
            if (!timetable || timetable.length === 0) return;

            const today = this.today();
            const activeSlots = timetable.filter(slot =>
                slot.day === today && this.isActiveNow(slot.startTime, slot.endTime) &&
                !this.isExcluded(exceptions, slot.subjectId)
            );

            if (activeSlots.length === 0) return;

            // Request location — use cached/last result to avoid repeated prompts
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    const { latitude, longitude } = pos.coords;
                    const dist = this.distanceMeters(latitude, longitude, location.lat, location.lng);

                    for (const slot of activeSlots) {
                        if (this.wasMarkedToday(slot.subjectId)) continue;

                        if (dist <= location.radius) {
                            // Inside college geofence — auto-mark as present
                            try {
                                const today = window.getLocalDateString ? window.getLocalDateString() : new Date().toISOString().split('T')[0];
                                const res = await fetch('/api/attendance/mark', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ subjectId: slot.subjectId, status: 'present', date: today, source: 'auto' })
                                });
                                if (res.ok) {
                                    this.setMarkedToday(slot.subjectId);
                                    if (window.showToast) {
                                        window.showToast(`📍 Auto-marked ${slot.subject_name} as Present`, 'success');
                                    }
                                    // Trigger dashboard refresh if available
                                    if (window.__attendifyRefresh) window.__attendifyRefresh();
                                }
                            } catch (e) {
                                console.error('[Geo] Failed to auto-mark:', e);
                            }
                        } else {
                            console.log(`[Geo] ${slot.subject_name} active but you're ${Math.round(dist)}m away (limit: ${location.radius}m)`);
                        }
                    }
                },
                (err) => {
                    // User denied or error — fail silently
                    console.log('[Geo] Location not available:', err.message);
                },
                { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false }
            );
        },

        // Register service worker and request notification permission
        async initPWA() {
            if ('serviceWorker' in navigator) {
                try {
                    const reg = await navigator.serviceWorker.register('/service-worker.js');
                    console.log('[PWA] Service worker registered:', reg.scope);

                    // Schedule notifications for today's timetable
                    await this.scheduleNotifications(reg);

                    // Listen for GEO_CHECK message from service worker notification tap
                    navigator.serviceWorker.addEventListener('message', (event) => {
                        if (event.data?.type === 'GEO_CHECK') {
                            this.run();
                        }
                    });
                } catch (e) {
                    console.warn('[PWA] Service worker registration failed:', e);
                }
            }
        },

        async scheduleNotifications(reg) {
            if (!reg.active) return;
            // Clear prior timers even when permissions/preferences are disabled.
            reg.active.postMessage({ type: 'CLEAR_NOTIFICATIONS' });
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            try {
                const [ttRes, exRes, prefRes] = await Promise.all([fetch('/api/timetable'), fetch('/api/calendar/exceptions'), fetch('/api/settings/preferences')]);
                if (![ttRes, exRes, prefRes].every(response => response.ok)) return;
                const [timetable, exceptions, preferences] = await Promise.all([ttRes.json(), exRes.json(), prefRes.json()]);
                if (!preferences.reminders) return;
                reg.active.postMessage({ type: 'SCHEDULE_NOTIFICATIONS', slots: timetable.filter(slot => !this.isExcluded(exceptions, slot.subjectId)) });
            } catch (_) { /* Never schedule on an unknown account preference. */ }
        }

    };

    async function refreshAutomation() {
        const clerk = await window.waitForClerk();
        if (!clerk?.user) return;
        await GEO.initPWA();
        await GEO.run();
    }
    refreshAutomation();
    window.addEventListener('attendify-settings-changed', async () => {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) await GEO.scheduleNotifications(reg);
        }
    });

    // Expose for other scripts
    window.GeoAttendance = GEO;
})();
