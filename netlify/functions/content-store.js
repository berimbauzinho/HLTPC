const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "hltpc-content";
const CONTENT_KEY = "current";

function store(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

async function getContent(event) {
  return await store(event).get(CONTENT_KEY, { type: "json" }) || {};
}

async function saveContent(event, content) {
  await store(event).setJSON(CONTENT_KEY, content);
}

module.exports = { getContent, saveContent };
