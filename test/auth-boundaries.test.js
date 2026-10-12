const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const reads = [], writes = [], deleted = [];
const store = new Map();
function metadata(id) {
  if (!store.has(id)) store.set(id, { attendify: { profile: { name: id, attendance_requirement_percentage: 75 }, subjects: [], timetable: [], college_location: null }, unrelated: { keep: true } });
  return store.get(id);
}
function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) { target[key] ||= {}; merge(target[key], value); }
    else target[key] = structuredClone(value);
  }
}
const clerkClient = { users: {
  getUser: async id => {
    reads.push(id);
    if (id === 'unavailable') throw new Error('Simulated provider outage');
    return { privateMetadata: structuredClone(metadata(id)) };
  },
  updateUserMetadata: async (id, data) => { writes.push({ id, data }); merge(metadata(id), data.privateMetadata); },
  deleteUser: async id => { if (id === 'deletion-outage') throw new Error('Provider unavailable'); deleted.push(id); store.delete(id); }
} };
// Replace only the identity-provider boundary; exercise real Express routes and DataService.
Module._load = function (name, ...args) {
  if (name === '@clerk/express') return {
    clerkClient,
    clerkMiddleware: () => (req, _res, next) => { req.auth = () => ({ userId: req.headers['x-test-verified-user'] || null, sessionClaims: { fva: [Number(req.headers['x-test-age'] ?? 0), -1] } }); next(); },
    getAuth: req => req.auth()
  };
  return originalLoad.call(this, name, ...args);
};
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_' + Buffer.from('auth.example.test$').toString('base64');
process.env.CLERK_SECRET_KEY = 'sk_test_placeholder';
process.env.APP_URL = 'http://localhost:3000';
process.env.PUBLIC_CONTACT_EMAIL = 'confirmed@example.test';
const app = require('../app');
Module._load = originalLoad;
let server, base;
before(async () => { server = app.listen(0); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(resolve => server.close(resolve)));
test('policies are public and accessible to users without any role', async () => {
  for (const path of ['/privacy', '/terms']) for (const user of [null, 'roleless']) {
    const r = await fetch(base + path, { headers: user ? { 'x-test-verified-user': user } : {} });
    assert.equal(r.status, 200); assert.match(await r.text(), /confirmed@example.test/);
  }
});
test('public homepage links policies and custom forms', async () => {
  const r = await fetch(base); const html = await r.text();
  for (const path of ['/privacy', '/terms', '/sign-in', '/sign-up']) assert.ok(html.includes(`href="${path}"`));
});
test('protected pages and static HTML aliases redirect unauthenticated users', async () => {
  for (const path of ['/dashboard','/index.html','/profile','/profile.html','/calendar','/calculator','/subjects','/analytics','/subject-details']) {
    const r = await fetch(base + path, { redirect: 'manual' });
    assert.equal(r.status, 302, path); assert.equal(r.headers.get('location'), '/sign-in');
  }
});
test('API read and mutation routes reject unauthenticated requests', async () => {
  for (const [path, method] of [['/subjects','GET'],['/profile','GET'],['/dashboard','GET'],['/export','GET'],['/timetable','GET'],['/settings/location','GET'],['/subjects','POST'],['/import','POST'],['/attendance/mark','POST'],['/subjects/other','DELETE']]) {
    assert.equal((await fetch(base + '/api' + path, { method })).status, 401, path);
  }
});
test('client supplied identity cannot select another user metadata', async () => {
  const r = await fetch(base + '/api/profile?userId=victim', { headers: { 'x-test-verified-user': 'owner' } });
  assert.equal(r.status, 200); assert.equal((await r.json()).name, 'owner'); assert.equal(reads.at(-1), 'owner');
});
test('metadata outages fail without initializing or overwriting attendance', async () => {
  const count = writes.length;
  const r = await fetch(base + '/api/profile', { headers: { 'x-test-verified-user': 'unavailable' } });
  assert.equal(r.status, 500); assert.equal(writes.length, count);
});
test('browser bootstrap uses configured key and callback is public', async () => {
  const r = await fetch(base + '/auth/clerk.js'); const js = await r.text();
  assert.match(js, /auth.example.test/); assert.ok(!js.includes('bright-moray')); assert.ok(!js.includes('sk_test_'));
  assert.equal((await fetch(base + '/sso-callback')).status, 200);
});

const call = (path, user, method = 'GET', body, extra = {}) => fetch(base + '/api' + path, {
  method, headers: { 'x-test-verified-user': user, 'content-type': 'application/json', origin: 'http://localhost:3000', ...extra },
  ...(body ? { body: JSON.stringify(body) } : {})
});
test('calendar exceptions sync for one account without changing attendance or other metadata', async () => {
  const m = metadata('calendar-owner');
  m.attendify.subjects = [{ id: 'math', subject_name: 'Math', total_classes: 2, attended_classes: 1, history: [{ id: 'old', date: '2026-10-01', status: 'absent' }] }];
  const before = structuredClone(m.attendify);
  assert.equal((await call('/calendar/holidays/2026-10-12', 'calendar-owner', 'PUT', { enabled: true })).status, 200);
  assert.equal((await call('/calendar/cancellations', 'calendar-owner', 'PUT', { date: '2026-10-13', subjectId: 'math', enabled: true })).status, 200);
  const synced = await (await call('/calendar/exceptions', 'calendar-owner')).json();
  assert.deepEqual(synced.holidays, ['2026-10-12']); assert.equal(synced.cancellations.length, 1);
  assert.deepEqual(await (await call('/calendar/exceptions', 'another-account')).json(), { holidays: [], cancellations: [] });
  assert.deepEqual(m.attendify, before); assert.deepEqual(m.unrelated, { keep: true });
  for (const date of ['2026-10-12', '2026-10-13']) {
    assert.equal((await call('/attendance/mark', 'calendar-owner', 'POST', { subjectId: 'math', date, status: 'absent' })).status, 409);
  }
  assert.equal((await call('/attendance/mark', 'calendar-owner', 'POST', { subjectId: 'math', date: '2026-10-13', status: 'extra' })).status, 200);
  assert.equal(metadata('calendar-owner').attendify.subjects[0].total_classes, 3);
  assert.equal((await call('/calendar/cancellations', 'another-account', 'PUT', { date: '2026-10-13', subjectId: 'math', enabled: true })).status, 404);
  assert.equal((await call('/calendar/holidays/2026-02-30', 'calendar-owner', 'PUT', { enabled: true })).status, 400);
  assert.equal((await call('/calendar/holidays/2026-10-12', 'calendar-owner', 'PUT', { enabled: false })).status, 200);
  assert.deepEqual((await (await call('/calendar/exceptions', 'calendar-owner')).json()).holidays, []);
});
test('exports include exceptions/preferences and legacy imports preserve them', async () => {
  await call('/settings/preferences', 'calendar-owner', 'PUT', { autoAttendance: false, reminders: false });
  const backup = await (await call('/export', 'calendar-owner')).json();
  assert.equal(backup.calendar.cancellations.length, 1); assert.equal(backup.settings.autoAttendance, false);
  assert.equal((await call('/import', 'backup-owner', 'POST', backup)).status, 200);
  assert.deepEqual(await (await call('/calendar/exceptions', 'backup-owner')).json(), backup.calendar);
  assert.equal((await call('/import', 'backup-owner', 'POST', { profile: {}, subjects: [] })).status, 200);
  assert.deepEqual(await (await call('/calendar/exceptions', 'backup-owner')).json(), backup.calendar);
  const invalid = { ...backup, calendar: { holidays: ['bad'], cancellations: [] } };
  const count = writes.length;
  assert.equal((await call('/import', 'backup-owner', 'POST', invalid)).status, 400); assert.equal(writes.length, count);
});
test('preferences and clearing location preserve attendance and unrelated metadata', async () => {
  const m = metadata('controls-owner'); m.attendify.college_location = { lat: 1, lng: 2, radius: 150 };
  const original = structuredClone(m.attendify);
  assert.equal((await call('/settings/preferences', 'controls-owner', 'PUT', { reminders: false })).status, 200);
  assert.deepEqual(await (await call('/settings/preferences', 'controls-owner')).json(), { autoAttendance: true, reminders: false });
  assert.equal((await call('/settings/preferences', 'controls-owner', 'PUT', { autoAttendance: 'false' })).status, 400);
  assert.equal((await call('/settings/location', 'controls-owner', 'DELETE')).status, 200);
  assert.equal(m.attendify.college_location, undefined); delete original.college_location;
  assert.deepEqual(m.attendify, original); assert.deepEqual(m.unrelated, { keep: true });
});
test('destructive actions require authentication, same origin, recent verification and exact confirmation', async () => {
  const count = deleted.length;
  for (const path of ['/account', '/account/data', '/settings/location']) assert.equal((await fetch(base + '/api' + path, { method: 'DELETE' })).status, 401);
  assert.equal((await call('/account', 'delete-owner', 'DELETE', { confirmation: 'DELETE MY ACCOUNT' }, { origin: 'https://attacker.test' })).status, 403);
  assert.equal((await call('/account', 'delete-owner', 'DELETE', { confirmation: 'DELETE MY ACCOUNT' }, { 'x-test-age': '10' })).status, 403);
  assert.equal((await call('/account', 'delete-owner', 'DELETE', { confirmation: 'delete' })).status, 400);
  assert.equal(deleted.length, count);
  assert.equal((await call('/account', 'delete-owner', 'DELETE', { confirmation: 'DELETE MY ACCOUNT', userId: 'victim' })).status, 200);
  assert.equal(deleted.at(-1), 'delete-owner');
});
test('data deletion leaves sign-in identity and other metadata intact and disables automation', async () => {
  const m = metadata('data-owner'); m.attendify_calendar = { holidays: ['2026-10-12'], cancellations: [] };
  const count = deleted.length;
  assert.equal((await call('/account/data', 'data-owner', 'DELETE', { confirmation: 'DELETE MY DATA' })).status, 200);
  assert.equal(m.attendify, undefined); assert.equal(m.attendify_calendar, undefined);
  assert.deepEqual(m.attendify_settings, { autoAttendance: false, reminders: false }); assert.deepEqual(m.unrelated, { keep: true });
  assert.equal(deleted.length, count);
});
test('provider deletion failures do not report successful account deletion', async () => {
  assert.equal((await call('/account', 'deletion-outage', 'DELETE', { confirmation: 'DELETE MY ACCOUNT' })).status, 500);
  assert.ok(!deleted.includes('deletion-outage'));
});
test('independent calendar date changes merge and disabling an imported holiday works', async () => {
  await Promise.all(['2026-10-14', '2026-10-15'].map(date => call('/calendar/holidays/' + date, 'merge-owner', 'PUT', { enabled: true })));
  assert.deepEqual((await (await call('/calendar/exceptions', 'merge-owner')).json()).holidays, ['2026-10-14', '2026-10-15']);
  metadata('merge-owner').attendify_calendar.holidays = ['2026-10-16'];
  await call('/calendar/holidays/2026-10-16', 'merge-owner', 'PUT', { enabled: false });
  assert.ok(!(await (await call('/calendar/exceptions', 'merge-owner')).json()).holidays.includes('2026-10-16'));
});
test('server rejects automated marking when account automation is disabled', async () => {
  const m = metadata('manual-owner');
  m.attendify.subjects = [{ id: 'science', subject_name: 'Science', total_classes: 0, attended_classes: 0, history: [] }];
  await call('/settings/preferences', 'manual-owner', 'PUT', { autoAttendance: false });
  const body = { subjectId: 'science', date: '2026-10-20', status: 'present' };
  assert.equal((await call('/attendance/mark', 'manual-owner', 'POST', { ...body, source: 'auto' })).status, 409);
  assert.equal((await call('/attendance/mark', 'manual-owner', 'POST', body)).status, 200);
});
