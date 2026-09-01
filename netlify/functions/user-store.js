const STORE_NAME = "hltpc-admin-users";
const USERS_KEY = "users";
const { getStore } = require("@netlify/blobs");

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function listUsers() {
  const users = await store().get(USERS_KEY, { type: "json" });
  return Array.isArray(users) ? users : [];
}

async function saveUsers(event, users) {
  await store().setJSON(USERS_KEY, users);
}

async function findUser(event, username) {
  return (await listUsers()).find((user) => user.username.toLowerCase() === username.toLowerCase()) || null;
}

module.exports = { listUsers, saveUsers, findUser };
