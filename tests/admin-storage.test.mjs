import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
process.env.HLTPC_STORAGE = 'local';
process.env.HLTPC_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hltpc-test-'));
process.env.HLTPC_OWNER_PASSWORD = crypto.randomUUID();
process.env.HLTPC_SESSION_SECRET = crypto.randomUUID();
const storage = (await import('../netlify/functions/storage.js')).default;
const auth = (await import('../netlify/functions/auth-utils.js')).default;
const { getContent, saveContent } = await import('../netlify/functions/content-store-v2.mjs');
const admin = (await import('../netlify/functions/admin-content-v2.mjs')).default;
const mediaUpload = (await import('../netlify/functions/admin-media-v2.mjs')).default;
const mediaRead = (await import('../netlify/functions/media-v2.mjs')).default;
const history = (await import('../netlify/functions/admin-history.mjs')).default;
const cookie = auth.cookie(auth.createSession('lanches', process.env.HLTPC_SESSION_SECRET)).split(';')[0];
const baseline = { _revision: 10, _relationsVersion: 1, players: [{ id: 'p1', name: 'Player', teams: [], teamIds: [] }], teams: [{ id: 't1', name: 'Team', logo: '/assets/keep.png' }], tournaments: [{ id: 'event1', name: 'Event', teams: ['Team'], teamIds: ['t1'] }], matches: [], news: [{ id: 'news1', name: 'Original', image: '/assets/keep-news.png' }] };
const store = storage.getStore('hltpc-content');
const seed = () => store.setJSON('current', structuredClone(baseline));
test('public recovery news titles remain editable in the admin', async () => {
  await store.setJSON('current', { ...structuredClone(baseline), news: [{ id: 'public-news', title: 'Recovered title' }] });
  assert.equal((await getContent()).news[0].name, 'Recovered title');
});
const patch = (revision, name) => new Request('https://hltpc.test/api/admin/content', { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ _revision: revision, changes: [{ collection: 'news', id: 'news1', operation: 'upsert', record: { ...baseline.news[0], name } }] }) });

test('an edit preserves every unrelated record and backs up the previous version', async () => {
  await seed();
  const response = await admin(patch(10, 'New'));
  assert.equal(response.status, 200);
  const current = await getContent();
  assert.equal(current.news[0].name, 'New');
  assert.equal(current.teams[0].logo, '/assets/keep.png');
  assert.deepEqual(current.players, baseline.players);
  const backup = await store.get('history/000000000010', { type: 'json' });
  assert.equal(backup.content.news[0].name, 'Original');
});
test('stale or missing browser revision and legacy PUT cannot overwrite data', async () => {
  await seed();
  assert.equal((await admin(patch(9, 'Stale'))).status, 409);
  assert.equal((await admin(patch(undefined, 'Missing'))).status, 409);
  assert.equal((await admin(new Request('https://hltpc.test/api/admin/content', { method: 'PUT', headers: { cookie }, body: '{}' }))).status, 410);
  assert.equal((await getContent()).news[0].name, 'Original');
});
test('two simultaneous saves of the same revision: exactly one wins', async () => {
  await seed();
  const [left, right] = await Promise.all([getContent(), getContent()]);
  left.news[0].name = 'Left'; right.news[0].name = 'Right';
  const results = await Promise.allSettled([saveContent(left, { expectedRevision: 10 }), saveContent(right, { expectedRevision: 10 })]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.statusCode, 409);
  assert.equal((await getContent())._revision, 11);
});
test('image bytes round-trip, unsupported format and unauthenticated upload are rejected', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMs8AAAAASUVORK5CYII=', 'base64');
  const request = (headers) => new Request('https://hltpc.test/api/admin/media', { method: 'POST', headers, body: png });
  assert.equal((await mediaUpload(request({ 'Content-Type': 'image/png' }))).status, 403);
  assert.equal((await mediaUpload(request({ cookie, 'Content-Type': 'text/html' }))).status, 415);
  const uploaded = await mediaUpload(request({ cookie, 'Content-Type': 'image/png' }));
  assert.equal(uploaded.status, 201);
  const { url } = await uploaded.json();
  const read = await mediaRead(new Request(`https://hltpc.test/media?id=${url.split('/').at(-1)}`));
  assert.equal(read.status, 200);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
  assert.equal((await mediaRead(new Request('https://hltpc.test/media?id=invalid'))).status, 404);
});
test('restoration creates a new revision and keeps owner-only access', async () => {
  await seed();
  await admin(patch(10, 'Changed'));
  const adminCookie = auth.cookie(auth.createSession('other', process.env.HLTPC_SESSION_SECRET, 'admin')).split(';')[0];
  assert.equal((await history(new Request('https://hltpc.test/history', { headers: { cookie: adminCookie } }))).status, 403);
  const restored = await history(new Request('https://hltpc.test/history', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'history/000000000010', _revision: 11 }) }));
  assert.equal(restored.status, 200);
  assert.equal((await getContent())._revision, 12);
  assert.equal((await getContent()).news[0].name, 'Original');
});
test('local persistence survives module/server restarts and never silently accepts corrupt data', async () => {
  await seed();
  const fresh = storage.getStore('hltpc-content');
  assert.equal((await fresh.get('current', { type: 'json' }))._revision, 10);
  fs.writeFileSync(path.join(process.env.HLTPC_LOCAL_DATA_DIR, 'storage.json'), '{invalid');
  await assert.rejects(() => getContent());
});
test.after(() => fs.rmSync(process.env.HLTPC_LOCAL_DATA_DIR, { recursive: true, force: true }));
