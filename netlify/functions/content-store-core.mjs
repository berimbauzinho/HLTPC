import storage from './storage.js';
import pglImports from './pgl-2026-imports.js';
import statisticsImports from './statistics-imports.js';
import recoveryMedia from './recovery-media.js';
import teamRelations from './team-relations.js';
import tournamentProgression from './tournament-progression.js';
import playerIdentities from './player-identities.js';
import historicalRepair from './historical-repair.js';

const CONTENT_KEYS = ['players', 'teams', 'tournaments', 'matches', 'news'];
const store = () => storage.getStore({ name: 'hltpc-content', consistency: 'strong' });
const conflict = () => Object.assign(new Error('O conteúdo mudou em outra sessão. Recarregue o painel antes de salvar; sua alteração não foi gravada.'), { name: 'ContentConflictError', statusCode: 409 });

function isValidContent(content) {
  return Boolean(content && CONTENT_KEYS.every((key) => Array.isArray(content[key])) && content.players.length && content.teams.length && content.tournaments.length);
}
function runtimeContent(raw) {
  const content = structuredClone(raw);
  for (const item of content.news || []) if (!item.name && item.title) item.name = item.title;
  historicalRepair.repairHistoricalRelations(content);
  tournamentProgression.ensureAllTournamentFixtures(content);
  playerIdentities.applyPlayerIdentities(content);
  recoveryMedia.applyRecoveryMedia(content);
  pglImports.applyPgl2026Imports(content);
  statisticsImports.applyStatisticsImports(content);
  teamRelations.normalizeContentTeamReferences(content);
  return tournamentProgression.applyTournamentProgression(content);
}
async function getRawContent() { return await store().get('current', { type: 'json' }) || null; }
async function getContent() {
  const raw = await getRawContent();
  if (!isValidContent(raw)) throw Object.assign(new Error('A base compartilhada está indisponível. Importe uma cópia validada antes de editar.'), { statusCode: 503 });
  return runtimeContent(raw);
}
async function saveContent(content, options = {}) {
  if (!isValidContent(content)) throw Object.assign(new Error('Gravação bloqueada: a base está incompleta.'), { statusCode: 422 });
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) throw conflict();
  const current = await store().getWithMetadata('current', { type: 'json' });
  if (!isValidContent(current?.data)) throw Object.assign(new Error('A base atual está indisponível. Nenhuma gravação foi feita.'), { statusCode: 503 });
  if (Number(current.data._revision || 0) !== options.expectedRevision || !current.etag) throw conflict();
  const revision = Number(current.data._revision || 0);
  // Immutable backup must succeed before CAS. SQL also backs up in its transaction.
  await store().setJSON(`history/${String(revision).padStart(12, '0')}`, {
    revision, content: current.data, backedUpAt: new Date().toISOString()
  }, { onlyIfNew: true });
  const next = runtimeContent({ ...content, _revision: revision + 1, updatedAt: new Date().toISOString(),
    _lastEdit: { actor: options.actor || 'demo-processor', at: new Date().toISOString() } });
  const result = await store().setJSON('current', next, { onlyIfMatch: current.etag });
  if (!result.modified) throw conflict();
  return next;
}
async function updateContent(updater, actor = 'demo-processor') {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await getContent();
    await updater(current);
    try { return await saveContent(current, { expectedRevision: Number(current._revision || 0), actor }); }
    catch (error) { if (error.statusCode !== 409 || attempt === 4) throw error; }
  }
}
export { CONTENT_KEYS, getContent, getRawContent, isValidContent, runtimeContent, saveContent, updateContent };
