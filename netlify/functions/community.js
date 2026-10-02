const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { AsyncLocalStorage } = require('node:async_hooks');
const storage = require('./storage');
const { json, safeEqual, configuration, validateSession } = require('./auth-utils');
const derive = promisify(crypto.scrypt);
const COOKIE = 'hltpc_community';
const HOURS = 8 * 3600;
const fail = (status, message) => { throw Object.assign(new Error(message), { statusCode: status }); };
const namespace = new AsyncLocalStorage();
const store = () => storage.getStore(namespace.getStore() || 'hltpc-community');
const secret = () => {
  const configured = configuration();
  if (!configured) fail(503, 'A comunidade está temporariamente indisponível.');
  return crypto.createHmac('sha256', configured.secret).update('community-session-v1').digest('hex');
};
const sign = value => crypto.createHmac('sha256', secret()).update(value).digest('base64url');
const nickname = value => {
  const name = String(value || '').trim();
  if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(name)) fail(422, 'Use um nickname de 3 a 24 letras, números, _ ou -.');
  return name;
};
const keyForUser = name => `user/${nickname(name).normalize('NFKC').toLowerCase()}`;
const text = (value, max, label) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) fail(422, `${label}: preencha até ${max} caracteres.`);
  return result;
};
const password = value => {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(422, 'A senha deve ter entre 12 e 128 caracteres.');
  return value;
};
async function hash(value, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: (await derive(value, salt, 64)).toString('hex') };
}
async function matches(value, record) {
  const candidate = await hash(String(value || ''), record?.salt || 'hltpc-dummy-credential');
  return Boolean(record && safeEqual(candidate.hash, record.hash));
}
function cookie(value, age = HOURS) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
}
function sessionCookie(user) {
  const payload = Buffer.from(JSON.stringify({ username: user.username, version: user.version, exp: Date.now() + HOURS * 1000 })).toString('base64url');
  return cookie(`${payload}.${sign(payload)}`);
}
function publicUser(user) { return { username: user.username, active: user.active, createdAt: user.createdAt, bio: user.bio || '', favoriteTeam: user.favoriteTeam || '' }; }
async function currentUser(event, required = false) {
  const raw = String(event.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  let user = null;
  if (raw) {
    const [payload, signature] = raw.split('.');
    if (payload && signature && safeEqual(sign(payload), signature)) {
      try {
        const session = JSON.parse(Buffer.from(payload, 'base64url'));
        if (session.exp > Date.now()) {
          const found = await store().get(keyForUser(session.username), { type: 'json' });
          if (found?.active && found.version === session.version) user = found;
        }
      } catch (error) { if (error.statusCode === 503) throw error; }
    }
  }
  if (required && !user) fail(401, 'Entre na sua conta para participar.');
  return user;
}
function requireSameOrigin(event) {
  const origin = event.headers?.origin;
  const host = event.headers?.host;
  let parsed;
  try { parsed = new URL(origin); } catch { fail(403, 'Origem da solicitação inválida.'); }
  if (parsed.host !== host || !['https:', 'http:'].includes(parsed.protocol)) fail(403, 'Origem da solicitação inválida.');
  if (!String(event.headers?.['content-type'] || '').startsWith('application/json')) fail(415, 'Envie os dados em JSON.');
}
async function mutate(key, initial, updater) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await store().getWithMetadata(key, { type: 'json' });
    const value = existing ? structuredClone(existing.data) : structuredClone(initial);
    await updater(value);
    const saved = await store().setJSON(key, value, existing ? { onlyIfMatch: existing.etag } : { onlyIfNew: true });
    if (saved.modified) return value;
  }
  fail(409, 'Outra publicação chegou ao mesmo tempo. Tente novamente.');
}
async function rate(event, category, identity, limit, windowSeconds) {
  // Netlify supplies this header; do not trust client-forwarded IP headers.
  const ip = event.headers?.['x-nf-client-connection-ip'] || 'local';
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const digest = sign(`${category}:${identity || ip}`);
  await mutate(`rate/${category}/${digest}`, { count: 0, bucket }, value => {
    if (value.bucket !== bucket) { value.count = 0; value.bucket = bucket; }
    if (value.count >= limit) fail(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    value.count++;
  });
}
function discussionKey(kind, id) {
  if (!['news', 'forum'].includes(kind) || !/^[a-zA-Z0-9_-]{1,120}$/.test(String(id || ''))) fail(422, 'Discussão inválida.');
  return `discussion/${kind}/${id}`;
}
async function validDiscussion(kind, id) {
  const key = discussionKey(kind, id);
  if (kind === 'news') {
    const content = await (await import('./content-store-v2.mjs')).getContent();
    if (!content.news.some(n => n.id === id && n.status === 'published')) fail(404, 'Notícia não encontrada.');
  }
  const discussion = await store().get(key, { type: 'json' });
  if (kind === 'forum' && (!discussion || discussion.hidden)) fail(404, 'Tópico não encontrado.');
  return { key, discussion };
}
function visibleDiscussion(discussion, page = 1) {
  const posts = (discussion?.posts || []).filter(p => !p.hidden);
  return { id: discussion?.id, title: discussion?.title, category: discussion?.category, locked: Boolean(discussion?.locked), total: posts.length, page,
    posts: posts.slice((page - 1) * 20, page * 20).map(({ id, username, body, createdAt }) => ({ id, username, body, createdAt })) };
}
async function discussions(prefix) {
  const { blobs } = await store().list({ prefix });
  const results = [];
  // Bound public/admin work, while retaining each discussion independently.
  const recent = blobs.slice(-100);
  for (let start = 0; start < recent.length; start += 10) {
    results.push(...await Promise.all(recent.slice(start, start + 10).map(b => store().get(b.key, { type: 'json' }))));
  }
  return results.filter(Boolean);
}
async function moderation(event, body) {
  const admin = await validateSession(event.headers?.cookie, event);
  if (!admin || admin.mustChangePassword) fail(403, 'Acesso restrito ao painel administrativo.');
  if (event.httpMethod === 'GET') {
    const entries = await discussions('discussion/');
    const { blobs } = await store().list({ prefix: 'report/' });
    const reports = await Promise.all(blobs.slice(-100).map(b => store().get(b.key, { type: 'json' })));
    const users = await store().list({ prefix: 'user/' });
    const safeUsers = await Promise.all(users.blobs.slice(0, 100).map(async b => publicUser(await store().get(b.key, { type: 'json' }))));
    return json(200, { reports: reports.filter(r => r && !r.resolved), users: safeUsers,
      topics: entries.filter(d => d.kind === 'forum').map(d => ({ id: d.id, title: d.title, locked: d.locked, hidden: d.hidden })),
      posts: entries.flatMap(d => d.posts.map(p => ({ ...p, kind: d.kind, discussionId: d.id, title: d.title || 'Comentário em notícia' }))).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,100) });
  }
  if (body.operation === 'user') {
    await mutate(keyForUser(body.username), null, user => {
      if (!user) fail(404, 'Conta não encontrada.');
      user.active = body.active === true;
      user.version++;
    });
  } else if (body.operation === 'report') {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(body.reportId || '')) fail(422, 'Denúncia inválida.');
    await mutate(`report/${body.reportId}`, null, report => {
      if (!report) fail(404, 'Denúncia não encontrada.');
      report.resolved = true;
    });
  } else {
    const key = discussionKey(body.kind, body.discussionId);
    await mutate(key, null, discussion => {
      if (!discussion) fail(404, 'Discussão não encontrada.');
      if (body.operation === 'post') {
        const post = discussion.posts.find(p => p.id === body.postId);
        if (!post) fail(404, 'Publicação não encontrada.');
        post.hidden = body.hidden === true;
      } else if (body.operation === 'topic' && discussion.kind === 'forum') {
        discussion.hidden = body.hidden === true;
        discussion.locked = body.locked === true;
      } else fail(422, 'Ação de moderação inválida.');
      discussion.audit ||= [];
      discussion.audit.push({ actor: admin.sub, operation: body.operation, postId: body.postId || null, hidden: body.hidden === true, locked: body.locked === true, at: new Date().toISOString() });
    });
  }
  return json(200, { saved: true });
}
async function handle(event) {
  try {
    storage.connectLambda(event);
    const method = event.httpMethod;
    if (!['GET','POST'].includes(method)) return json(405, { error: 'Método não permitido.' });
    if (Buffer.byteLength(event.body || '') > 16000) fail(413, 'Solicitação muito grande.');
    let body = {};
    if (method === 'POST') {
      requireSameOrigin(event);
      try { body = JSON.parse(event.body || '{}'); } catch { fail(400, 'Dados inválidos.'); }
    }
    const query = event.queryStringParameters || {};
    const action = method === 'GET' ? query.action : body.action;
    if (action === 'moderation') return await moderation(event, body);
    if (method === 'GET') {
      if (action === 'session') { const user = await currentUser(event); return json(200, { user: user ? publicUser(user) : null }); }
      if (action === 'profile') {
        const member = await store().get(keyForUser(query.username), {type:'json'});
        if (!member?.active) fail(404,'Perfil não encontrado.');
        return json(200,{user:publicUser(member)});
      }
      if (action === 'topics') {
        const topics = (await discussions('discussion/forum/')).filter(d => !d.hidden).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
        return json(200, { topics: topics.map(d => ({ id: d.id, title: d.title, category: d.category, username: d.username, createdAt: d.createdAt, locked: Boolean(d.locked), replies: Math.max(0,d.posts.filter(p => !p.hidden).length - 1) })) });
      }
      if (action === 'discussion') {
        const { discussion } = await validDiscussion(query.kind, query.id);
        const page = Math.max(1,Math.min(100, Number.parseInt(query.page,10) || 1));
        return json(200, visibleDiscussion(discussion, page));
      }
      fail(404, 'Recurso não encontrado.');
    }
    if (['signup','login','recover'].includes(action)) {
      await rate(event, 'auth-ip', null, 20, 600);
      const name = nickname(body.username);
      await rate(event, 'auth-user', keyForUser(name), 10, 600);
      if (action === 'signup') {
        await rate(event, 'signup', null, 3, 3600);
        const recoveryCode = crypto.randomBytes(24).toString('base64url');
        const user = { username: name, credential: await hash(password(body.password)), recovery: await hash(recoveryCode), active: true, version: 1, createdAt: new Date().toISOString() };
        const result = await store().setJSON(keyForUser(name), user, { onlyIfNew: true });
        if (!result.modified) fail(409, 'Esse nickname já está em uso.');
        return json(201, { user: publicUser(user), recoveryCode }, { 'Set-Cookie': sessionCookie(user) });
      }
      const user = await store().get(keyForUser(name), { type: 'json' });
      if (action === 'recover') {
        if (!await matches(body.recoveryCode, user?.recovery) || !user?.active) fail(401, 'Nickname ou chave de recuperação inválidos.');
        const nextPassword = password(body.password);
        const recoveryCode = crypto.randomBytes(24).toString('base64url');
        const saved = await mutate(keyForUser(name), null, async record => {
          if (!record?.active || record.version !== user.version) fail(409, 'A conta mudou. Tente novamente.');
          record.credential = await hash(nextPassword); record.recovery = await hash(recoveryCode); record.version++;
        });
        return json(200, { user: publicUser(saved), recoveryCode }, { 'Set-Cookie': sessionCookie(saved) });
      }
      if (typeof body.password !== 'string' || body.password.length > 128) fail(401, 'Nickname ou senha inválidos.');
      if (!await matches(body.password, user?.credential) || !user?.active) fail(401, 'Nickname ou senha inválidos.');
      return json(200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
    }
    if (action === 'logout') return json(200, { loggedOut: true }, { 'Set-Cookie': cookie('',0) });
    const user = await currentUser(event, true);
    if (action === 'profile') {
      const bio = typeof body.bio === 'string' ? body.bio.trim() : '';
      const favoriteTeam = typeof body.favoriteTeam === 'string' ? body.favoriteTeam.trim() : '';
      if (bio.length > 500 || favoriteTeam.length > 120) fail(422,'Perfil: apresentação de até 500 caracteres e um time válido.');
      if (favoriteTeam) {
        const content = await require('./content-store').getContent(event);
        if (!content.teams.some(team => team.name === favoriteTeam && team.status !== 'draft')) fail(422,'Escolha um time disponível no HLTPC.');
      }
      await rate(event,'profile',user.username,10,3600);
      const saved = await mutate(keyForUser(user.username),null,record => {
        if (!record?.active || record.version !== user.version) fail(409,'A conta mudou. Entre novamente.');
        record.bio=bio; record.favoriteTeam=favoriteTeam;
      });
      return json(200,{user:publicUser(saved)});
    }
    if (action === 'password') {
      await rate(event, 'password', user.username, 5, 600);
      if (!await matches(body.currentPassword,user.credential)) fail(401,'A senha atual está incorreta.');
      const credential = await hash(password(body.password));
      const saved = await mutate(keyForUser(user.username), null, record => {
        if (!record?.active || record.version !== user.version) fail(409,'A conta mudou. Entre novamente.');
        record.credential = credential; record.version++;
      });
      return json(200,{ saved:true },{ 'Set-Cookie':sessionCookie(saved) });
    }
    if (action === 'topic') {
      await rate(event, 'topic', user.username, 3, 3600);
      const title = text(body.title,120,'Título');
      const content = text(body.body,2000,'Mensagem');
      const category = ['Geral','Campeonatos','CS2'].includes(body.category) ? body.category : 'Geral';
      const id = `${Date.now()}-${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const discussion = { id, kind:'forum', title, category, username:user.username, createdAt, locked:false, hidden:false, posts:[{ id:crypto.randomUUID(),username:user.username,body:content,createdAt,hidden:false }] };
      const result = await store().setJSON(discussionKey('forum',id),discussion,{onlyIfNew:true});
      if(!result.modified) fail(409,'Tente criar o tópico novamente.');
      return json(201,{id});
    }
    if (action === 'post') {
      await rate(event,'post',user.username,5,60);
      const content = text(body.body,2000,'Mensagem');
      const { key } = await validDiscussion(body.kind,body.discussionId);
      const createdAt = new Date().toISOString(), id = crypto.randomUUID();
      const discussion = await mutate(key,{id:body.discussionId,kind:body.kind,posts:[],createdAt},record => {
        if(record.hidden || record.locked) fail(403,'Esta discussão está fechada para novas respostas.');
        if(record.posts.length >= 1000) fail(422,'Esta discussão atingiu o limite de respostas. Abra um novo tópico.');
        record.posts.push({id,username:user.username,body:content,createdAt,hidden:false});
      });
      return json(201,{saved:true,page:Math.ceil(discussion.posts.filter(p=>!p.hidden).length/20)});
    }
    if (action === 'report') {
      await rate(event,'report',user.username,10,3600);
      const { discussion } = await validDiscussion(body.kind,body.discussionId);
      if(!discussion?.posts.some(p=>p.id===body.postId && !p.hidden)) fail(404,'Publicação não encontrada.');
      const id = sign(`${user.username}:${body.postId}`);
      await store().setJSON(`report/${id}`,{id,kind:body.kind,discussionId:body.discussionId,postId:body.postId,username:user.username,reason:text(body.reason,300,'Motivo'),createdAt:new Date().toISOString(),resolved:false},{onlyIfNew:true});
      return json(200,{saved:true});
    }
    fail(404,'Ação não encontrada.');
  } catch (error) {
    if (!error.statusCode) console.error('Community operation failed', error.name);
    return json(error.statusCode || 503, { error: error.statusCode ? error.message : 'Não foi possível concluir. Tente novamente em alguns instantes.' });
  }
}
// Each immutable preview has an isolated community. Publishing starts with real accounts only.
exports.handler = event => {
  const preview = String(event.headers?.host || '').match(/^([a-f0-9]{24})--hltpc\.netlify\.app$/);
  return namespace.run(preview ? `hltpc-community-preview-${preview[1]}` : 'hltpc-community', () => handle(event));
};
