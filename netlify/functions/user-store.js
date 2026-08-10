const STORE_NAME = "hltpc-admin-users";
const USERS_KEY = "users";

async function store() {
  const { getStore } = await import("@netlify/blobs");
  return getStore(STORE_NAME);
}

async function listUsers() {
  const users = await (await store()).get(USERS_KEY, { type: "json", consistency: "strong" });
  return Array.isArray(users) ? users : [];
}

async function saveUsers(users) {
  await (await store()).setJSON(USERS_KEY, users);
}

async function findUser(username) {
  return (await listUsers()).find((user) => user.username.toLowerCase() === username.toLowerCase()) || null;
}

module.exports = { listUsers, saveUsers, findUser };
