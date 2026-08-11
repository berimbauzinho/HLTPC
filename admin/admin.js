(() => {
  "use strict";

  const source = window.HLTPC_DATA;
  const state = {
    players: source.players.map((name, index) => ({ id: `player-${index}`, name, alias: "", status: "published", photo: "", teams: [...new Set(source.tournaments.flatMap((event) => event.entries.filter((entry) => entry.players.includes(name)).map((entry) => entry.team)))], updated: "Dados históricos" })),
    teams: [...new Set(source.tournaments.flatMap((event) => event.entries.map((entry) => entry.team)))].map((name, index) => ({ id: `team-${index}`, name, acronym: initials(name), status: "published", logo: "", updated: "Derivado das edições" })),
    tournaments: source.tournaments.map((event) => ({ id: event.id, name: event.name, subtitle: String(event.year), status: "published", logo: "", format: event.format, formatType: event.entries.length === 2 ? "two_team_md3" : event.entries.length === 3 ? "three_team_series" : "four_team_groups", teams: event.entries.map((entry) => entry.team), updated: event.status === "ongoing" ? "Em andamento" : `Campeão: ${event.champion}` })),
    matches: [],
    news: source.news.map((item) => ({ id: item.id, name: item.title, subtitle: item.summary, author: item.author, date: item.date, tournamentId: item.tournamentId, status: "published", updated: item.date }))
  };

  const labels = { overview: "Visão geral", players: "Jogadores", teams: "Times", tournaments: "Campeonatos", matches: "Partidas", news: "Notícias", users: "Usuários e acessos" };
  const singular = { players: "jogador", teams: "time", tournaments: "campeonato", matches: "partida", news: "notícia" };
  let section = "overview";
  let editingId = null;
  let returnSection = null;
  const expandedTournaments = new Set();
  let search = "";
  let demoParserPromise = null;
  const DEMO_PARSER_MODULE = new URL("./vendor/demoparser2.js", window.location.href).href;
  const DEMO_PARSER_WASM_PARTS = [1, 2, 3].map((part) => new URL(`./vendor/demoparser2_bg.wasm.part${part}`, window.location.href).href);

  const content = document.querySelector("#content");
  const dialog = document.querySelector("#editorDialog");
  const form = document.querySelector("#editorForm");
  const fields = document.querySelector("#formFields");
  const deleteButton = document.querySelector("#deleteButton");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

  function initials(value) {
    return value.replace(/gaming|e-sports/ig, "").trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  }

  async function contentRequest(options = {}) {
    const response = await fetch("/api/admin/content", { credentials: "same-origin", ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível sincronizar o conteúdo.");
    return result;
  }

  async function loadPersistedContent() {
    try {
      const saved = await contentRequest();
      ["players", "teams", "tournaments", "matches", "news"].forEach((key) => { if (Array.isArray(saved[key])) state[key] = saved[key]; });
      const structureChanged = normalizeTournamentStructures();
      const leetifyImported = await syncPendingLeetifyMatches();
      if (structureChanged || leetifyImported) await persistContent();
      go(section);
      showToast(leetifyImported ? `${leetifyImported} partida sincronizada com o Leetify` : "Conteúdo compartilhado carregado");
    } catch (reason) {
      showToast(reason.message);
    }
  }

  async function persistContent() {
    return contentRequest({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ players: state.players, teams: state.teams, tournaments: state.tournaments, matches: state.matches, news: state.news }) });
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
          ${[["✓","Cadastrar jogadores e aliases"],["✓","Criar times e selecionar logos"],["✓","Montar campeonatos, brackets e partidas"],["✓","Abrir cada confronto para lançar resultado"],["✓","Publicar notícias compartilhadas"],["⇧","Enviar demos dentro da própria partida"]].map((item) => `<div class="activity"><span>${item[0]}</span><div><b>${item[1]}</b><small>Disponível no painel conectado</small></div></div>`).join("")}
        </section>
        <section class="panel"><div class="panel-title">Acesso rápido</div>
          ${[["players","♟"],["teams","◆"],["tournaments","★"],["news","▤"]].map(([key, icon]) => `<button class="quick" data-go="${key}"><i>${icon}</i><span><b>${labels[key]}</b><small>Abrir gerenciamento</small></span><em>›</em></button>`).join("")}
        </section>
      </div>`;
    bindActions();
  }

  function listView() {
    const items = state[section].filter((item) => (item.name || "").toLowerCase().includes(search.toLowerCase()));
    const descriptions = {
      players: "Cadastre nicks, aliases e fotos sem duplicar o histórico.",
      teams: "Gerencie organizações e logos; elencos continuam ligados às edições.",
      tournaments: "Escolha o formato, selecione os participantes e confira toda a estrutura antes de gerar as partidas.",
      matches: "Abra uma partida pré-gerada pelo formato para definir horário, publicar e anexar a demo.",
      news: "Prepare notícias compartilhadas e escolha quando publicar."
    };
    content.innerHTML = `${pageTitle(labels[section], descriptions[section], section !== "matches")}
      <div class="stats">
        <article class="stat"><span>◉</span><div><small>Total</small><b>${state[section].length}</b></div></article>
        <article class="stat"><span>✓</span><div><small>Publicados</small><b>${state[section].filter((item) => item.status === "published").length}</b></div></article>
        <article class="stat"><span>◷</span><div><small>Rascunhos</small><b>${state[section].filter((item) => item.status === "draft").length}</b></div></article>
        <article class="stat"><span>↻</span><div><small>Modo</small><b style="font-size:15px">Conectado</b></div></article>
      </div>
      <div class="toolbar"><label class="search"><span>⌕</span><input id="adminSearch" value="${escapeHtml(search)}" placeholder="Buscar em ${labels[section].toLowerCase()}..." /></label><select><option>Todos os status</option><option>Publicados</option><option>Rascunhos</option></select><button>⇅ Ordenar</button><small>${items.length} resultados</small></div>
      ${items.length ? `<div class="data-table"><div class="table-head"><span>NOME</span><span>DETALHE</span><span>ORIGEM / ATUALIZAÇÃO</span><span>STATUS</span><span></span></div>${items.map(tableRow).join("")}</div>` : `<div class="empty"><span>＋</span><h3>Nenhum registro</h3><p>Adicione o primeiro ${singular[section]} para testar o fluxo.</p></div>`}`;
    bindActions();
    document.querySelector("#adminSearch")?.addEventListener("input", (event) => { search = event.target.value; listView(); document.querySelector("#adminSearch")?.focus(); });
  }

  function fixtureTeam(match, side) {
    return match[`team${side}`] || match[`slot${side}`] || "A decidir";
  }

  function adminFixtureCard(match) {
    const teamA = fixtureTeam(match, "A");
    const teamB = fixtureTeam(match, "B");
    const decided = Boolean(match.teamA && match.teamB);
    const completed = Boolean(match.score || match.status === "finished");
    const sources = [match.demoInfo ? `<i class="source-chip ${match.statistics?.length ? "ok" : "partial"}">DEMO</i>` : "", match.leetifyUrl ? `<i class="source-chip ok">LEETIFY</i>` : "", match.scoreboardImage ? `<i class="source-chip ok">PRINT</i>` : ""].join("");
    return `<button type="button" class="admin-fixture ${completed ? "completed" : ""}" data-edit-match="${escapeHtml(match.id)}">
      <span><b>${escapeHtml(match.name)}</b><em>MD${match.bestOf || 1}</em></span>
      <div><strong>${escapeHtml(teamA)}</strong><i>${escapeHtml(match.score || "—")}</i><strong>${escapeHtml(teamB)}</strong></div>
      <small>${completed ? "Resultado lançado" : decided ? escapeHtml(match.subtitle || "Data a definir") : "Aguardando definição"}<span class="fixture-sources">${sources}</span><u>Editar partida →</u></small>
    </button>`;
  }

  function adminBracket(tournament, matches) {
    const groups = matches.filter((match) => match.round === "group");
    const semifinals = matches.filter((match) => match.round === "semifinal");
    const finals = matches.filter((match) => match.round === "final");
    const columns = [];
    if (groups.length) columns.push(`<section><header><span>1</span><div><b>Fase de grupos</b><small>${groups.length} confrontos</small></div></header>${groups.map(adminFixtureCard).join("")}</section>`);
    if (semifinals.length) columns.push(`<section><header><span>${columns.length + 1}</span><div><b>Semifinal${semifinals.length > 1 ? "is" : ""}</b><small>${semifinals.length} confronto${semifinals.length > 1 ? "s" : ""}</small></div></header>${semifinals.map(adminFixtureCard).join("")}</section>`);
    if (finals.length) columns.push(`<section><header><span>${columns.length + 1}</span><div><b>Final</b><small>Decisão do título</small></div></header>${finals.map(adminFixtureCard).join("")}</section>`);
    return `<div class="admin-bracket ${columns.length === 1 ? "single" : ""}">${columns.join(`<i class="bracket-arrow">→</i>`)}</div>`;
  }

  function tournamentsView() {
    const tournaments = [...state.tournaments].sort((a, b) => Number(b.subtitle || 0) - Number(a.subtitle || 0));
    content.innerHTML = `${pageTitle("Campeonatos", "Crie o evento, publique a estrutura e atualize cada partida no mesmo lugar.")}
      <div class="championship-flow"><b>1. Configure</b><span>→</span><b>2. Publique o bracket</b><span>→</span><b>3. Abra a partida</b><span>→</span><b>4. Envie demo e resultado</b></div>
      <div class="championship-workspace">${tournaments.map((tournament) => {
        const definition = formatDefinition(tournament.formatType);
        const matches = state.matches.filter((match) => match.tournamentId === tournament.id).sort((a, b) => (a.order || 999) - (b.order || 999));
        const completed = matches.filter((match) => match.score || match.status === "finished").length;
        const expanded = expandedTournaments.has(tournament.id);
        return `<article class="admin-championship ${expanded ? "expanded" : ""}" data-championship="${escapeHtml(tournament.id)}">
          <header><div class="championship-identity">${tournament.logo ? `<img src="${escapeHtml(tournament.logo)}" alt="" />` : `<span>${initials(tournament.name)}</span>`}<div><small>${escapeHtml(tournament.subtitle || "ANO A DEFINIR")}</small><h2>${escapeHtml(tournament.name)}</h2><p>${definition ? escapeHtml(definition.label) : "Formato a definir"} · ${(tournament.teams || []).length} times</p></div></div><div class="championship-actions"><span class="championship-count"><b>${completed}/${matches.length}</b> concluídas</span><span class="badge ${tournament.status === "draft" ? "draft" : ""}">${tournament.status === "draft" ? "Rascunho" : "Publicado"}</span><a class="ghost" href="../#campeonato/${encodeURIComponent(tournament.id)}/overview" target="_blank">Ver público ↗</a><button class="ghost" data-edit-event="${escapeHtml(tournament.id)}">Editar</button><button class="primary championship-toggle" data-toggle-event="${escapeHtml(tournament.id)}" aria-expanded="${expanded}">${expanded ? "Recolher" : "Expandir estrutura"} <i>⌄</i></button></div></header>
          <div class="championship-details" ${expanded ? "" : "hidden"}><div class="championship-progress"><span><b>${completed}/${matches.length}</b> partidas concluídas</span><span>${matches.length ? "Clique em qualquer partida para lançar os dados" : "Salve um formato válido para gerar o bracket"}</span></div>
          ${matches.length ? adminBracket(tournament, matches) : `<div class="empty compact"><h3>Estrutura ainda não gerada</h3><p>Edite o campeonato e selecione o formato e os participantes.</p></div>`}</div>
        </article>`;
      }).join("")}</div>`;
    bindActions();
    document.querySelectorAll("[data-edit-event]").forEach((button) => button.addEventListener("click", () => openEditor(button.dataset.editEvent)));
    document.querySelectorAll("[data-toggle-event]").forEach((button) => button.addEventListener("click", () => {
      const card = button.closest("[data-championship]");
      const details = card.querySelector(".championship-details");
      const expanded = !card.classList.contains("expanded");
      card.classList.toggle("expanded", expanded);
      details.hidden = !expanded;
      button.setAttribute("aria-expanded", String(expanded));
      button.innerHTML = `${expanded ? "Recolher" : "Expandir estrutura"} <i>⌄</i>`;
      if (expanded) expandedTournaments.add(button.dataset.toggleEvent); else expandedTournaments.delete(button.dataset.toggleEvent);
    }));
    document.querySelectorAll("[data-edit-match]").forEach((button) => button.addEventListener("click", () => {
      returnSection = "tournaments";
      section = "matches";
      openEditor(button.dataset.editMatch);
    }));
  }

  function tableRow(item) {
    const image = item.photo || item.logo;
    return `<div class="table-row" data-edit="${escapeHtml(item.id)}">
      <div class="identity"><span class="avatar">${image ? `<img src="${escapeHtml(image)}" alt="" />` : initials(item.name)}</span><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.alias || item.acronym || singular[section])}</small></div></div>
      <span>${escapeHtml(item.subtitle || item.acronym || "—")}</span><span>${escapeHtml(item.updated || "Agora")}</span>
      <span class="badge ${item.status === "draft" ? "draft" : ""}">${item.status === "draft" ? "Rascunho" : "Publicado"}</span><button class="more">•••</button>
    </div>`;
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

  function openEditor(id = null) {
    editingId = id;
    const item = id ? state[section].find((record) => record.id === id) : null;
    document.querySelector("#dialogEyebrow").textContent = item ? "EDITAR REGISTRO" : "NOVO REGISTRO";
    document.querySelector("#dialogTitle").textContent = item ? item.name : `Adicionar ${singular[section]}`;
    deleteButton.style.visibility = item && !(item.slotA || item.slotB) ? "visible" : "hidden";
    fields.innerHTML = formFields(item || {});
    dialog.showModal();
    bindEditorDynamics();
  }

  function formFields(item) {
    if (section === "players") return `<div class="editor-tabs"><button type="button" class="active" data-editor-tab="profile">Dados do jogador</button><button type="button" data-editor-tab="teams">Equipes</button></div><div data-editor-panel="profile">${textField("name", "Nick principal", item.name, "Ex.: lanches", true)}<div class="field-row">${textField("alias", "Nome / alias", item.alias, "Ex.: Mathieu Herbaut")}${selectField("status", item.status)}</div>${textField("steamId", "SteamID64", item.steamId, "Ex.: 76561198300371519")}${fileField("photo", "Foto do jogador", "image/*")}<div class="helper">O SteamID64 conecta automaticamente o nick usado na demo ou no Leetify ao perfil correto.</div></div><div data-editor-panel="teams" hidden><span class="field-title">Equipes defendidas</span><div class="team-checklist">${state.teams.map((team) => `<label><input type="checkbox" name="teams" value="${escapeHtml(team.name)}" ${(item.teams || []).includes(team.name) ? "checked" : ""} /><span><b>${escapeHtml(team.name)}</b><small>${escapeHtml(team.acronym)}</small></span></label>`).join("")}</div><div class="helper">As equipes encontradas nas escalações históricas já aparecem marcadas. Use esta área para complementar ou corrigir o perfil.</div></div>`;
    if (section === "teams") return `${textField("name", "Nome oficial do time", item.name, "Ex.: Deftones", true)}<div class="field-row">${textField("acronym", "Sigla", item.acronym, "Ex.: DFT")}${selectField("status", item.status)}</div>${fileField("logo", "Logo do time", "image/*")}<div class="helper">O elenco mais recente e as formações históricas serão derivados de cada participação.</div>`;
    if (section === "tournaments") {
      const selectedFormat = item.formatType || "three_team_series";
      const selectedTeams = item.teams || [];
      return `${textField("name", "Nome do campeonato", item.name, "Ex.: PGL Major Abadia", true)}<div class="field-row">${textField("subtitle", "Ano", item.subtitle, "2026", true)}${selectField("status", item.status)}</div><fieldset class="format-picker"><legend>Formato do campeonato</legend><div class="format-card-grid">${formatCards(selectedFormat)}</div></fieldset><input type="hidden" name="format" id="formatDescription" value="${escapeHtml(item.format || "")}" /><fieldset class="tournament-team-picker"><legend>Times participantes</legend><div class="participant-counter" id="participantCounter"></div><div class="team-checklist tournament-teams">${state.teams.map((team) => `<label><input type="checkbox" name="teams" value="${escapeHtml(team.name)}" ${selectedTeams.includes(team.name) ? "checked" : ""} /><span><b>${escapeHtml(team.name)}</b><small>${escapeHtml(team.acronym)}</small></span></label>`).join("")}</div></fieldset><div class="format-preview" id="formatPreview"></div>${fileField("logo", "Logo do campeonato", "image/*")}<div class="helper">Ao salvar, as partidas são geradas pelo formato escolhido. Partidas que já tenham placar ou demo nunca serão apagadas automaticamente.</div>`;
    }
    if (section === "matches") {
      const generated = Boolean(item.slotA || item.slotB);
      const lockedGroupMatch = item.round === "group" && item.teamA && item.teamB;
      const tournament = state.tournaments.find((event) => event.id === item.tournamentId);
      const tournamentField = generated ? `<input type="hidden" name="tournamentId" value="${escapeHtml(item.tournamentId)}" /><div class="fixture-source"><b>${escapeHtml(tournament?.name || "Campeonato")}</b><span>${escapeHtml(item.slotA || "Time A")} × ${escapeHtml(item.slotB || "Time B")}</span></div>` : `<label>Campeonato<select name="tournamentId" id="matchTournament" required><option value="">Selecione primeiro o campeonato</option>${state.tournaments.map((event) => `<option value="${escapeHtml(event.id)}" ${item.tournamentId === event.id ? "selected" : ""}>${escapeHtml(event.name)} ${escapeHtml(event.subtitle)}</option>`).join("")}</select></label>`;
      const teamsField = lockedGroupMatch ? `<input type="hidden" name="teamA" value="${escapeHtml(item.teamA)}" /><input type="hidden" name="teamB" value="${escapeHtml(item.teamB)}" /><div class="locked-match-teams"><b>${escapeHtml(item.teamA)}</b><span>×</span><b>${escapeHtml(item.teamB)}</b></div>` : `<div class="field-row"><label>Time A<select name="teamA" id="matchTeamA" required></select></label><label>Time B<select name="teamB" id="matchTeamB" required></select></label></div>`;
      const demoHasStats = Boolean(item.demoInfo && item.statisticsSource !== "leetify" && (item.statistics || []).length);
      const leetifyHasStats = Boolean(item.leetifyInfo && item.statisticsSource === "leetify" && (item.statistics || []).length);
      const sourceSummary = item.demoInfo || item.leetifyUrl || item.scoreboardImage ? `<div class="match-source-summary"><span class="${demoHasStats ? "verified" : item.demoInfo ? "partial" : "muted"}"><b>${demoHasStats ? "1 · Demo confirmada" : item.demoInfo ? "1 · Demo anexada" : "1 · Sem demo"}</b><small>${item.demoInfo ? `${escapeHtml(item.demoInfo.fileName)}${demoHasStats ? ` · ${(item.statistics || []).length} jogadores` : " · extração automática pendente"}` : "Fonte primária"}</small></span><span class="${leetifyHasStats ? "verified" : item.leetifyUrl ? "partial" : "muted"}"><b>2 · Leetify</b><small>${leetifyHasStats ? `${(item.statistics || []).length} jogadores · ${escapeHtml(item.leetifyInfo.mapName || "mapa identificado")}` : item.leetifyUrl ? "Link salvo · aguarda importação" : "Fonte secundária opcional"}</small></span><span class="${item.scoreboardImage ? "verified" : "muted"}"><b>3 · Print do placar</b><small>${item.scoreboardImage ? "Imagem salva como comprovação" : "Evidência visual opcional"}</small></span></div>` : "";
      return `${tournamentField}${teamsField}${textField("name", "Fase", item.name, "Ex.: Semifinal", true)}<div class="field-row">${textField("score", "Placar / mapas", item.score, "Somente após confirmação")}${selectField("status", item.status)}</div><fieldset class="match-evidence"><legend>Fontes dos dados</legend><div class="evidence-order"><b>1</b><span><strong>Demo · fonte principal</strong><small>O painel tenta extrair data e estatísticas automaticamente.</small></span></div>${fileField("demo", "Selecionar arquivo .dem", ".dem")}${urlField("demoUrl", "Ou link da demo no Google Drive", item.demoUrl, "https://drive.google.com/file/d/...")}${item.demoInfo ? `<div class="demo-result ${demoHasStats ? "" : "partial"}"><b>${demoHasStats ? "✓ Demo processada" : item.demoUrl ? "✓ Demo vinculada pelo Drive" : "⚠ Demo anexada, sem estatísticas automáticas"}</b><span>${escapeHtml(item.demoInfo.fileName)} · ${escapeHtml(item.demoInfo.mapName || "mapa não identificado")} · ${item.demoInfo.rounds || 0} rounds</span><small>${escapeHtml(item.demoInfo.playedAtLabel || item.subtitle || "Data não identificada")} · ${(item.statistics || []).length} jogadores extraídos</small>${item.demoInfo.warnings?.length ? `<small>${escapeHtml(item.demoInfo.warnings.join(" · "))}</small>` : ""}</div>` : ""}<div class="evidence-order"><b>2</b><span><strong>Leetify · fonte secundária</strong><small>Use para conferir placar e números quando a demo estiver incompleta.</small></span></div>${urlField("leetifyUrl", "Link da partida no Leetify", item.leetifyUrl, "https://leetify.com/app/match-details/...")}<div class="evidence-order"><b>3</b><span><strong>Print do placar · comprovação visual</strong><small>Envie a tela final quando a demo ou o Leetify não trouxerem tudo.</small></span></div>${fileField("scoreboardImage", item.scoreboardImage ? "Substituir print do placar" : "Enviar print do placar", "image/*")}${item.scoreboardImage ? `<div class="scoreboard-preview"><img src="${escapeHtml(item.scoreboardImage)}" alt="Print do placar salvo" /><span><b>Print salvo</b><small>Um novo arquivo substituirá esta imagem.</small><label><input type="checkbox" name="removeScoreboardImage" value="true" /> Remover print atual</label></span></div>` : ""}</fieldset>${sourceSummary}<div class="helper" id="matchHelper">${generated ? "A data e a hora serão extraídas automaticamente do nome da demo. As três fontes ficam ligadas exclusivamente a este confronto." : "Escolha uma edição: os times serão limitados exclusivamente às escalações daquele campeonato."}</div>`;
    }
    return `${textField("name", "Título", item.name, "Título da notícia", true)}<label>Texto / resumo<textarea name="subtitle" placeholder="Escreva a notícia...">${escapeHtml(item.subtitle)}</textarea></label><div class="field-row">${textField("author", "Autor", item.author, "HLTPC")}${textField("date", "Data", item.date, "2026-08-10", true)}</div>${selectField("status", item.status)}${fileField("image", "Imagem de destaque", "image/*")}`;
  }

  function textField(name, label, value = "", placeholder = "", required = false) { return `<label>${label}<input name="${name}" value="${escapeHtml(value)}" placeholder="${placeholder}" ${required ? "required" : ""} /></label>`; }
  function urlField(name, label, value = "", placeholder = "") { return `<label>${label}<input name="${name}" type="url" inputmode="url" value="${escapeHtml(value)}" placeholder="${placeholder}" /></label>`; }
  function selectField(name, value = "draft") { return `<label>Status<select name="${name}"><option value="draft" ${value === "draft" ? "selected" : ""}>Rascunho</option><option value="published" ${value === "published" ? "selected" : ""}>Publicado</option></select></label>`; }
  function fileField(name, label, accept) { return `<label>${label}<input class="file-field" name="${name}" type="file" accept="${accept}" /></label>`; }

  function normalizedLeetifyUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !/(^|\.)leetify\.com$/i.test(url.hostname)) throw new Error();
      return url.href;
    } catch (_) {
      throw new Error("Use um link HTTPS válido do Leetify.");
    }
  }

  function formatCards(value = "three_team_series") {
    return [
      ["two_team_md3", "2 times", "Final direta", "1 partida · MD3"],
      ["three_team_series", "3 times", "Grupos + semifinal", "8 partidas"],
      ["four_team_groups", "4 times", "Grupos + chave", "9 partidas"]
    ].map(([key, title, subtitle, detail]) => `<label class="format-card"><input type="radio" name="formatType" value="${key}" ${value === key ? "checked" : ""} /><span><i>${title.split(" ")[0]}</i><b>${title}</b><small>${subtitle}</small><em>${detail}</em></span></label>`).join("");
  }

  function formatDefinition(type) {
    return {
      two_team_md3: { teamCount: 2, matchCount: 1, label: "Final direta · 2 times", description: "Os dois times disputam uma única série MD3. O vencedor da série é o campeão.", steps: ["Final MD3", "Campeão"] },
      three_team_series: { teamCount: 3, matchCount: 8, label: "3 times · grupos e playoffs", description: "Cada time enfrenta os outros duas vezes em MD1. O 2º e o 3º jogam uma semifinal MD3; o 1º colocado avança direto para a final MD3.", steps: ["6 jogos MD1", "Semifinal MD3", "Final MD3"] },
      four_team_groups: { teamCount: 4, matchCount: 9, label: "4 times · grupos e chave", description: "Os quatro times jogam entre si uma vez em MD1. As semifinais MD3 são 1º × 4º e 2º × 3º; os vencedores disputam a final MD3.", steps: ["6 jogos MD1", "2 semifinais MD3", "Final MD3"] }
    }[type] || null;
  }

  function tournamentFixtures(tournament) {
    const teams = tournament.teams || [];
    const common = { tournamentId: tournament.id, subtitle: "Data a definir", score: "", status: tournament.status === "published" ? "published" : "draft", generatedByFormat: true, formatType: tournament.formatType };
    if (tournament.formatType === "two_team_md3" && teams.length === 2) {
      return [{ ...common, id: `${tournament.id}-final`, name: "Final · MD3", teamA: teams[0], teamB: teams[1], slotA: teams[0], slotB: teams[1], round: "final", bestOf: 3, order: 1, updated: "Final gerada pelo formato" }];
    }
    if (tournament.formatType === "three_team_series" && teams.length === 3) {
      const [a, b, c] = teams;
      const group = [[a, b], [a, c], [b, c], [b, a], [c, a], [c, b]];
      return [
        ...group.map(([teamA, teamB], index) => ({ ...common, id: `${tournament.id}-group-${index + 1}`, name: `Fase de grupos · Jogo ${index + 1}`, teamA, teamB, slotA: teamA, slotB: teamB, round: "group", bestOf: 1, order: index + 1, updated: "Jogo MD1 gerado pelo formato" })),
        { ...common, id: `${tournament.id}-semifinal`, name: "Semifinal · MD3", teamA: "", teamB: "", slotA: "2º colocado", slotB: "3º colocado", round: "semifinal", bestOf: 3, order: 7, updated: "Aguardando classificação da fase de grupos" },
        { ...common, id: `${tournament.id}-final`, name: "Final · MD3", teamA: "", teamB: "", slotA: "1º colocado", slotB: "Vencedor da semifinal", round: "final", bestOf: 3, order: 8, updated: "Aguardando classificação e semifinal" }
      ];
    }
    if (tournament.formatType === "four_team_groups" && teams.length === 4) {
      const group = [];
      for (let first = 0; first < teams.length; first += 1) for (let second = first + 1; second < teams.length; second += 1) group.push([teams[first], teams[second]]);
      return [
        ...group.map(([teamA, teamB], index) => ({ ...common, id: `${tournament.id}-group-${index + 1}`, name: `Fase de grupos · Jogo ${index + 1}`, teamA, teamB, slotA: teamA, slotB: teamB, round: "group", bestOf: 1, order: index + 1, updated: "Jogo MD1 gerado pelo formato" })),
        { ...common, id: `${tournament.id}-semifinal-1`, name: "Semifinal 1 · MD3", teamA: "", teamB: "", slotA: "1º colocado", slotB: "4º colocado", round: "semifinal", bestOf: 3, order: 7, updated: "Aguardando classificação da fase de grupos" },
        { ...common, id: `${tournament.id}-semifinal-2`, name: "Semifinal 2 · MD3", teamA: "", teamB: "", slotA: "2º colocado", slotB: "3º colocado", round: "semifinal", bestOf: 3, order: 8, updated: "Aguardando classificação da fase de grupos" },
        { ...common, id: `${tournament.id}-final`, name: "Final · MD3", teamA: "", teamB: "", slotA: "Vencedor da semifinal 1", slotB: "Vencedor da semifinal 2", round: "final", bestOf: 3, order: 9, updated: "Aguardando as semifinais" }
      ];
    }
    return [];
  }

  function ensureTournamentFixtures(tournament) {
    const expected = tournamentFixtures(tournament);
    const expectedIds = new Set(expected.map((fixture) => fixture.id));
    let changed = false;
    expected.forEach((fixture) => {
      const current = state.matches.find((match) => match.id === fixture.id);
      if (!current) { state.matches.push(fixture); changed = true; return; }
      const structure = { slotA: fixture.slotA, slotB: fixture.slotB, round: fixture.round, bestOf: fixture.bestOf, order: fixture.order, generatedByFormat: true, formatType: tournament.formatType };
      if ((!current.status || current.status === "draft") && fixture.status === "published") structure.status = "published";
      if (!current.demoInfo && !current.score && fixture.teamA && fixture.teamB) { structure.teamA = fixture.teamA; structure.teamB = fixture.teamB; }
      Object.entries(structure).forEach(([key, value]) => { if (current[key] !== value) { current[key] = value; changed = true; } });
    });
    state.matches = state.matches.filter((match) => {
      const stale = match.tournamentId === tournament.id && match.generatedByFormat && !expectedIds.has(match.id);
      if (!stale) return true;
      if (match.demoInfo || match.score || match.status === "published") { match.legacyFormat = true; return true; }
      changed = true;
      return false;
    });
    state.matches.sort((a, b) => (a.tournamentId || "").localeCompare(b.tournamentId || "") || (a.order || 999) - (b.order || 999));
    return changed;
  }

  function normalizeTournamentStructures() {
    let changed = false;
    state.tournaments.forEach((event) => {
      const count = (event.teams || []).length;
      const inferred = count === 2 ? "two_team_md3" : count === 3 ? "three_team_series" : count === 4 ? "four_team_groups" : null;
      if (!formatDefinition(event.formatType) && inferred) { event.formatType = inferred; changed = true; }
      const definition = formatDefinition(event.formatType);
      if (definition && event.format !== definition.description) { event.format = definition.description; event.updated = "Formato e partidas pré-gerados"; changed = true; }
      if (ensureTournamentFixtures(event)) changed = true;
    });
    return changed;
  }

  function renderFormatPreview() {
    const type = document.querySelector('input[name="formatType"]:checked')?.value || "three_team_series";
    const definition = formatDefinition(type);
    const preview = document.querySelector("#formatPreview");
    const selectedTeams = [...document.querySelectorAll('.tournament-teams input[name="teams"]:checked')].map((input) => input.value);
    const counter = document.querySelector("#participantCounter");
    if (!preview || !definition) return;
    const teamName = (index, fallback) => escapeHtml(selectedTeams[index] || fallback);
    let diagram = "";
    if (type === "two_team_md3") diagram = `<div class="format-diagram final-only"><div class="diagram-stage"><small>FINAL · MD3</small><b>${teamName(0, "Time 1")}</b><i>×</i><b>${teamName(1, "Time 2")}</b></div><span>🏆 Campeão</span></div>`;
    if (type === "three_team_series") diagram = `<div class="format-diagram"><div class="diagram-groups"><small>FASE DE GRUPOS · MD1</small><b>${teamName(0, "Time 1")} × ${teamName(1, "Time 2")} · 2 jogos</b><b>${teamName(0, "Time 1")} × ${teamName(2, "Time 3")} · 2 jogos</b><b>${teamName(1, "Time 2")} × ${teamName(2, "Time 3")} · 2 jogos</b></div><span>→</span><div class="diagram-playoffs"><small>SEMIFINAL · MD3</small><b>2º colocado × 3º colocado</b><small>FINAL · MD3</small><b>1º colocado × vencedor</b></div></div>`;
    if (type === "four_team_groups") diagram = `<div class="format-diagram"><div class="diagram-groups"><small>FASE DE GRUPOS · MD1</small><b>Todos contra todos · 6 jogos</b><em>${[0, 1, 2, 3].map((index) => teamName(index, `Time ${index + 1}`)).join(" · ")}</em></div><span>→</span><div class="diagram-playoffs"><small>SEMIFINAIS · MD3</small><b>1º × 4º</b><b>2º × 3º</b><small>FINAL · MD3</small><b>Vencedor 1 × Vencedor 2</b></div></div>`;
    preview.innerHTML = `<header><div><span>PRÉVIA DA ESTRUTURA</span><h4>${definition.label}</h4></div><strong>${definition.matchCount} partida${definition.matchCount === 1 ? "" : "s"}</strong></header><p>${definition.description}</p><div class="format-steps">${definition.steps.map((step, index) => `<b>${step}${index < definition.steps.length - 1 ? " →" : ""}</b>`).join("")}</div>${diagram}`;
    if (counter) {
      const valid = selectedTeams.length === definition.teamCount;
      counter.className = `participant-counter ${valid ? "valid" : "invalid"}`;
      counter.innerHTML = `<b>${selectedTeams.length}/${definition.teamCount} times selecionados</b><span>${valid ? "Estrutura pronta para gerar" : `Selecione exatamente ${definition.teamCount} times`}</span>`;
    }
    const description = document.querySelector("#formatDescription");
    if (description) description.value = definition.description;
  }

  function populateMatchTeams(selectedA = "", selectedB = "") {
    const tournamentId = document.querySelector("#matchTournament")?.value || document.querySelector('input[name="tournamentId"]')?.value;
    const tournament = state.tournaments.find((event) => event.id === tournamentId);
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
    document.querySelectorAll("[data-editor-tab]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-editor-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
      document.querySelectorAll("[data-editor-panel]").forEach((panel) => { panel.hidden = panel.dataset.editorPanel !== button.dataset.editorTab; });
    }));
    if (section === "tournaments") {
      document.querySelectorAll('input[name="formatType"], .tournament-teams input[name="teams"]').forEach((input) => input.addEventListener("change", renderFormatPreview));
      renderFormatPreview();
    }
    if (section === "matches") {
      const current = editingId ? state.matches.find((item) => item.id === editingId) : null;
      document.querySelector("#matchTournament")?.addEventListener("change", () => populateMatchTeams());
      populateMatchTeams(current?.teamA || "", current?.teamB || "");
    }
  }

  function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }

  async function loadDemoParser() {
    if (!demoParserPromise) {
      demoParserPromise = import(DEMO_PARSER_MODULE).then(async (parser) => {
        const responses = await Promise.all(DEMO_PARSER_WASM_PARTS.map((url) => fetch(url, { cache: "force-cache" })));
        const failed = responses.find((response) => !response.ok);
        if (failed) throw new Error(`arquivo local do parser respondeu ${failed.status}`);
        const parts = await Promise.all(responses.map((response) => response.arrayBuffer()));
        const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
        let offset = 0;
        parts.forEach((part) => { bytes.set(new Uint8Array(part), offset); offset += part.byteLength; });
        await parser.default(bytes);
        return parser;
      }).catch((reason) => {
        demoParserPromise = null;
        throw new Error(`Não foi possível carregar o leitor local da demo: ${reason.message || "erro desconhecido"}`);
      });
    }
    return demoParserPromise;
  }

  function demoRows(value) {
    return (Array.isArray(value) ? value : []).map((row) => row instanceof Map ? Object.fromEntries(row) : row);
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function booleanValue(value) {
    return value === true || value === 1 || String(value).toLowerCase() === "true";
  }

  function demoPlayedAt(file) {
    const named = file.name.match(/(20\d{2})[-_](\d{2})[-_](\d{2})[T_ -](\d{2})[-:](\d{2})[-:](\d{2})/);
    const date = named ? new Date(Number(named[1]), Number(named[2]) - 1, Number(named[3]), Number(named[4]), Number(named[5]), Number(named[6])) : new Date(file.lastModified || Date.now());
    const valid = !Number.isNaN(date.getTime());
    return {
      iso: valid ? date.toISOString() : "",
      label: valid ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date) : "Data não identificada"
    };
  }

  function normalizedNick(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");
  }

  function canonicalPlayerName(name, steamId = "") {
    const normalized = normalizedNick(name);
    const player = state.players.find((item) => String(item.steamId || "") === String(steamId || "") && steamId)
      || state.players.find((item) => [item.name, item.alias].some((value) => {
        const candidate = normalizedNick(value);
        return candidate && (candidate === normalized || (candidate.length >= 4 && normalized.startsWith(candidate)));
      }));
    return player?.name || String(name || "Desconhecido");
  }

  function leetifyMatchId(value) {
    const match = String(value || "").match(/match-details\/([0-9a-f-]{20,})/i);
    return match?.[1] || "";
  }

  function tournamentEntries(tournamentId) {
    return source.tournaments.find((event) => event.id === tournamentId)?.entries || [];
  }

  function leetifyTeamMapping(match, players) {
    const entries = tournamentEntries(match.tournamentId);
    const roster = (team) => new Set((entries.find((entry) => entry.team === team)?.players || []).map(normalizedNick));
    const rosterA = roster(match.teamA);
    const rosterB = roster(match.teamB);
    const numbers = [...new Set(players.map((player) => numberValue(player.initialTeamNumber)).filter(Boolean))];
    const scoreFor = (number, playerRoster) => players.filter((player) => numberValue(player.initialTeamNumber) === number).reduce((score, player) => score + (playerRoster.has(normalizedNick(canonicalPlayerName(player.name, player.steam64Id))) ? 1 : 0), 0);
    const numberA = numbers.sort((a, b) => scoreFor(b, rosterA) - scoreFor(a, rosterA))[0];
    const numberB = numbers.find((number) => number !== numberA);
    return { numberA, numberB };
  }

  async function importLeetifyMatch(url, match, quiet = false) {
    const matchId = leetifyMatchId(url);
    if (!matchId) throw new Error("O link do Leetify não contém um identificador de partida.");
    if (!quiet) showToast("Importando os dados do Leetify…");
    const response = await fetch(`https://api.cs-prod.leetify.com/api/games/${encodeURIComponent(matchId)}`);
    if (!response.ok) throw new Error(`O Leetify respondeu ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload.playerStats) || !payload.playerStats.length) throw new Error("O Leetify ainda não retornou estatísticas desta partida.");
    const roundsForTeam = (number) => {
      const player = payload.playerStats.find((item) => numberValue(item.initialTeamNumber) === number);
      return player ? numberValue(player.ctRoundsWon) + numberValue(player.tRoundsWon) : 0;
    };
    const { numberA, numberB } = leetifyTeamMapping(match, payload.playerStats);
    const scoreA = roundsForTeam(numberA);
    const scoreB = roundsForTeam(numberB);
    const rounds = scoreA + scoreB;
    const statistics = payload.playerStats.map((player) => {
      const kills = numberValue(player.totalKills);
      const deaths = numberValue(player.totalDeaths);
      const teamNumber = numberValue(player.initialTeamNumber);
      return {
        steamid: String(player.steam64Id || ""),
        name: canonicalPlayerName(player.name, player.steam64Id),
        demoName: String(player.name || ""),
        teamNumber,
        team: teamNumber === numberA ? match.teamA : teamNumber === numberB ? match.teamB : "",
        kills,
        deaths,
        assists: numberValue(player.totalAssists),
        damage: numberValue(player.totalDamage),
        adr: Number(numberValue(player.dpr || (rounds ? player.totalDamage / rounds : 0)).toFixed(1)),
        kd: deaths ? Number((kills / deaths).toFixed(2)) : kills,
        kast: Number((numberValue(player.kast) * 100).toFixed(1)),
        rating: Number(numberValue(player.hltvRating).toFixed(2)),
        leetifyRating: Number(numberValue(player.leetifyRating).toFixed(4)),
        headshots: Math.round(kills * numberValue(player.hsp)),
        hsPercent: Number((numberValue(player.hsp) * 100).toFixed(1))
      };
    }).sort((a, b) => b.rating - a.rating || b.kills - a.kills);
    return {
      statistics,
      statisticsSource: "leetify",
      score: match.score || (scoreA || scoreB ? `${scoreA} - ${scoreB}` : ""),
      winner: match.winner || (scoreA > scoreB ? match.teamA : scoreB > scoreA ? match.teamB : ""),
      leetifyInfo: { matchId, importedAt: new Date().toISOString(), finishedAt: payload.finishedAt || "", mapName: payload.mapName || "", rounds, scoreA, scoreB, status: payload.status || "ready" }
    };
  }

  async function syncPendingLeetifyMatches() {
    let imported = 0;
    for (const match of state.matches.filter((item) => item.leetifyUrl && !(item.statistics || []).length)) {
      try {
        Object.assign(match, await importLeetifyMatch(match.leetifyUrl, match, true));
        match.updated = "Estatísticas sincronizadas pelo Leetify";
        imported += 1;
      } catch (reason) {
        match.leetifySyncError = reason.message;
      }
    }
    return imported;
  }

  async function parseDemoFile(file) {
    if (!file.name.toLowerCase().endsWith(".dem")) throw new Error("Selecione um arquivo .dem do Counter-Strike 2.");
    if (file.size > 500 * 1024 * 1024) throw new Error("A demo ultrapassa 500 MB e pode esgotar a memória do navegador.");
    showToast("Lendo a demo no seu navegador…");
    const parser = await loadDemoParser();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const warnings = [];
    let header = {};
    try {
      const headerValue = parser.parseHeader(bytes);
      header = headerValue instanceof Map ? Object.fromEntries(headerValue) : (headerValue || {});
    } catch (reason) { warnings.push(`cabeçalho: ${reason.message || reason}`); }
    const parseEventSafely = (eventName, playerProps = [], otherProps = []) => {
      try { return demoRows(parser.parseEvent(bytes, eventName, playerProps, otherProps)); }
      catch (reason) {
        try { return demoRows(parser.parseEvent(bytes, eventName)); }
        catch (_) { warnings.push(`${eventName}: ${reason.message || reason}`); return []; }
      }
    };
    let allEvents = [];
    try {
      allEvents = demoRows(parser.parseEvents(bytes, ["begin_new_match", "round_end", "player_death", "player_hurt"], ["team_name"], ["total_rounds_played", "is_warmup_period"]));
    } catch (reason) {
      warnings.push(`leitura conjunta: ${reason.message || reason}`);
      allEvents = [
        ...parseEventSafely("begin_new_match"),
        ...parseEventSafely("round_end", [], ["total_rounds_played", "is_warmup_period"]),
        ...parseEventSafely("player_death", ["team_name"], ["total_rounds_played", "is_warmup_period"]),
        ...parseEventSafely("player_hurt", ["team_name"], ["total_rounds_played", "is_warmup_period"])
      ];
    }
    const starts = allEvents.filter((event) => event.event_name === "begin_new_match").sort((a, b) => numberValue(a.tick) - numberValue(b.tick));
    const matchStartTick = numberValue(starts.find((event) => !booleanValue(event.is_warmup_period))?.tick || starts[0]?.tick);
    const matchEvents = allEvents.filter((event) => numberValue(event.tick) >= matchStartTick && !booleanValue(event.is_warmup_period));
    const deaths = matchEvents.filter((event) => event.event_name === "player_death");
    const hurts = matchEvents.filter((event) => event.event_name === "player_hurt");
    const roundEnds = matchEvents.filter((event) => event.event_name === "round_end");
    const stats = new Map();
    const getPlayer = (steamid, name, team) => {
      const id = String(steamid || name || "desconhecido");
      if (!stats.has(id)) stats.set(id, { steamid: String(steamid || ""), name: canonicalPlayerName(name), demoName: String(name || ""), team: String(team || ""), kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0 });
      const player = stats.get(id);
      if (!player.team && team) player.team = String(team);
      return player;
    };
    deaths.forEach((event) => {
      const samePlayer = String(event.attacker_steamid || "") === String(event.user_steamid || "");
      const teamKill = event.attacker_team_name && event.user_team_name && event.attacker_team_name === event.user_team_name;
      const victim = getPlayer(event.user_steamid, event.user_name, event.user_team_name);
      if (!samePlayer && !teamKill) {
        victim.deaths += 1;
        const attacker = getPlayer(event.attacker_steamid, event.attacker_name, event.attacker_team_name);
        attacker.kills += 1;
        if (booleanValue(event.headshot)) attacker.headshots += 1;
        if (event.assister_name && String(event.assister_steamid || "") !== "0") getPlayer(event.assister_steamid, event.assister_name, event.assister_team_name).assists += 1;
      }
    });
    hurts.forEach((event) => {
      const teamKill = event.attacker_team_name && event.user_team_name && event.attacker_team_name === event.user_team_name;
      if (!teamKill && event.attacker_name && String(event.attacker_steamid || "") !== String(event.user_steamid || "")) getPlayer(event.attacker_steamid, event.attacker_name, event.attacker_team_name).damage += numberValue(event.dmg_health ?? event.health_damage);
    });
    const observedRounds = [...deaths, ...hurts].map((event) => numberValue(event.total_rounds_played)).filter((round) => round >= 0);
    const rounds = roundEnds.length || (observedRounds.length ? Math.max(...observedRounds) + 1 : 0);
    let statistics = [...stats.values()].filter((player) => player.steamid && player.steamid !== "0").map((player) => ({ ...player, adr: rounds ? Number((player.damage / rounds).toFixed(1)) : null, kd: player.deaths ? Number((player.kills / player.deaths).toFixed(2)) : player.kills })).sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    const lastRoundTick = roundEnds.length ? Math.max(...roundEnds.map((event) => numberValue(event.tick))) : 0;
    if (lastRoundTick) {
      try {
        const scoreboard = demoRows(parser.parseTicks(bytes, ["kills_total", "deaths_total", "assists_total", "headshot_kills_total", "damage_total", "team_name"], new Int32Array([lastRoundTick]))).filter((player) => player.steamid && String(player.steamid) !== "0");
        if (scoreboard.length) statistics = scoreboard.map((player) => ({ steamid: String(player.steamid), name: canonicalPlayerName(player.name), demoName: String(player.name || ""), team: String(player.team_name || ""), kills: numberValue(player.kills_total), deaths: numberValue(player.deaths_total), assists: numberValue(player.assists_total), headshots: numberValue(player.headshot_kills_total), damage: numberValue(player.damage_total), adr: rounds ? Number((numberValue(player.damage_total) / rounds).toFixed(1)) : null, kd: numberValue(player.deaths_total) ? Number((numberValue(player.kills_total) / numberValue(player.deaths_total)).toFixed(2)) : numberValue(player.kills_total) })).sort((a, b) => b.kills - a.kills || b.damage - a.damage);
      } catch (reason) { warnings.push(`placar final: ${reason.message || reason}`); }
    }
    const playedAt = demoPlayedAt(file);
    return {
      demoInfo: { fileName: file.name, fileSize: file.size, mapName: String(header.map_name || ""), serverName: String(header.server_name || ""), rounds, playedAt: playedAt.iso, playedAtLabel: playedAt.label, processedAt: new Date().toISOString(), parser: "demoparser2 0.42.0", rawFileStored: false, extractionStatus: statistics.length ? "complete" : "pending", warnings: [...new Set(warnings)] },
      statistics,
      statisticsSource: statistics.length ? "demo" : ""
    };
  }

  async function saveEditor() {
    const formData = new FormData(form);
    const values = {};
    for (const [key, value] of formData.entries()) if (!(typeof File !== "undefined" && value instanceof File)) values[key] = value;
    if (section === "players") values.teams = formData.getAll("teams");
    if (section === "tournaments") {
      values.teams = formData.getAll("teams");
      const definition = formatDefinition(values.formatType);
      if (!definition || values.teams.length !== definition.teamCount) { showToast(`Selecione exatamente ${definition?.teamCount || "os"} times exigidos pelo formato`); return; }
      values.format = definition.description;
    }
    if (section === "news" && !values.date) values.date = new Date().toISOString().slice(0, 10);
    if (section === "matches") {
      try { values.leetifyUrl = normalizedLeetifyUrl(values.leetifyUrl); }
      catch (reason) { showToast(reason.message); return; }
    }
    const imageField = section === "players" ? "photo" : ["teams", "tournaments"].includes(section) ? "logo" : section === "news" ? "image" : null;
    const imageFile = imageField ? formData.get(imageField) : null;
    if (imageFile?.size > 2 * 1024 * 1024) { showToast("Use uma imagem de até 2 MB"); return; }
    if (imageField && imageFile?.size) values[imageField] = await fileAsDataUrl(imageFile);
    const scoreboardFile = section === "matches" ? formData.get("scoreboardImage") : null;
    if (scoreboardFile?.size > 2 * 1024 * 1024) { showToast("Use um print do placar de até 2 MB"); return; }
    if (scoreboardFile?.size) values.scoreboardImage = await fileAsDataUrl(scoreboardFile);
    if (section === "matches" && values.removeScoreboardImage === "true") values.scoreboardImage = "";
    delete values.removeScoreboardImage;
    const list = state[section];
    if (section === "matches" && values.teamA === values.teamB) { showToast("Escolha dois times diferentes"); return; }
    const fallbackName = section === "matches" ? `${values.teamA} x ${values.teamB}` : "Novo registro";
    const record = { ...values, name: values.name || fallbackName, id: editingId || `${section}-${Date.now()}`, updated: "Atualizado pelo painel" };
    const demoFile = section === "matches" ? formData.get("demo") : null;
    let leetifyImported = false;
    if (demoFile?.size) {
      Object.assign(record, await parseDemoFile(demoFile));
      record.subtitle = record.demoInfo.playedAtLabel;
      record.updated = "Demo processada pelo painel";
    }
    if (section === "matches" && record.leetifyUrl) {
      Object.assign(record, await importLeetifyMatch(record.leetifyUrl, record));
      leetifyImported = true;
      record.updated = "Estatísticas conferidas pelo Leetify";
    }
    const index = list.findIndex((item) => item.id === editingId);
    if (index >= 0) list[index] = { ...list[index], ...record }; else list.unshift(record);
    if (section === "tournaments") ensureTournamentFixtures(index >= 0 ? list[index] : record);
    await persistContent();
    dialog.close();
    showToast(leetifyImported ? `${record.name}: ${record.statistics.length} jogadores e placar importados do Leetify` : demoFile?.size ? (record.statistics?.length ? `${record.name}: demo lida e ${record.statistics.length} jogadores extraídos` : `${record.name}: demo anexada; use Leetify ou print enquanto a extração estiver pendente`) : `${record.name} foi salvo`);
    if (returnSection) { const destination = returnSection; returnSection = null; go(destination); }
    else if (section === "tournaments") tournamentsView();
    else listView();
  }

  async function deleteEditor() {
    if (!editingId) return;
    const index = state[section].findIndex((item) => item.id === editingId);
    const [removed] = state[section].splice(index, 1);
    await persistContent();
    dialog.close();
    showToast(`${removed.name} foi removido`);
    listView();
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    const isError = /não foi|erro|unreachable|falhou|inválid|ultrapassa/i.test(String(message));
    toast.querySelector("span").textContent = message;
    toast.querySelector("i").textContent = isError ? "!" : "✓";
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), isError ? 9000 : 3200);
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
    if (section === "overview") overview(); else if (section === "users") usersView(); else if (section === "tournaments") tournamentsView(); else listView();
  }

  function closeEditor() {
    dialog.close();
    if (returnSection) { section = returnSection; returnSection = null; }
  }

  document.querySelectorAll("#adminNav button").forEach((button) => button.addEventListener("click", () => go(button.dataset.section)));
  document.querySelector("#mobileMenu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  document.querySelector("#closeDialog").addEventListener("click", closeEditor);
  document.querySelector("#cancelButton").addEventListener("click", closeEditor);
  deleteButton.addEventListener("click", async () => { try { await deleteEditor(); } catch (reason) { showToast(reason.message); } });
  form.addEventListener("submit", async (event) => { event.preventDefault(); if (!form.reportValidity()) return; try { await saveEditor(); } catch (reason) { showToast(reason.message); } });

  overview();
  window.addEventListener("hltpc:authenticated", loadPersistedContent);
  if (window.HLTPC_AUTHENTICATED) loadPersistedContent();
})();
