(() => {
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(values) {
    const response=await fetch('/api/community?action=moderation',values?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'moderation',...values}),credentials:'same-origin'}:{credentials:'same-origin'});
    const result=await response.json();if(!response.ok) throw Error(result.error);return result;
  }
  async function render(root) {
    root.innerHTML='<header class="page-title"><div><span>COMUNIDADE</span><h1>Moderação</h1><p>Denúncias, publicações e contas da comunidade.</p></div></header><p>Carregando…</p>';
    try {
      const data=await request();
      if(!document.querySelector('#adminNav [data-section="community"]').classList.contains('active')) return;
      const postFor=report=>data.posts.find(p=>p.id===report.postId);
      const postButtons=p=>`<button data-moderate='${escape(JSON.stringify({operation:'post',kind:p.kind,discussionId:p.discussionId,postId:p.id,hidden:!p.hidden}))}'>${p.hidden?'Restaurar':'Ocultar'}</button>`;
      root.innerHTML=`<header class="page-title"><div><span>COMUNIDADE</span><h1>Moderação</h1><p>Mensagens são publicadas imediatamente. Ocultar mantém o registro para revisão.</p></div></header><p id="communityAdminStatus" role="status"></p><section class="community-admin-section"><h2>Denúncias abertas (${data.reports.length})</h2>${data.reports.length?data.reports.map(r=>{const p=postFor(r);return `<article><b>${escape(r.username)}</b><p>Motivo: ${escape(r.reason)}</p>${p?`<p>${escape(p.username)}: ${escape(p.body)}</p>${postButtons(p)}`:`<p>Publicação: ${escape(r.postId)}</p>`}<button data-moderate='${escape(JSON.stringify({operation:'report',reportId:r.id}))}'>Resolver denúncia</button></article>`;}).join(''):'<p>Nenhuma denúncia aberta.</p>'}</section><section class="community-admin-section"><h2>Publicações recentes</h2>${data.posts.map(p=>`<article><b>${escape(p.username)} · ${p.hidden?'Ocultada':'Visível'}</b><small>${escape(p.title)}</small><p>${escape(p.body)}</p>${postButtons(p)}</article>`).join('')||'<p>Ainda não há publicações.</p>'}</section><section class="community-admin-section"><h2>Tópicos</h2>${data.topics.map(t=>`<article><b>${escape(t.title)}</b><button data-moderate='${escape(JSON.stringify({operation:'topic',kind:'forum',discussionId:t.id,hidden:t.hidden,locked:!t.locked}))}'>${t.locked?'Reabrir':'Fechar respostas'}</button><button data-moderate='${escape(JSON.stringify({operation:'topic',kind:'forum',discussionId:t.id,hidden:!t.hidden,locked:t.locked}))}'>${t.hidden?'Restaurar tópico':'Ocultar tópico'}</button></article>`).join('')||'<p>Ainda não há tópicos.</p>'}</section><section class="community-admin-section"><h2>Contas</h2>${data.users.map(u=>`<article><b>${escape(u.username)}</b><span>${u.active?'Ativa':'Suspensa'}</span><button data-moderate='${escape(JSON.stringify({operation:'user',username:u.username,active:!u.active}))}'>${u.active?'Suspender':'Reativar'}</button></article>`).join('')||'<p>Ainda não há contas.</p>'}</section>`;
      root.querySelectorAll('[data-moderate]').forEach(button=>button.addEventListener('click',async()=>{
        button.disabled=true;
        try {await request(JSON.parse(button.dataset.moderate));await render(root);} catch(error) {root.querySelector('#communityAdminStatus').textContent=error.message;button.disabled=false;}
      }));
    } catch(error) {root.innerHTML=`<h1>Moderação</h1><p role="alert">${escape(error.message)}</p>`;}
  }
  window.HLTPC_COMMUNITY_ADMIN={render};
})();
