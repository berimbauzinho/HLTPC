const fs = require('fs');
const path = require('path');

// In-memory Map of stores
const stores = new Map();

// Local persistence file path (graceful persistence for dev/preview)
const DATA_DIR = path.resolve(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'blobs.json');

function loadPersistedStores() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const json = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      for (const [storeName, entries] of Object.entries(json)) {
        const storeMap = new Map();
        for (const [key, item] of Object.entries(entries)) {
          let data = item.data;
          if (item.encoding === 'base64' && typeof item.data === 'string') {
            data = Buffer.from(item.data, 'base64');
          }
          storeMap.set(key, { data, metadata: item.metadata || {} });
        }
        stores.set(storeName, storeMap);
      }
    }
  } catch (err) {
    console.error('Failed to load persisted blobs:', err.message);
  }
}

function persistStores() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const out = {};
    for (const [storeName, storeMap] of stores.entries()) {
      out[storeName] = {};
      for (const [key, item] of storeMap.entries()) {
        if (Buffer.isBuffer(item.data)) {
          out[storeName][key] = {
            encoding: 'base64',
            data: item.data.toString('base64'),
            metadata: item.metadata
          };
        } else {
          out[storeName][key] = {
            data: item.data,
            metadata: item.metadata
          };
        }
      }
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist blobs:', err.message);
  }
}

loadPersistedStores();

// Seed initial content if hltpc-content doesn't have "current"
function seedInitialContentIfEmpty() {
  const contentStore = getStore({ name: 'hltpc-content' });
  contentStore.get('current').then((val) => {
    if (!val) {
      try {
        const globalWindow = global.window || {};
        global.window = globalWindow;
        require(path.join(process.cwd(), 'data.js'));
        require(path.join(process.cwd(), 'data-2025.js'));
        const source = global.window.HLTPC_DATA;
        if (!source) return;
        const confirmedPlayerAliases = new Map([
          ["GJota", ["GJ"]],
          ["Downey", ["Mikasa es su kasa"]],
          ["190", ["fraquinho"]],
          ["cuavila", ["MANO CHORIS", "KMKZ | MANO CHORIS"]],
          ["Cuazzi", ["Voulin Raba", "cuallen", "cualy", "KMKZ | cuallen"]]
        ]);
        const initials = (value) => String(value || "").split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 4).toUpperCase();
        const baselineTeamNames = [...new Set(source.tournaments.flatMap((event) => event.entries.map((entry) => entry.team)))];
        const baselineTeams = baselineTeamNames.map((name, index) => ({
          id: `team-${index}`,
          name,
          acronym: initials(name),
          aliases: [],
          status: "published",
          logo: "",
          updated: "Derivado das edições"
        }));
        const baseContent = {
          players: source.players.map((name, index) => ({
            id: `player-${index}`,
            name,
            alias: (confirmedPlayerAliases.get(name) || []).join(", "),
            status: "published",
            photo: "",
            awards: [],
            teams: [...new Set(source.tournaments.flatMap((event) => event.entries.filter((entry) => entry.players.includes(name)).map((entry) => entry.team)))],
            updated: "Dados históricos"
          })),
          teams: baselineTeams.map((team) => ({ ...team })),
          tournaments: source.tournaments.map((event) => ({
            id: event.id,
            name: event.name,
            subtitle: String(event.year),
            status: "published",
            logo: "",
            format: event.format,
            formatType: event.entries.length === 2 ? "two_team_md3" : event.entries.length === 3 ? "three_team_series" : "four_team_groups",
            teams: event.entries.map((entry) => entry.team),
            updated: event.status === "ongoing" ? "Em andamento" : `Campeão: ${event.champion}`
          })),
          matches: global.window.HLTPC_IMPORT_2025?.matches || [],
          news: source.news.map((item) => ({
            id: item.id,
            name: item.title,
            subtitle: item.summary,
            body: item.body || item.summary,
            author: item.author,
            date: item.date,
            tournamentId: item.tournamentId,
            status: "published",
            updated: item.date
          })),
          _revision: 1
        };
        contentStore.setJSON('current', baseContent);
      } catch (e) {
        console.error('Error seeding content:', e);
      }
    }
  }).catch(() => {});
}

function getStore(options) {
  const name = typeof options === 'string' ? options : options?.name || 'default';
  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  const storeMap = stores.get(name);

  return {
    async get(key, opts) {
      const item = storeMap.get(key);
      if (!item) return null;
      if (opts?.type === 'json') {
        if (typeof item.data === 'string') {
          try { return JSON.parse(item.data); } catch { return item.data; }
        }
        return item.data;
      }
      if (opts?.type === 'arrayBuffer') {
        if (item.data instanceof ArrayBuffer) return item.data;
        if (Buffer.isBuffer(item.data)) {
          return item.data.buffer.slice(item.data.byteOffset, item.data.byteOffset + item.data.byteLength);
        }
        if (item.data instanceof Uint8Array) {
          return item.data.buffer.slice(item.data.byteOffset, item.data.byteOffset + item.data.byteLength);
        }
        return Buffer.from(item.data).buffer;
      }
      if (typeof item.data === 'string') return item.data;
      if (Buffer.isBuffer(item.data)) return item.data.toString('utf8');
      return JSON.stringify(item.data);
    },

    async getWithMetadata(key, opts) {
      const data = await this.get(key, opts);
      if (data === null) return null;
      const item = storeMap.get(key);
      return { data, metadata: item?.metadata || {} };
    },

    async set(key, data, opts) {
      if (opts?.onlyIfNew && storeMap.has(key)) {
        return { modified: false };
      }
      let storedData = data;
      if (data instanceof ArrayBuffer) {
        storedData = Buffer.from(data);
      } else if (data instanceof Uint8Array) {
        storedData = Buffer.from(data);
      }
      storeMap.set(key, { data: storedData, metadata: opts?.metadata || {} });
      persistStores();
      return { modified: true };
    },

    async setJSON(key, data) {
      storeMap.set(key, { data: JSON.parse(JSON.stringify(data)), metadata: {} });
      persistStores();
      return { modified: true };
    },

    async delete(key) {
      const res = storeMap.delete(key);
      persistStores();
      return res;
    },

    async list(opts) {
      const prefix = opts?.prefix || '';
      const keys = Array.from(storeMap.keys()).filter((k) => k.startsWith(prefix));
      return { blobs: keys.map((key) => ({ key })) };
    }
  };
}

function connectLambda() {
  return {};
}

seedInitialContentIfEmpty();

module.exports = {
  getStore,
  connectLambda,
  default: {
    getStore,
    connectLambda
  }
};
