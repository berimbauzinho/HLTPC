const { connectLambda } = require('./storage');
const CONTENT_KEYS = ['players', 'teams', 'tournaments', 'matches', 'news'];
const isValidContent = (content) => Boolean(content && CONTENT_KEYS.every((key) => Array.isArray(content[key])) && content.players.length && content.teams.length && content.tournaments.length);
async function getRawContent(event) { connectLambda(event); return (await import('./content-store-v2.mjs')).getRawContent(); }
async function getContent(event) { connectLambda(event); return (await import('./content-store-v2.mjs')).getContent(); }
async function saveContent(event, content, options) { connectLambda(event); return (await import('./content-store-v2.mjs')).saveContent(content, options); }
module.exports = { CONTENT_KEYS, isValidContent, getRawContent, getContent, saveContent };
