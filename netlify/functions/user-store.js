const STORE_NAME = "hltpc-admin-users";
const USERS_KEY = "users";
const { connectLambda, getStore } = require("@netlify/blobs");

function store(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

async function listUsers(event) {
  const users = await store(event).get(USERS_KEY, { type: "json", consistency: "strong" });
  return Array.isArray(users) ? users : [];
}

async function saveUsers(event, users) {
  await store(event).setJSON(USERS_KEY, users);
}

async function findUser(event, username) {
  return (await listUsers(event)).find((user) => user.username.toLowerCase() === username.toLowerCase()) || null;
}

module.exports = { listUsers, saveUsers, findUser };
