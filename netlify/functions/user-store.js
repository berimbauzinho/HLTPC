const STORE_NAME = "hltpc-admin-users";
const USERS_KEY = "users";
const { connectLambda, getStore } = require("./storage");
const versions = new WeakMap();

function store(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

async function listUsers(event) {
  const item = await store(event).getWithMetadata(USERS_KEY, { type: 'json' });
  const users = Array.isArray(item?.data) ? item.data : [];
  versions.set(users, item?.etag || null);
  return users;
}

async function saveUsers(event, users) {
  if (!versions.has(users)) throw new Error('Recarregue os usuários antes de salvar.');
  const etag = versions.get(users);
  const result = await store(event).setJSON(USERS_KEY, users, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
  if (!result.modified) throw Object.assign(new Error('Os acessos mudaram em outra sessão. Recarregue antes de salvar.'), { statusCode: 409 });
}

async function findUser(event, username) {
  return (await listUsers(event)).find((user) => user.username.toLowerCase() === username.toLowerCase()) || null;
}

module.exports = { listUsers, saveUsers, findUser };
