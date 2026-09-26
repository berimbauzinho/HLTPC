// Server-only persistence. Never substitute a preview mock for production data.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function provider() {
  const selected = process.env.HLTPC_STORAGE || (process.env.SUPABASE_URL ? 'supabase' : 'netlify');
  if (!['supabase', 'netlify', 'local'].includes(selected)) throw new Error('HLTPC_STORAGE inválido.');
  if (selected === 'local' && process.env.NETLIFY) throw new Error('Armazenamento local não é permitido no Netlify.');
  return selected;
}

async function supabaseRequest(route, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY somente no servidor.'), { statusCode: 503 });
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('SUPABASE_URL precisa usar HTTPS.');
  const response = await fetch(`${url.replace(/\/$/, '')}${route}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers }
  });
  if (!response.ok && response.status !== 404) {
    // Do not expose credentials, upstream URLs or raw database errors to clients.
    throw Object.assign(new Error(`O Supabase não concluiu a operação (HTTP ${response.status}).`), { statusCode: 503 });
  }
  return response;
}

function localStore(name) {
  const directory = path.resolve(process.env.HLTPC_LOCAL_DATA_DIR || '.data');
  const file = path.join(directory, 'storage.json');
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const persist = (data) => {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data));
    fs.renameSync(temporary, file);
  };
  return {
    async getWithMetadata(key, options = {}) {
      const item = read()[name]?.[key];
      if (!item) return null;
      const bytes = item.kind === 'binary' ? Buffer.from(item.value, 'base64') : null;
      const data = options.type === 'arrayBuffer' ? (bytes || Buffer.from(JSON.stringify(item.value))) : options.type === 'json' ? structuredClone(item.value) : bytes?.toString('utf8') || JSON.stringify(item.value);
      return { data, metadata: item.metadata || {}, etag: item.etag };
    },
    async get(key, options) { return (await this.getWithMetadata(key, options))?.data ?? null; },
    async write(key, value, kind, options = {}) {
      // Synchronous read/check/rename forms one critical section in the local server.
      const all = read();
      all[name] ||= {};
      const current = all[name][key];
      if ((options.onlyIfNew && current) || (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)) return { modified: false };
      if (name === 'hltpc-content' && key === 'current' && current) {
        all[name][`history/${String(current.value._revision || 0).padStart(12, '0')}`] = { ...current, value: { content: current.value, revision: current.value._revision, backedUpAt: new Date().toISOString() } };
      }
      const etag = crypto.randomUUID();
      all[name][key] = { value, kind, metadata: options.metadata || {}, etag };
      persist(all); // Errors propagate; never acknowledge an unpersisted write.
      return { modified: true, etag };
    },
    async setJSON(key, value, options) { return this.write(key, structuredClone(value), 'json', options); },
    async set(key, value, options) { return this.write(key, Buffer.from(value).toString('base64'), 'binary', options); },
    async list(options = {}) { return { blobs: Object.entries(read()[name] || {}).filter(([key]) => key.startsWith(options.prefix || '')).map(([key, value]) => ({ key, etag: value.etag })) }; }
  };
}

function supabaseStore(name) {
  const query = (key) => `store=eq.${encodeURIComponent(name)}&key=eq.${encodeURIComponent(key)}`;
  return {
    async getWithMetadata(key, options = {}) {
      const response = await supabaseRequest(`/rest/v1/hltpc_objects?${query(key)}&select=value,kind,metadata,etag`);
      if (response.status === 404) throw new Error('Execute a migration do banco HLTPC antes de conectar o site.');
      const [item] = await response.json();
      if (!item) return null;
      let data = item.value;
      if (item.kind === 'binary') {
        const media = await supabaseRequest(`/storage/v1/object/authenticated/hltpc-media/${item.value.path}`);
        if (media.status === 404) return null;
        data = await media.arrayBuffer();
      } else if (options.type !== 'json') data = JSON.stringify(data);
      return { data, metadata: item.metadata || {}, etag: item.etag };
    },
    async get(key, options) { return (await this.getWithMetadata(key, options))?.data ?? null; },
    async write(key, value, kind, options = {}) {
      const response = await supabaseRequest('/rest/v1/rpc/hltpc_write_object', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_store: name, p_key: key, p_value: value, p_kind: kind, p_metadata: options.metadata || {}, p_expected_etag: options.onlyIfMatch || null, p_only_if_new: Boolean(options.onlyIfNew) })
      });
      if (response.status === 404) throw new Error('Execute a migration do banco HLTPC antes de conectar o site.');
      return response.json();
    },
    async setJSON(key, value, options) { return this.write(key, value, 'json', options); },
    async set(key, bytes, options = {}) {
      // Unique, immutable objects avoid overwriting an existing uploaded image.
      const objectPath = `${encodeURIComponent(name)}/${crypto.randomUUID()}`;
      const uploaded = await supabaseRequest(`/storage/v1/object/hltpc-media/${objectPath}`, { method: 'POST', headers: { 'Content-Type': options.metadata?.contentType || 'application/octet-stream', 'x-upsert': 'false' }, body: Buffer.from(bytes) });
      if (uploaded.status === 404) throw new Error('Crie o bucket privado hltpc-media executando a migration do banco.');
      return this.write(key, { path: objectPath }, 'binary', options);
    },
    async list(options = {}) {
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const response = await supabaseRequest(`/rest/v1/hltpc_objects?store=eq.${encodeURIComponent(name)}&select=key,etag&order=key&offset=${offset}&limit=1000`);
        if (response.status === 404) throw new Error('Execute a migration do banco HLTPC.');
        const rows = await response.json();
        all.push(...rows.filter((row) => row.key.startsWith(options.prefix || '')));
        if (rows.length < 1000) break;
      }
      return { blobs: all };
    }
  };
}

function getStore(options) {
  const name = typeof options === 'string' ? options : options.name;
  switch (provider()) {
    case 'local': return localStore(name);
    case 'supabase': return supabaseStore(name);
    default: return require('@netlify/blobs').getStore(typeof options === 'string' ? { name, consistency: 'strong' } : options);
  }
}

function connectLambda(event) {
  if (provider() === 'netlify') require('@netlify/blobs').connectLambda(event);
}

module.exports = { getStore, connectLambda, provider, supabaseRequest };
