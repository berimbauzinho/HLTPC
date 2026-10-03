const {connectLambda,getStore}=require('./storage');
const keyFor=username=>`owner/${String(username).trim().toLowerCase()}`;
function securityStore(event) {
  if(event?.httpMethod) connectLambda(event);
  const host=String(event?.headers?.host||'');
  const preview=host.match(/^([a-f0-9]{24})--hltpc\.netlify\.app$/);
  return getStore(preview?`hltpc-admin-security-preview-${preview[1]}`:'hltpc-admin-security');
}
async function readOwnerCredential(event,username) {
  let item=await securityStore(event).getWithMetadata(keyFor(username),{type:'json'});
  if(!item && /^([a-f0-9]{24})--hltpc\.netlify\.app$/.test(String(event?.headers?.host||''))) {
    const production=await securityStore().getWithMetadata(keyFor(username),{type:'json'});
    if(production) item={...production,inherited:true};
  }
  if(item && (!/^[a-f0-9]{32}$/.test(item.data?.salt||'') || !/^[a-f0-9]{128}$/.test(item.data?.hash||'') || !item.data?.authVersion)) throw Object.assign(new Error('Credencial indisponível.'),{statusCode:503});
  return item;
}
async function saveOwnerCredential(event,username,previous,credential) {
  const result=await securityStore(event).setJSON(keyFor(username),credential,previous&&!previous.inherited?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
  if(!result.modified) throw Object.assign(new Error('A senha mudou em outra sessão. Entre novamente.'),{statusCode:409});
}
module.exports={readOwnerCredential,saveOwnerCredential};
