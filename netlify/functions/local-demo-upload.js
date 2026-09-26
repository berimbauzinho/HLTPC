const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const auth = require('./auth-utils');

// Local server only: streams the .dem to a temporary file instead of sending
// hundreds of MB through a Netlify Function or the browser WASM parser.
async function localDemoUpload(req, res) {
  const config = auth.configuration();
  const session = config && auth.readSession(req.headers.cookie, config.secret);
  if (!session || session.mustChangePassword) return res.status(403).json({ error: 'Acesso administrativo necessário.' });
  let directory;
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
    const { getContent } = await import('./content-store-v2.mjs');
    const content = await getContent();
    const match = content.matches.find((item) => item.id === req.query.matchId);
    if (!match) return res.status(404).json({ error: 'Salve a partida antes de enviar a demo.' });
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hltpc-local-demo-'));
    const file = path.join(directory, 'match.dem');
    let bytes = 0;
    const limit = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(bytes > 1500 * 1024 * 1024 ? Object.assign(new Error('A demo ultrapassa 1.5 GB.'), { statusCode: 413 }) : null, chunk);
    } });
    await pipeline(req, limit, fs.createWriteStream(file));
    const handle = await fs.promises.open(file, 'r');
    const signature = Buffer.alloc(8);
    try { await handle.read(signature, 0, 8, 0); } finally { await handle.close(); }
    if (!signature.toString().startsWith('PBDEMS2')) return res.status(422).json({ error: 'O arquivo não é uma demo CS2 válida.' });
    const { processDemoPath } = require('./demo-processor');
    const fileName = path.basename(decodeURIComponent(String(req.headers['x-demo-name'] || 'match.dem')));
    const processed = processDemoPath(file, match, content, { fileName, fileSize: bytes });
    return res.json(processed); // Admin reviews/persists with its expected revision.
  } catch (error) { if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.message }); }
  finally { if (directory) await fs.promises.rm(directory, { recursive: true, force: true }); }
}
module.exports = { localDemoUpload };
