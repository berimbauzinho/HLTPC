// Server credentials only. Run with editing paused; never commit the backup file.
import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { getStore as netlifyStore } from '@netlify/blobs';
import storage from '../netlify/functions/storage.js';
const stores = ['hltpc-content', 'hltpc-admin-users', 'hltpc-media', 'hltpc-media-v2'];
const [mode, file] = process.argv.slice(2);
if (!file || !['export-netlify', 'import'].includes(mode)) throw new Error('Use: transfer-storage.mjs export-netlify|import caminho/backup.json');
if (mode === 'export-netlify') {
  if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_AUTH_TOKEN) throw new Error('Configure NETLIFY_SITE_ID e NETLIFY_AUTH_TOKEN somente no PC.');
  const objects = [];
  for (const name of stores) {
    const source = netlifyStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN, consistency: 'strong' });
    const { blobs } = await source.list();
    for (const { key } of blobs) {
      const binary = name.startsWith('hltpc-media') || (name === 'hltpc-content' && key.startsWith('media/'));
      const item = await source.getWithMetadata(key, { type: binary ? 'arrayBuffer' : 'json' });
      if (!item) throw new Error('Dados mudaram durante a exportação. Pause as edições e repita.');
      objects.push({ store: name, key, kind: binary ? 'binary' : 'json', value: binary ? Buffer.from(item.data).toString('base64') : item.data, metadata: item.metadata || {} });
    }
  }
  if (!objects.some((item) => item.store === 'hltpc-content' && item.key === 'current')) throw new Error('O armazenamento original não contém o conteúdo atual. Nada foi exportado.');
  await fs.writeFile(file, JSON.stringify({ format: 'hltpc-storage-backup-v1', exportedAt: new Date().toISOString(), objects }), { flag: 'wx', mode: 0o600 });
  console.log(`Backup criado com ${objects.length} objetos. Contém contas: guarde-o em local privado.`);
} else {
  if (storage.provider() === 'netlify') throw new Error('Escolha armazenamento local ou Supabase para o destino.');
  const backup = JSON.parse(await fs.readFile(file, 'utf8'));
  if (backup.format !== 'hltpc-storage-backup-v1' || !Array.isArray(backup.objects)) throw new Error('Backup inválido.');
  // Preflight all stores before the first write. Resume only against a new target.
  for (const name of stores) if ((await storage.getStore(name).list()).blobs.length) throw new Error('Destino já preenchido. Nenhum objeto foi sobrescrito. Use um destino vazio.');
  for (const item of backup.objects) {
    if (!stores.includes(item.store) || !['binary', 'json'].includes(item.kind)) throw new Error('Objeto inválido no backup.');
    const destination = storage.getStore(item.store);
    const options = { onlyIfNew: true, metadata: item.metadata || {} };
    const result = item.kind === 'binary'
      ? await destination.set(item.key, Buffer.from(item.value, 'base64'), options)
      : await destination.setJSON(item.key, item.value, options);
    if (result.modified === false) throw new Error('Conflito de importação. O armazenamento original permanece intacto.');
    const verified = await destination.get(item.key, { type: item.kind === 'binary' ? 'arrayBuffer' : 'json' });
    const matches = item.kind === 'binary' ? Buffer.from(verified || []).equals(Buffer.from(item.value, 'base64')) : isDeepStrictEqual(verified, item.value);
    if (!matches) throw new Error(`Não foi possível verificar o objeto ${item.store}/${item.key}. Não publique este destino.`);
  }
  console.log(`Importação verificada: ${backup.objects.length} objetos. Confira conteúdo e imagens antes de publicar.`);
}
