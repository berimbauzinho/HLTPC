const { connectLambda, getStore } = require("@netlify/blobs");
const { applyPgl2026Imports } = require("./pgl-2026-imports");
const { applyStatisticsImports } = require("./statistics-imports");
const { applyRecoveryMedia } = require("./recovery-media");
const { normalizeContentTeamReferences } = require("./team-relations");
const { applyTournamentProgression } = require("./tournament-progression");

const STORE_NAME = "hltpc-content";
const CONTENT_KEY = "current";
const CONTENT_KEYS = ["players", "teams", "tournaments", "matches", "news"];
const BACKUP_SLOTS = 12;

function store(event) {
  connectLambda(event);
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function isValidContent(content) {
  return Boolean(
    content &&
    CONTENT_KEYS.every((key) => Array.isArray(content[key])) &&
    content.players.length &&
    content.teams.length &&
    content.tournaments.length
  );
}

function runtimeContent(content) {
  return applyRecoveryMedia(
    applyTournamentProgression(
      normalizeContentTeamReferences(
        applyStatisticsImports(applyPgl2026Imports(content))
      )
    )
  );
}

async function getRawContent(event) {
  return await store(event).get(CONTENT_KEY, { type: "json" }) || null;
}

async function getContent(event) {
  const raw = await getRawContent(event);
  if (!isValidContent(raw)) {
    const error = new Error("O armazenamento compartilhado não devolveu uma base válida. Nenhuma gravação foi feita.");
    error.name = "ContentUnavailableError";
    error.statusCode = 503;
    throw error;
  }
  return runtimeContent(raw);
}

async function saveContent(event, content, options = {}) {
  if (!isValidContent(content)) {
    const error = new Error("A gravação foi bloqueada porque a base enviada está incompleta.");
    error.name = "InvalidContentError";
    error.statusCode = 422;
    throw error;
  }

  const current = await getRawContent(event);
  const currentRevision = Number(current?._revision || 0);
  const expectedRevision = options.expectedRevision;
  if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== currentRevision) {
    const error = new Error("O conteúdo mudou em outra sessão. Recarregue o painel antes de salvar novamente.");
    error.name = "ContentConflictError";
    error.statusCode = 409;
    throw error;
  }

  if (isValidContent(current)) {
    const backupKey = `backup-${currentRevision % BACKUP_SLOTS}`;
    await store(event).setJSON(backupKey, {
      backedUpAt: new Date().toISOString(),
      revision: currentRevision,
      content: current
    });
  }

  const next = runtimeContent({
    ...content,
    _revision: currentRevision + 1,
    updatedAt: content.updatedAt || new Date().toISOString()
  });
  await store(event).setJSON(CONTENT_KEY, next);
  return next;
}

module.exports = { CONTENT_KEYS, getContent, getRawContent, isValidContent, saveContent };
