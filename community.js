(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  let user = null, returnTo = sessionStorage.getItem('hltpc-login-return') || '#conta', generation = 0;
  async function api(action, values, query = {}) {
    const response = await fetch(`/api/community?${new URLSearchParams({action,...query})}`, values ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...values}),credentials:'same-origin'} : {credentials:'same-origin'});
    const result = await response.json();
    if(!response.ok) throw Error(result.error || 'Não foi possível concluir. Tente novamente.');
    return result;
  }
  function header() { const link=document.querySelector('#communityAccount'); link.textContent=user ? `@${user.username}` : 'Entrar'; link.href=user?'#conta':'#entrar'; }
  const message = (root, value) => { const target=root.querySelector('[data-message]'); if(target) target.textContent=value; };
  const login = (verb='postar') => `<p class="community-login-note"><a class="community-primary" href="#entrar" data-community-return="${escape(location.hash)}">Entrar para ${verb}</a></p>`;
  const postForm = (kind,id) => user ? `<form class="community-form" data-community-form="post"><input type="hidden" name="kind" value="${kind}"/><input type="hidden" name="discussionId" value="${escape(id)}"/><label>Sua mensagem<textarea name="body" maxlength="2000" rows="4" required placeholder="Converse com respeito. Até 2.000 caracteres."></textarea></label><button class="community-primary" type="submit">Publicar como ${escape(user.username)}</button><p data-message role="status" aria-live="polite"></p></form>` : login(kind==='news'?'comentar':'responder');
  function auth(route) {
    const root=document.querySelector('#'+({entrar:'loginPage',cadastro:'signupPage',recuperar:'recoveryPage'}[route]));
    if(user) {location.hash=returnTo;return;}
    const signup=route==='cadastro', recovery=route==='recuperar';
    root.innerHTML=`<div class="hltpc-auth-shell"><section class="hltpc-auth-card"><a class="hltpc-auth-brand" href="#inicio">HLTPC<span>Sua conta. Sua comunidade.</span></a><h1>${signup?'Crie sua conta':recovery?'Recupere sua conta':'Faça seu login'}</h1><form class="community-form" data-community-form="${signup?'signup':recovery?'recover':'login'}"><label>Nickname<input name="username" autocomplete="username" minlength="3" maxlength="24" required/></label>${recovery?'<label>Chave de recuperação<input name="recoveryCode" autocomplete="off" required/></label>':''}<label>${recovery?'Nova senha':'Senha'}<input name="password" type="password" autocomplete="${signup||recovery?'new-password':'current-password'}" ${signup||recovery?'minlength="12"':''} maxlength="128" required/></label>${signup||recovery?'<label>Repita a senha<input name="confirmation" type="password" autocomplete="new-password" minlength="12" required/></label><p class="hltpc-auth-hint">Use uma senha de pelo menos 12 caracteres. Guarde a chave de recuperação que aparecerá ao concluir.</p>':''}<button class="community-primary" type="submit">${signup?'Criar conta':recovery?'Recuperar conta':'Entrar'}</button><p data-message role="status" aria-live="polite"></p></form><nav class="hltpc-auth-links">${route==='entrar'?'<a href="#recuperar">Esqueci minha senha</a><span>Ainda não tem conta? <a href="#cadastro">Cadastre-se</a></span>':'<a href="#entrar">Voltar ao login</a>'}</nav></section></div>`;
  }
  async function account(token) {
    if(!user) {location.hash='#entrar';return;}
    const root=document.querySelector('#accountPage');
    root.innerHTML=`<header class="page-heading"><span>MINHA CONTA HLTPC</span><h1>${escape(user.username)}</h1><p>Seu perfil nas notícias, no fórum e em toda a comunidade.</p></header><div class="hltpc-profile-grid"><form class="community-form" data-community-form="profile"><h2>Personalize seu perfil</h2><label>Nickname<input readonly value="${escape(user.username)}"/></label><label>Sobre você<textarea name="bio" maxlength="500" rows="4" placeholder="Conte um pouco sobre você">${escape(user.bio)}</textarea></label><label>Time que você torce<select name="favoriteTeam"><option value="">Sem time favorito</option>${user.favoriteTeam?`<option selected value="${escape(user.favoriteTeam)}">${escape(user.favoriteTeam)}</option>`:''}</select></label><button class="community-primary">Salvar perfil</button><p data-message role="status" aria-live="polite"></p></form><aside class="community-panel hltpc-profile-summary"><div class="hltpc-user-avatar">${escape(user.username.slice(0,2).toUpperCase())}</div><h2>${escape(user.username)}</h2><a href="#usuario/${encodeURIComponent(user.username)}">Ver meu perfil público →</a><a href="#forum">Ir ao fórum →</a><button type="button" data-community-logout>Sair da conta</button><p data-message role="status"></p></aside></div><details class="community-recovery"><summary>Segurança · Alterar senha</summary><form class="community-form hltpc-password-form" data-community-form="password"><label>Senha atual<input name="currentPassword" type="password" autocomplete="current-password" required/></label><label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required/></label><label>Repita a nova senha<input name="confirmation" type="password" autocomplete="new-password" minlength="12" required/></label><button class="community-primary">Salvar senha</button><p data-message role="status" aria-live="polite"></p></form></details>`;
    try {const response=await fetch('/api/content');if(!response.ok) throw Error();const content=await response.json();if(token!==generation) return;const teams=content.teams||content.content?.teams||[];const select=root.querySelector('[name="favoriteTeam"]');select.innerHTML='<option value="">Sem time favorito</option>'+teams.filter(t=>t.status!=='draft').map(t=>`<option value="${escape(t.name)}" ${t.name===user.favoriteTeam?'selected':''}>${escape(t.name)}</option>`).join('');}catch {if(token===generation) message(root,'Não foi possível carregar os times. Tente novamente.');}
  }
  async function profile(name,token) {
    const root=document.querySelector('#userPage');root.innerHTML='<p>Carregando perfil…</p>';
    try {const result=await api('profile',null,{username:decodeURIComponent(name)});if(token!==generation)return;const member=result.user;root.innerHTML=`<a class="profile-back" href="#forum">← Fórum HLTPC</a><section class="community-panel hltpc-public-profile"><div class="hltpc-user-avatar">${escape(member.username.slice(0,2).toUpperCase())}</div><span>MEMBRO HLTPC</span><h1>${escape(member.username)}</h1><p class="hltpc-profile-bio">${escape(member.bio||'Este membro ainda não adicionou uma apresentação.')}</p>${member.favoriteTeam?`<p>Torcedor de <strong>${escape(member.favoriteTeam)}</strong></p>`:''}<small>Membro desde ${new Date(member.createdAt).toLocaleDateString('pt-BR')}</small>${user?.username===member.username?'<p><a href="#conta">Editar meu perfil →</a></p>':''}</section>`;}catch(error){if(token===generation)root.innerHTML=`<p role="alert">${escape(error.message)}</p>`;}
  }
  async function forum(token) {
    const root=document.querySelector('#forumPage');
    root.innerHTML=`<header class="page-heading"><span>COMUNIDADE</span><h1>Fórum HLTPC</h1><p>CS2, campeonatos e a resenha entre os jogos.</p></header><p class="community-rules">Converse com respeito. Publicações podem ser denunciadas; a moderação pode ocultar mensagens, fechar tópicos e suspender contas.</p>${user ? `<details class="community-new-topic"><summary>Criar tópico</summary><form class="community-form" data-community-form="topic"><label>Título<input name="title" maxlength="120" required/></label><label>Categoria<select name="category"><option>Geral</option><option>Campeonatos</option><option>CS2</option></select></label><label>Mensagem<textarea name="body" rows="5" maxlength="2000" required></textarea></label><button class="community-primary">Publicar tópico</button><p data-message role="status" aria-live="polite"></p></form></details>` : login()}<div id="forumTopics" class="community-topics"><p>Carregando tópicos…</p></div>`;
    try {
      const {topics}=await api('topics'); if(token!==generation) return;
      root.querySelector('#forumTopics').innerHTML=topics.length ? topics.map(t=>`<a class="community-topic" href="#topico/${escape(t.id)}"><div><small>${escape(t.category)}${t.locked?' · Fechado':''}</small><h2>${escape(t.title)}</h2><p>por ${escape(t.username)} · ${date(t.createdAt)}</p></div><span>${t.replies} resposta${t.replies===1?'':'s'} <b>→</b></span></a>`).join('') : '<div class="community-panel"><h2>A conversa começa aqui</h2><p>Crie o primeiro tópico da comunidade.</p></div>';
    } catch(error) { if(token===generation) root.querySelector('#forumTopics').textContent=error.message; }
  }
  async function discussion(root,kind,id,page=1) {
    const token=generation;
    root.innerHTML='<p>Carregando conversa…</p>';
    try {
      const result=await api('discussion',null,{kind,id,page:String(page)});
      if(token!==generation || !root.isConnected) return;
      root.innerHTML=`${kind==='forum'?`<a class="profile-back" href="#forum">← Voltar ao fórum</a><header class="page-heading"><span>${escape(result.category)}</span><h1>${escape(result.title)}</h1></header>`:'<h2>Comentários</h2>'}<div class="community-posts">${result.posts.length ? result.posts.map(p=>`<article class="community-post"><header><a href="#usuario/${encodeURIComponent(p.username)}"><b>${escape(p.username)}</b></a><time>${date(p.createdAt)}</time></header><p>${escape(p.body)}</p>${user?`<details class="community-report"><summary>Denunciar</summary><form data-community-form="report" class="community-form"><input type="hidden" name="kind" value="${kind}"/><input type="hidden" name="discussionId" value="${escape(id)}"/><input type="hidden" name="postId" value="${escape(p.id)}"/><label>Motivo<textarea name="reason" maxlength="300" rows="2" required></textarea></label><button type="submit">Enviar denúncia</button><p data-message role="status" aria-live="polite"></p></form></details>`:''}</article>`).join(''):'<p>Ainda não há comentários. Seja o primeiro a participar.</p>'}</div>${result.total>20?`<nav class="community-pagination" aria-label="Páginas da conversa">${page>1?`<button data-discussion-page="${page-1}">← Anterior</button>`:''}<span>Página ${page} de ${Math.ceil(result.total/20)}</span>${page*20<result.total?`<button data-discussion-page="${page+1}">Próxima →</button>`:''}</nav>`:''}${result.locked?'<p class="community-login-note">Este tópico está fechado para novas respostas.</p>':postForm(kind,id)}`;
      root.dataset.kind=kind;root.dataset.discussion=id;
    } catch(error) { if(token===generation) root.innerHTML=`<p role="alert">${escape(error.message)}</p><a href="#forum">Voltar ao fórum</a>`; }
  }
  function render() {
    generation++;
    const [route,id]=location.hash.slice(1).split('/');
    if(route==='conta') account(generation);
    if(['entrar','cadastro','recuperar'].includes(route)) auth(route);
    if(route==='usuario' && id) profile(id,generation);
    if(route==='forum') forum(generation);
    if(route==='topico' && id) discussion(document.querySelector('#topicPage'),'forum',decodeURIComponent(id));
    if(route==='noticia' && id) {
      const article=document.querySelector('#newsPage .news-detail-page');
      if(!article) return;
      document.querySelector('#newsComments')?.remove();
      const root=document.createElement('section');root.id='newsComments';root.className='community-discussion';article.after(root);
      discussion(root,'news',decodeURIComponent(id));
    }
  }
  document.addEventListener('click',async event=>{
    const returning=event.target.closest('[data-community-return]');
    if(returning) {returnTo=returning.dataset.communityReturn;sessionStorage.setItem('hltpc-login-return',returnTo);}
    else if(event.target.closest('#communityAccount')) {returnTo='#conta';sessionStorage.removeItem('hltpc-login-return');}
    const page=event.target.closest('[data-discussion-page]');
    if(page) {const root=page.closest('.community-discussion'); await discussion(root,root.dataset.kind,root.dataset.discussion,Number(page.dataset.discussionPage));}
    const logout=event.target.closest('[data-community-logout]');
    if(logout) {try {await api('logout',{});user=null;header();render();} catch(error) {message(logout.parentElement,error.message);} }
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-community-form]'); if(!form) return;
    event.preventDefault();
    const action=form.dataset.communityForm, values=Object.fromEntries(new FormData(form));
    if(values.confirmation!==undefined && values.password!==values.confirmation) {message(form,'As senhas não coincidem.');return;}
    const button=form.querySelector('button[type="submit"],button:not([type])');button.disabled=true;message(form,'Enviando…');
    try {
      const result=await api(action,values);
      if(['login','signup','recover'].includes(action)) {
        user=result.user;header();
        if(result.recoveryCode) {
          form.closest('.hltpc-auth-shell').innerHTML=`<div class="community-panel community-recovery-key"><h1>Conta pronta, ${escape(user.username)}</h1><p>Guarde esta chave em um lugar seguro. Ela permite recuperar sua conta se esquecer a senha e só aparece agora.</p><label>Chave de recuperação<input readonly value="${escape(result.recoveryCode)}" aria-label="Chave de recuperação"/></label><a class="community-primary" href="${escape(returnTo)}">Continuar →</a></div>`;
        } else {location.hash=returnTo;render();}
      } else if(action==='topic') location.hash=`topico/${result.id}`;
      else if(action==='post') await discussion(form.closest('.community-discussion'),values.kind,values.discussionId,result.page);
      else if(action==='profile') {user=result.user;header();message(form,'Perfil atualizado.');}
      else if(action==='report') {form.reset();message(form,'Denúncia enviada para a moderação.');}
      else {form.reset();message(form,'Senha alterada.');}
    } catch(error) {message(form,error.message);} finally {button.disabled=false;}
  });
  window.addEventListener('hltpc:view',render);
  api('session').then(result=>{user=result.user;header();render();}).catch(()=>{header();});
})();
