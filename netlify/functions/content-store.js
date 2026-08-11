const { connectLambda, getStore } = require("@netlify/blobs");
const { applyPgl2026Imports } = require("./pgl-2026-imports");

const STORE_NAME = "hltpc-content";
const CONTENT_KEY = "current";

function store(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

async function getContent(event) {
  const content = await store(event).get(CONTENT_KEY, { type: "json" }) || {};
  return applyPgl2026Imports(content);
}

async function saveContent(event, content) {
  await store(event).setJSON(CONTENT_KEY, content);
}

module.exports = { getContent, saveContent };
