import storage from './storage.js';
import auth from './auth-utils.js';
import { getContent, saveContent, isValidContent } from './content-store-v2.mjs';
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
export default async (request) => {
  const config = auth.configuration();
  const session = await auth.validateSession(request.headers.get('cookie'));
  if (!session || session.mustChangePassword || session.role !== 'owner') return json(403, { error: 'Somente o owner pode exportar e restaurar versões.' });
  try {
    const store = storage.getStore({ name: 'hltpc-content', consistency: 'strong' });
    if (request.method === 'GET') {
      if (new URL(request.url).searchParams.has('export')) return json(200, await getContent(), { 'Content-Disposition': 'attachment; filename="hltpc-backup.json"' });
      const { blobs } = await store.list({ prefix: 'history/' });
      const versions = [];
      for (const item of blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 50)) {
        const backup = await store.get(item.key, { type: 'json' });
        versions.push({ key: item.key, revision: backup.revision, at: backup.backedUpAt, actor: backup.content?._lastEdit?.actor || 'versão anterior' });
      }
      return json(200, { versions });
    }
    if (request.method !== 'POST') return json(405, { error: 'Método não permitido.' });
    const body = await request.json();
    if (!/^history\/\d{12}$/.test(body.key || '')) return json(422, { error: 'Versão inválida.' });
    const backup = await store.get(body.key, { type: 'json' });
    if (!isValidContent(backup?.content)) return json(404, { error: 'Versão não encontrada.' });
    const content = await saveContent(backup.content, { expectedRevision: body._revision, actor: `${session.sub}:restore:${backup.revision}` });
    return json(200, { content });
  } catch (error) { return json(error.statusCode || 500, { error: error.message }); }
};
