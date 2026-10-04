import assert from 'node:assert/strict';
const port = Number(process.env.DEMO_PORT ?? 5273);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
const base = `http://127.0.0.1:${port}`;
for (const route of ['/', '/admin', '/kitchen', '/demo/lunch/kitchen']) {
 const r = await fetch(base + route, { signal: AbortSignal.timeout(15000) });
 assert.equal(r.status, 200, route);
}
async function call(action) {
 const r = await fetch(base + (action ? '/api/demo/lunch/control' : '/api/demo/lunch/state'), {
  ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ action }) } : {}),
  signal: AbortSignal.timeout(15000),
 });
 assert.equal(r.status, 200);
 return r.json();
}
const initial = await call(); assert.equal(initial.plates.length, 42);
assert.equal((await call('pause')).playback.paused, true);
assert.equal((await call('resume')).playback.paused, false);
const restart = await call('restart'); assert.equal(restart.playback.second, 0);
assert.equal(restart.playback.sessionId, initial.playback.sessionId);
console.log('Frontend routes and real demo API passed: 42 bowls, pause/resume/restart, stable session.');
