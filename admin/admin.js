(() => {
  "use strict";

  const source = window.HLTPC_DATA;
  const state = {
    players: source.players.map((name, index) => ({ id: `player-${index}`, name, alias: "", status: "published", photo: "", updated: "Dados históricos" })),
    teams: [...new Set(source.tournaments.filter((event) => event.category === "major").flatMap((event) => event.entries.map((entry) => entry.team)))].map((name, index) => ({ id: `team-${index}`, name, acronym: initials(name), status: "published", logo: "", updated: "Derivado das edições" })),
    tournaments: source.tournaments.map((event) => ({ id: event.id, name: event.name, subtitle: String(event.year), status: "published", logo: "", format: event.format, formatType: "custom", teams: event.entries.map((entry) => entry.team), updated: event.status === "ongoing" ? "Em andamento" : `Campeão: ${event.champion}` })),
    matches: [],
    news: source.news.map((item) => ({ id: item.id, name: item.title, subtitle: item.summary, status: "published", updated: item.date })),
    files: []
  };

  const labels = { overview: "Visão geral", players: "Jogadores", teams: "Times", tournaments: "Campeonatos", matches: "Partidas", news: "Notícias", files: "Arquivos", users: "Usuários e acessos" };
  const singular = { players: "jogador", teams: "time", tournaments: "campeonato", matches: "partida", news: "notícia" };
  let section = "overview";
  let editingId = null;
  let search = "";

  const content = document.querySelector("#content");
  const dialog = document.querySelector("#editorDialog");
  const form = document.querySelector("#editorForm");
  const fields = document.querySelector("#formFields");
  const deleteButton = document.querySelector("#deleteButton");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

  function initials(value) {
    return value.replace(/gaming|e-sports/ig, "").trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  }

  function pageTitle(title, description, action = true) {
    return `<div class="page-title"><div><span>PAINEL HLTPC</span><h1>${title}</h1><p>${description}</p></div>${action ? `<button class="primary" data-add>＋ Adicionar ${singular[section]}</button>` : ""}</div>`;
  }

  function overview() {
    const published = ["players", "teams", "tournaments", "matches", "news"].flatMap((key) => state[key]).filter((item) => item.status === "published").length;
    content.innerHTML = `${pageTitle("Visão geral", "Gerencie o conteúdo que forma o histórico do HLTPC.", false)}
      <div class="stats">
        <article class="stat"><span>♟</span><div><small>Jogadores</small><b>${state.players.length}</b></div></article>
        <article class="stat"><span>◆</span><div><small>Times</small><b>${state.teams.length}</b></div></article>
        <article class="stat"><span>★</span><div><small>Campeonatos</small><b>${state.tournaments.length}</b></div></article>
        <article class="stat"><span>✓</span><div><small>Publicados</small><b>${published}</b></div></article>
      </div>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-title">O que você poderá fazer</div>
          ${[["✓","Cadastrar jogadores e aliases"],["✓","Criar times e selecionar logos"],["✓","Montar campeonatos e escalações"],["✓","Registrar partidas, mapas e resultados"],["✓","Publicar notícias compartilhadas"],["⇧","Enviar demos para processamento"]].map((item) => `<div class="activity"><span>${item[0]}</span><div><b>${item[1]}</b><small>Disponível para teste visual nesta demonstração</small></div></div>`).join("")}
        </section>
        <section class="panel"><div class="panel-title">Acesso rápido</div>
          ${[["players","♟"],["teams","◆"],["tournaments","★"],["matches","◫"],["files","⇧"]].map(([key, icon]) => `<button class="quick" data-go="${key}"><i>${icon}</i><span><b>${labels[key]}</b><small>Abrir gerenciamento</small></span><em>›</em></button>`).join("")}
        </section>
      </div>`;
    bindActions();
  }

  function listView() {
    const items = state[section].filter((item) => (item.name || "").toLowerCase().includes(search.toLowerCase()));
    const descriptions = {
      players: "Cadastre nicks, aliases e fotos sem duplicar o histórico.",
      teams: "Gerencie organizações e logos; elencos continuam ligados às edições.",
      tournaments: "Crie edições, formato, status, campeão e identidade visual.",
      matches: "Registre somente confrontos confirmados, fases, mapas e placares.",
      news: "Prepare notícias compartilhadas e escolha quando publicar."
    };
    content.innerHTML = `${pageTitle(labels[section], descriptions[section])}
      <div class="stats">
        <article class="stat"><span>◉</span><div><small>Total</small><b>${state[section].length}</b></div></article>
        <article class="stat"><span>✓</span><div><small>Publicados</small><b>${state[section].filter((item) => item.status === "published").length}</b></div></article>
        <article class="stat"><span>◷</span><div><small>Rascunhos</small><b>${state[section].filter((item) => item.status === "draft").length}</b></div></article>
        <article class="stat"><span>↻</span><div><small>Modo</small><b style="font-size:15px">Demo</b></div></article>
      </div>
      <div class="toolbar"><label class="search"><span>⌕</span><input id="adminSearch" value="${escapeHtml(search)}" placeholder="Buscar em ${labels[section].toLowerCase()}..." /></label><select><option>Todos os status</option><option>Publicados</option><option>Rascunhos</option></select><button>⇅ Ordenar</button><small>${items.length} resultados</small></div>
      ${items.length ? `<div class="data-table"><div class="table-head"><span>NOME</span><span>DETALHE</span><span>ORIGEM / ATUALIZAÇÃO</span><span>STATUS</span><span></span></div>${items.map(tableRow).join("")}</div>` : `<div class="empty"><span>＋</span><h3>Nenhum registro</h3><p>Adicione o primeiro ${singular[section]} para testar o fluxo.</p></div>`}`;
    bindActions();
    document.querySelector("#adminSearch")?.addEventListener("input", (event) => { search = event.target.value; listView(); document.querySelector("#adminSearch")?.focus(); });
  }

  function tableRow(item) {
    const image = item.photo || item.logo;
    return `<div class="table-row" data-edit="${escapeHtml(item.id)}">
      <div class="identity"><span class="avatar">${image ? `<img src="${escapeHtml(image)}" alt="" />` : initials(item.name)}</span><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.alias || item.acronym || singular[section])}</small></div></div>
      <span>${escapeHtml(item.subtitle || item.acronym || "—")}</span><span>${escapeHtml(item.updated || "Agora")}</span>
      <span class="badge ${item.status === "draft" ? "draft" : ""}">${item.status === "draft" ? "Rascunho" : "Publicado"}</span><button class="more">•••</button>
    </div>`;
  }

  function filesView() {
    content.innerHTML = `${pageTitle("Arquivos", "Teste a seleção de logos, imagens e demos. O upload real será feito pelo armazenamento do backend.", false)}
      <div class="file-grid">
        ${uploadCard("team-logo", "◆", "Logo de time", "PNG, JPG ou WebP para páginas e partidas.", "image/png,image/jpeg,image/webp")}
        ${uploadCard("tournament-logo", "★", "Logo de campeonato", "Identidade de cada edição do HLTPC.", "image/png,image/jpeg,image/webp")}
        ${uploadCard("demo", "▶", "Demo de partida", "Arquivo .dem para processamento futuro de estatísticas.", ".dem,application/octet-stream")}
      </div>
      <div class="panel" style="margin-top:13px"><div class="panel-title">Fila desta demonstração</div><div id="fileQueue">${state.files.length ? state.files.map((file) => `<div class="activity"><span>⇧</span><div><b>${escapeHtml(file.name)}</b><small>${escapeHtml(file.type)} · aguardando backend</small></div></div>`).join("") : `<div class="empty" style="border:0;padding:28px"><h3>Nenhum arquivo selecionado</h3><p>Use os campos acima para testar o fluxo.</p></div>`}</div></div>`;
    document.querySelectorAll(".upload-card input").forEach((input) => input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      state.files.unshift({ name: file.name, type: input.dataset.kind, size: file.size });
      showToast(`${file.name} entrou na fila de demonstração`);
      filesView();
    }));
  }

  async function usersView() {
    content.innerHTML = `${pageTitle("Usuários e acessos", "Confira quem pode entrar e administrar o HLTPC.", false)}
      <div class="access-grid"><div class="panel access-panel"><div class="panel-title">Contas autorizadas</div><div id="accessUsers"><div class="helper">Carregando usuários...</div></div></div>
      <form class="panel access-create" id="createUserForm"><div class="panel-title">Liberar novo acesso</div><label>Nome de usuário<input name="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9._-]+" placeholder="Ex.: romao" required /></label><button class="primary" type="submit">Criar usuário</button><div class="helper">O primeiro acesso será feito com <b>mudar1234</b>. Depois disso, a pessoa será obrigada a criar sua própria senha.</div><div class="access-error" id="createUserError" role="alert"></div></form></div>`;
    document.querySelector("#createUserForm").addEventListener("submit", createAdminUser);
    await loadAccessUsers();
  }

  async function accessRequest(options = {}) {
    const response = await fetch("/api/admin/users", { credentials: "same-origin", ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível atualizar os acessos.");
    return result;
  }

  async function loadAccessUsers() {
    const target = document.querySelector("#accessUsers");
    if (!target) return;
    try {
      const result = await accessRequest();
      target.innerHTML = result.users.map((user) => `<div class="access-user"><span>${initials(user.username)}</span><div><b>${escapeHtml(user.username)}</b><small>${user.mustChangePassword ? "Aguardando troca da senha temporária" : user.role === "owner" ? "Conta principal do HLTPC" : "Acesso ativo"}</small></div><em>${user.role.toUpperCase()}</em>${user.role !== "owner" ? `<button class="ghost" data-reset-user="${escapeHtml(user.username)}">Redefinir senha</button><button class="danger" data-remove-user="${escapeHtml(user.username)}">Remover</button>` : ""}</div>`).join("") + (result.storageError ? `<div class="helper storage-warning"><b>Armazenamento indisponível:</b> ${escapeHtml(result.storageError)}</div>` : "");
      target.querySelectorAll("[data-reset-user]").forEach((button) => button.addEventListener("click", () => updateAdminUser("reset", button.dataset.resetUser)));
      target.querySelectorAll("[data-remove-user]").forEach((button) => button.addEventListener("click", () => updateAdminUser("delete", button.dataset.removeUser)));
    } catch (reason) { target.innerHTML = `<div class="helper">${escapeHtml(reason.message)}</div>`; }
  }

  async function createAdminUser(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const errorTarget = document.querySelector("#createUserError");
    errorTarget.classList.remove("show");
    try {
      const username = new FormData(formElement).get("username");
      await accessRequest({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      formElement.reset(); showToast(`${username} foi liberado com a senha temporária mudar1234`); await loadAccessUsers();
    } catch (reason) { errorTarget.textContent = reason.message; errorTarget.classList.add("show"); showToast(reason.message); }
  }

  async function updateAdminUser(action, username) {
    if (action === "delete" && !confirm(`Remover o acesso de ${username}?`)) return;
    try {
      await accessRequest({ method: action === "delete" ? "DELETE" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      showToast(action === "delete" ? `${username} perdeu o acesso` : `Senha de ${username} redefinida para mudar1234`); await loadAccessUsers();
    } catch (reason) { showToast(reason.message); }
  }

  function uploadCard(id, icon, title, description, accept) {
    return `<article class="upload-card"><span>${icon}</span><h3>${title}</h3><p>${description}</p><label for="${id}">Clique para selecionar um arquivo<input id="${id}" data-kind="${title}" type="file" accept="${accept}" /></label><small class="selected-file">Nenhum arquivo selecionado</small></article>`;
  }

  function openEditor(id = null) {
    editingId = id;
    const item = id ? state[section].find((record) => record.id === id) : null;
    document.querySelector("#dialogEyebrow").textContent = item ? "EDITAR REGISTRO" : "NOVO REGISTRO";
    document.querySelector("#dialogTitle").textContent = item ? item.name : `Adicionar ${singular[section]}`;
    deleteButton.style.visibility = item ? "visible" : "hidden";
    fields.innerHTML = formFields(item || {});
    dialog.showModal();
    bindEditorDynamics();
  }

  function formFields(item) {
    if (section === "players") return `${textField("name", "Nick principal", item.name, "Ex.: lanches", true)}<div class="field-row">${textField("alias", "Alias / variação", item.alias, "Ex.: John Weed")}${selectField("status", item.status)}</div>${fileField("photo", "Foto do jogador", "image/*")}<div class="helper">O histórico de times e títulos não será digitado aqui: ele será calculado pelas escalações dos campeonatos.</div>`;
    if (section === "teams") return `${textField("name", "Nome oficial do time", item.name, "Ex.: Deftones", true)}<div class="field-row">${textField("acronym", "Sigla", item.acronym, "Ex.: DFT")}${selectField("status", item.status)}</div>${fileField("logo", "Logo do time", "image/*")}<div class="helper">O elenco mais recente e as formações históricas serão derivados de cada participação.</div>`;
    if (section === "tournaments") return `${textField("name", "Nome do campeonato", item.name, "Ex.: PGL Major Abadia", true)}<div class="field-row">${textField("subtitle", "Ano", item.subtitle, "2026", true)}${selectField("status", item.status)}</div><label>Modelo de formato<select name="formatType" id="formatType">${formatOptions(item.formatType)}</select></label><label>Descrição do formato<input name="format" id="formatDescription" value="${escapeHtml(item.format || "")}" placeholder="Será preenchido pelo modelo escolhido" /></label><div class="format-preview" id="formatPreview"></div>${fileField("logo", "Logo do campeonato", "image/*")}<div class="helper">Depois de criar a edição, você adicionará os times e os cinco jogadores de cada escalação. O formato define como classificação e chave serão exibidas.</div>`;
    if (section === "matches") return `<label>Campeonato<select name="tournamentId" id="matchTournament" required><option value="">Selecione primeiro o campeonato</option>${state.tournaments.map((event) => `<option value="${escapeHtml(event.id)}" ${item.tournamentId === event.id ? "selected" : ""}>${escapeHtml(event.name)} ${escapeHtml(event.subtitle)}</option>`).join("")}</select></label><div class="field-row"><label>Time A<select name="teamA" id="matchTeamA" required></select></label><label>Time B<select name="teamB" id="matchTeamB" required></select></label></div><div class="field-row">${textField("name", "Fase", item.name, "Ex.: Semifinal", true)}${textField("subtitle", "Data e hora", item.subtitle, "2026-08-15 20:30")}</div><div class="field-row">${textField("score", "Placar / mapas", item.score, "Somente após confirmação")}${selectField("status", item.status)}</div>${fileField("demo", "Demo da partida", ".dem")}<div class="helper" id="matchHelper">Escolha uma edição: os times serão limitados exclusivamente às escalações daquele campeonato.</div>`;
    return `${textField("name", "Título", item.name, "Título da notícia", true)}<label>Texto / resumo<textarea name="subtitle" placeholder="Escreva a notícia...">${escapeHtml(item.subtitle)}</textarea></label><div class="field-row">${textField("author", "Autor", item.author, "HLTPC")}${selectField("status", item.status)}</div>${fileField("image", "Imagem de destaque", "image/*")}`;
  }

  function textField(name, label, value = "", placeholder = "", required = false) { return `<label>${label}<input name="${name}" value="${escapeHtml(value)}" placeholder="${placeholder}" ${required ? "required" : ""} /></label>`; }
  function selectField(name, value = "draft") { return `<label>Status<select name="${name}"><option value="draft" ${value === "draft" ? "selected" : ""}>Rascunho</option><option value="published" ${value === "published" ? "selected" : ""}>Publicado</option></select></label>`; }
  function fileField(name, label, accept) { return `<label>${label}<input class="file-field" name="${name}" type="file" accept="${accept}" /></label>`; }

  function formatOptions(value = "custom") {
    const options = [["round_robin", "Pontos corridos"], ["single_elimination", "Eliminação simples"], ["double_elimination", "Eliminação dupla"], ["groups_playoffs", "Grupos + playoffs"], ["custom", "Personalizado"]];
    return options.map(([key, label]) => `<option value="${key}" ${value === key ? "selected" : ""}>${label}</option>`).join("");
  }

  function formatDefinition(type) {
    return {
      round_robin: { label: "Pontos corridos", description: "Todos jogam contra todos. Vitória vale 3 pontos; empate, 1.", steps: ["Liga", "Classificação", "Campeão"] },
      single_elimination: { label: "Eliminação simples", description: "Quem perde é eliminado. Ideal para uma chave rápida.", steps: ["Semifinais", "Final", "Campeão"] },
      double_elimination: { label: "Eliminação dupla", description: "Uma derrota envia o time à chave inferior; a segunda elimina.", steps: ["Chave superior", "Chave inferior", "Grande final"] },
      groups_playoffs: { label: "Grupos + playoffs", description: "Fase de grupos classificatória seguida por mata-mata.", steps: ["Grupos", "Semifinais", "Final"] },
      custom: { label: "Personalizado", description: "Descreva manualmente as regras do campeonato.", steps: ["Formato livre"] }
    }[type];
  }

  function renderFormatPreview() {
    const definition = formatDefinition(document.querySelector("#formatType")?.value || "custom");
    const preview = document.querySelector("#formatPreview");
    if (!preview) return;
    preview.innerHTML = `<span>PRÉVIA DO FORMATO</span><h4>${definition.label}</h4><p>${definition.description}</p><div>${definition.steps.map((step, index) => `<b>${step}${index < definition.steps.length - 1 ? " →" : ""}</b>`).join("")}</div>`;
  }

  function populateMatchTeams(selectedA = "", selectedB = "") {
    const tournament = state.tournaments.find((event) => event.id === document.querySelector("#matchTournament")?.value);
    const teamA = document.querySelector("#matchTeamA");
    const teamB = document.querySelector("#matchTeamB");
    if (!teamA || !teamB) return;
    const teams = tournament?.teams || [];
    const options = teams.length ? `<option value="">Selecione</option>${teams.map((team) => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`).join("")}` : `<option value="">Nenhum time cadastrado nesta edição</option>`;
    teamA.innerHTML = options; teamB.innerHTML = options;
    teamA.value = selectedA; teamB.value = selectedB;
    teamA.disabled = !teams.length; teamB.disabled = !teams.length;
    const helper = document.querySelector("#matchHelper");
    if (helper) helper.textContent = teams.length ? `${teams.length} times disponíveis em ${tournament.name} ${tournament.subtitle}. Times de outras edições não aparecem.` : "Cadastre as escalações desta edição antes de criar partidas.";
  }

  function bindEditorDynamics() {
    if (section === "tournaments") {
      const formatType = document.querySelector("#formatType");
      formatType?.addEventListener("change", () => {
        const definition = formatDefinition(formatType.value);
        const description = document.querySelector("#formatDescription");
        if (description && formatType.value !== "custom") description.value = definition.description;
        renderFormatPreview();
      });
      renderFormatPreview();
    }
    if (section === "matches") {
      const current = editingId ? state.matches.find((item) => item.id === editingId) : null;
      document.querySelector("#matchTournament")?.addEventListener("change", () => populateMatchTeams());
      populateMatchTeams(current?.teamA || "", current?.teamB || "");
    }
  }

  function saveEditor() {
    const values = Object.fromEntries(new FormData(form).entries());
    const list = state[section];
    if (section === "matches" && values.teamA === values.teamB) { showToast("Escolha dois times diferentes"); return; }
    const fallbackName = section === "matches" ? `${values.teamA} x ${values.teamB}` : "Novo registro";
    const record = { ...values, name: values.name || fallbackName, id: editingId || `${section}-${Date.now()}`, updated: "Alterado nesta demonstração" };
    const index = list.findIndex((item) => item.id === editingId);
    if (index >= 0) list[index] = { ...list[index], ...record }; else list.unshift(record);
    dialog.close();
    showToast(`${record.name} foi salvo na demonstração`);
    listView();
  }

  function deleteEditor() {
    if (!editingId) return;
    const index = state[section].findIndex((item) => item.id === editingId);
    const [removed] = state[section].splice(index, 1);
    dialog.close();
    showToast(`${removed.name} foi removido da demonstração`);
    listView();
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.querySelector("span").textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function bindActions() {
    document.querySelector("[data-add]")?.addEventListener("click", () => openEditor());
    document.querySelectorAll("[data-edit]").forEach((row) => row.addEventListener("click", () => openEditor(row.dataset.edit)));
    document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => go(button.dataset.go)));
  }

  function go(next) {
    section = next;
    search = "";
    document.querySelector("#breadcrumb").textContent = labels[section];
    document.querySelectorAll("#adminNav button").forEach((button) => button.classList.toggle("active", button.dataset.section === section));
    document.querySelector(".sidebar").classList.remove("open");
    if (section === "overview") overview(); else if (section === "files") filesView(); else if (section === "users") usersView(); else listView();
  }

  document.querySelectorAll("#adminNav button").forEach((button) => button.addEventListener("click", () => go(button.dataset.section)));
  document.querySelector("#mobileMenu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
  document.querySelector("#cancelButton").addEventListener("click", () => dialog.close());
  deleteButton.addEventListener("click", deleteEditor);
  form.addEventListener("submit", (event) => { event.preventDefault(); if (form.reportValidity()) saveEditor(); });

  overview();
})();
