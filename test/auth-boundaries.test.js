const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const reads = [], writes = [];
const clerkClient = { users: {
  getUser: async id => {
    reads.push(id);
    if (id === 'unavailable') throw new Error('Simulated provider outage');
    return { privateMetadata: { attendify: { profile: { name: id, attendance_requirement_percentage: 75 }, subjects: [], timetable: [], college_location: null } } };
  },
  updateUserMetadata: async (id, data) => writes.push({ id, data })
} };
// Replace only the identity-provider boundary; exercise real Express routes and DataService.
Module._load = function (name, ...args) {
  if (name === '@clerk/express') return {
    clerkClient,
    clerkMiddleware: () => (req, _res, next) => { req.auth = () => ({ userId: req.headers['x-test-verified-user'] || null }); next(); },
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
