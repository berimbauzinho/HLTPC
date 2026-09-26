import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
test('actual PostgreSQL migration: atomic CAS, immutable history and restricted permissions', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);");
    await db.exec(fs.readFileSync('supabase/migrations/001_persistent_storage.sql', 'utf8'));
    const write = async (value, etag = null, onlyNew = false) => (await db.query('select public.hltpc_write_object($1,$2,$3::jsonb,$4,$5::jsonb,$6::uuid,$7) as result', ['hltpc-content', 'current', JSON.stringify(value), 'json', '{}', etag, onlyNew])).rows[0].result;
    const first = await write({ _revision: 1, name: 'First' }, null, true);
    assert.equal(first.modified, true);
    assert.equal((await write({ _revision: 2 }, null, true)).modified, false);
    const second = await write({ _revision: 2, name: 'Second' }, first.etag);
    assert.equal(second.modified, true);
    assert.equal((await write({ _revision: 3, name: 'Stale' }, first.etag)).modified, false);
    const backup = (await db.query("select value from public.hltpc_objects where key = 'history/000000000001'")).rows[0].value;
    assert.equal(backup.content.name, 'First');
    assert.equal((await db.query("select has_function_privilege('anon', 'public.hltpc_write_object(text,text,jsonb,text,jsonb,uuid,boolean)', 'execute') as permitted")).rows[0].permitted, false);
    assert.equal((await db.query("select has_table_privilege('authenticated', 'public.hltpc_objects', 'select') as permitted")).rows[0].permitted, false);
    assert.equal((await db.query("select public from storage.buckets where id = 'hltpc-media'")).rows[0].public, false);
  } finally { await db.close(); }
});
