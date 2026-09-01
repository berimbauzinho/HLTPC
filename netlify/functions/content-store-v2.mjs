import { getStore } from "@netlify/blobs";
import pglImports from "./pgl-2026-imports.js";
import statisticsImports from "./statistics-imports.js";
import recoveryMedia from "./recovery-media.js";
import teamRelations from "./team-relations.js";
import tournamentProgression from "./tournament-progression.js";

const { applyPgl2026Imports } = pglImports;
const { applyStatisticsImports } = statisticsImports;
const { applyRecoveryMedia } = recoveryMedia;
const { normalizeContentTeamReferences } = teamRelations;
const { applyTournamentProgression } = tournamentProgression;

const STORE_NAME = "hltpc-content";
const CONTENT_KEY = "current";
const CONTENT_KEYS = ["players", "teams", "tournaments", "matches", "news"];
const BACKUP_SLOTS = 12;

function store() {
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

async function getRawContent() {
  return await store().get(CONTENT_KEY, { type: "json" }) || null;
}

async function getContent() {
  const raw = await getRawContent();
  if (!isValidContent(raw)) {
    const error = new Error("O armazenamento compartilhado não devolveu uma base válida. Nenhuma gravação foi feita.");
    error.name = "ContentUnavailableError";
    error.statusCode = 503;
    throw error;
  }
  return runtimeContent(raw);
}

async function saveContent(content, options = {}) {
  if (!isValidContent(content)) {
    const error = new Error("A gravação foi bloqueada porque a base enviada está incompleta.");
    error.name = "InvalidContentError";
    error.statusCode = 422;
    throw error;
  }

  const current = await getRawContent();
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
    await store().setJSON(backupKey, {
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
  await store().setJSON(CONTENT_KEY, next);
  return next;
}

export { CONTENT_KEYS, getContent, getRawContent, isValidContent, saveContent };
