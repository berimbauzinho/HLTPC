const crypto = require('node:crypto');
const {configuration,validateSession,createSession,cookie,json,hashPassword,verifyPassword,safeEqual} = require('./auth-utils');
const {listUsers,saveUsers} = require('./user-store');
const {readOwnerCredential,saveOwnerCredential} = require('./owner-credential');
exports.handler = async event => {
  try {
    if(event.httpMethod !== 'POST') return json(405,{error:'Método não permitido.'});
    let origin;
    try {origin=new URL(event.headers.origin);} catch (_) {return json(403,{error:'Origem inválida.'});}
    if(origin.host!==event.headers.host || !['https:','http:'].includes(origin.protocol)) return json(403,{error:'Origem inválida.'});
    if(!String(event.headers['content-type']||'').startsWith('application/json')) return json(415,{error:'Envie os dados em JSON.'});
    if(String(event.body||'').length>2048) return json(413,{error:'Solicitação muito grande.'});
    const config=configuration();
    const session=await validateSession(event.headers.cookie,event);
    if(!session || !['owner','admin'].includes(session.role)) return json(401,{error:'Entre novamente no painel.'});
    let body;
    try {body=JSON.parse(event.body||'{}');} catch (_) {return json(400,{error:'Dados inválidos.'});}
    const minimum=session.role==='owner'?12:8;
    if(typeof body.password!=='string' || body.password.length<minimum || body.password.length>256) return json(422,{error:`A nova senha precisa ter de ${minimum} a 256 caracteres.`});
    if(body.password==='mudar1234') return json(422,{error:'Escolha uma senha diferente da temporária.'});
    if(session.role==='owner') {
      const previous=await readOwnerCredential(event,config.username);
      if(typeof body.currentPassword!=='string' || body.currentPassword.length>256 || !(previous?verifyPassword(body.currentPassword,previous.data):safeEqual(body.currentPassword,config.password))) return json(401,{error:'A senha atual está incorreta.'});
      if(safeEqual(body.password,body.currentPassword)) return json(422,{error:'Escolha uma senha diferente da atual.'});
      const record={...hashPassword(body.password),authVersion:crypto.randomUUID(),changedAt:new Date().toISOString()};
      await saveOwnerCredential(event,config.username,previous,record);
      return json(200,{user:{username:config.username,role:'owner',mustChangePassword:false}},{'Set-Cookie':cookie(createSession(config.username,config.secret,'owner',false,record.authVersion))});
    }
    const users=await listUsers(event);
    const index=users.findIndex(u=>u.username===session.sub);
    if(index<0 || !users[index].active) return json(401,{error:'Usuário não autorizado.'});
    if(!session.mustChangePassword && (typeof body.currentPassword!=='string' || body.currentPassword.length>256 || !verifyPassword(body.currentPassword,users[index]))) return json(401,{error:'A senha atual está incorreta.'});
    if(body.password===body.currentPassword) return json(422,{error:'Escolha uma senha diferente da atual.'});
    users[index]={...users[index],...hashPassword(body.password),mustChangePassword:false,authVersion:crypto.randomUUID()};
    await saveUsers(event,users);
    return json(200,{user:{username:session.sub,role:'admin',mustChangePassword:false}},{'Set-Cookie':cookie(createSession(session.sub,config.secret,'admin',false,users[index].authVersion))});
  } catch(error) {return json(error.statusCode===409?409:503,{error:error.statusCode===409?error.message:'Não foi possível trocar a senha. Tente novamente.'});}
};
