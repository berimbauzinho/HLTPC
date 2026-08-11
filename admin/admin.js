(() => {
  "use strict";

  const source = window.HLTPC_DATA;
  const MAX_LOCAL_DEMO_BYTES = 500 * 1024 * 1024;
  const confirmedPlayerAliases = new Map([
    ["GJota", ["GJ"]],
    ["Downey", ["Mikasa es su kasa"]],
    ["190", ["fraquinho"]]
  ]);
  const baselineTeamNames = [...new Set(source.tournaments.flatMap((event) => event.entries.map((entry) => entry.team)))];
  const baselineTeams = baselineTeamNames.map((name, index) => ({ id: `team-${index}`, name, acronym: initials(name), aliases: [], status: "published", logo: "", updated: "Derivado das edições" }));
  const baselineTeamNameById = new Map(baselineTeams.map((team) => [team.id, team.name]));
  const state = {
    players: source.players.map((name, index) => ({ id: `player-${index}`, name, alias: (confirmedPlayerAliases.get(name) || []).join(", "), status: "published", photo: "", teams: [...new Set(source.tournaments.flatMap((event) => event.entries.filter((entry) => entry.players.includes(name)).map((entry) => entry.team)))], updated: "Dados históricos" })),
    teams: baselineTeams.map((team) => ({ ...team })),
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

  function normalizedTeamName(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");
  }

  function normalizeTeamReferences() {
    let changed = false;
    const byId = new Map(state.teams.map((team) => [team.id, team]));
    const idByName = new Map();
    state.teams.forEach((team) => {
      const aliases = [...new Set([...(team.aliases || []), baselineTeamNameById.get(team.id)].filter((name) => name && name !== team.name))];
      if (JSON.stringify(aliases) !== JSON.stringify(team.aliases || [])) { team.aliases = aliases; changed = true; }
      [team.name, ...aliases].forEach((name) => idByName.set(normalizedTeamName(name), team.id));
    });
    const resolveId = (id, name) => byId.has(id) ? id : idByName.get(normalizedTeamName(name)) || "";
    const currentName = (id, fallback) => byId.get(id)?.name || fallback || "";
    const normalizeList = (record, namesKey, idsKey) => {
      const names = Array.isArray(record[namesKey]) ? record[namesKey] : [];
      const ids = Array.isArray(record[idsKey]) ? record[idsKey] : [];
      const nextIds = names.map((name, index) => resolveId(ids[index], name));
      const nextNames = names.map((name, index) => currentName(nextIds[index], name));
      if (JSON.stringify(nextIds) !== JSON.stringify(ids)) { record[idsKey] = nextIds; changed = true; }
      if (JSON.stringify(nextNames) !== JSON.stringify(names)) { record[namesKey] = nextNames; changed = true; }
    };
    state.tournaments.forEach((event) => normalizeList(event, "teams", "teamIds"));
    state.players.forEach((player) => normalizeList(player, "teams", "teamIds"));
    state.matches.forEach((match) => {
      ["A", "B"].forEach((side) => {
        const nameKey = `team${side}`;
        const idKey = `team${side}Id`;
        const id = resolveId(match[idKey], match[nameKey]);
        if (!id) return;
        const oldName = match[nameKey];
        const name = currentName(id, oldName);
        if (match[idKey] !== id) { match[idKey] = id; changed = true; }
        if (oldName !== name) {
          match[nameKey] = name;
          if (match[`slot${side}`] === oldName) match[`slot${side}`] = name;
          (match.statistics || []).forEach((player) => { if (player.team === oldName) player.team = name; });
          changed = true;
        }
      });
      const winnerId = resolveId(match.winnerId, match.winner);
      if (winnerId && (match.winnerId !== winnerId || match.winner !== currentName(winnerId, match.winner))) {
        match.winnerId = winnerId;
        match.winner = currentName(winnerId, match.winner);
        changed = true;
      }
    });
    return changed;
  }

  function migrateTeamRename(teamId, oldName, newName) {
    const team = state.teams.find((item) => item.id === teamId);
    if (!team || !oldName || oldName === newName) return;
    team.aliases = [...new Set([...(team.aliases || []), oldName].filter((name) => name && name !== newName))];
    normalizeTeamReferences();
  }

  function applyHistoricalImport2025() {
    const historical = window.HLTPC_IMPORT_2025;
    if (!historical) return 0;
    const version = Number(historical.version || 1);
    let changed = 0;
    (historical.players || []).forEach((imported) => {
      const player = state.players.find((item) => item.id === imported.id) || state.players.find((item) => normalizedNick(item.name) === normalizedNick(imported.name));
      if (!player || Number(player.identityImportVersion || 0) >= version) return;
      const aliases = [...new Set([
        ...String(player.alias || "").split(/[,;|]/),
        ...(Array.isArray(player.aliases) ? player.aliases : []),
        ...(imported.aliases || [])
      ].map((value) => String(value || "").trim()).filter(Boolean))];
      Object.assign(player, { steamId: imported.steamId, alias: aliases.join(", "), aliases, identityImportVersion: version, updated: "SteamID64 e aliases importados do histórico de 2025" });
      changed += 1;
    });
    (historical.matches || []).forEach((imported) => {
      const index = state.matches.findIndex((item) => item.id === imported.id);
      const current = index >= 0 ? state.matches[index] : null;
      if (current && Number(current.importVersion || 0) >= version) return;
      const record = { ...(current || {}), ...imported, importVersion: version };
      if (index >= 0) state.matches[index] = record; else state.matches.push(record);
      changed += 1;
    });
    return changed;
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
      const historicalImported = applyHistoricalImport2025();
      const referencesChanged = normalizeTeamReferences();
      const structureChanged = normalizeTournamentStructures();
      const leetifyImported = await syncPendingLeetifyMatches();
      if (historicalImported || referencesChanged || structureChanged || leetifyImported) await persistContent();
      go(section);
      showToast(historicalImported ? `Histórico de 2025 importado: ${historicalImported} registros atualizados` : leetifyImported ? `${leetifyImported} partida sincronizada com o Leetify` : "Conteúdo compartilhado carregado");
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
    const sources = [match.demoInfo ? `<i class="source-chip ${match.statistics?.length ? "ok" : "partial"}">DEMO</i>` : "", match.leetifyUrl ? `<i class="source-chip ${match.leetifySyncError ? "partial" : "ok"}">LEETIFY</i>` : "", match.scoreboardImage ? `<i class="source-chip ok">PRINT</i>` : "", match.resultSource === "manual" ? `<i class="source-chip ok">MANUAL</i>` : ""].join("");
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

  function editableSeriesMaps(item) {
    if (Array.isArray(item.maps) && item.maps.length) return item.maps;
    const bestOf = Number(item.bestOf || 1);
    if (bestOf <= 1) return [];
    return Array.from({ length: bestOf }, (_, index) => ({ id: `${item.id || "match"}-map-${index + 1}`, name: `Mapa ${index + 1}`, order: index + 1, score: "", statistics: [] }));
  }

  function seriesMapsMarkup(item, maps) {
    if (!maps.length) return "";
    return `<section class="admin-series-maps"><header><span>MAPAS DA SÉRIE</span><b>${maps.filter((map) => map.score).length}/${maps.length} com placar</b></header>${maps.map((map, index) => {
      const source = map.scoreSource === "manual" || map.resultSource === "manual" ? "Placar oficial manual" : map.statisticsSource === "missing" ? "Dados faltantes · preenchimento manual" : map.statisticsSource === "leetify" ? "Estatísticas: Leetify + demo" : map.statisticsSource === "demo" ? "Estatísticas: demo" : "Aguardando dados";
      return `<article class="${map.statisticsSource === "missing" && !map.score ? "missing" : ""}"><span><b>${escapeHtml(map.name || map.mapName || `Mapa ${index + 1}`)}</b><small>${escapeHtml(source)}</small></span><button type="button" data-edit-map="${index}">${escapeHtml(map.score || "Preencher placar")}</button></article>`;
    }).join("")}</section>`;
  }

  function manualResultFields(item, maps, manualResult) {
    if (!maps.length) {
      const savedScores = String(item.score || "").match(/\d+/g) || [];
      return `<fieldset class="manual-result"><legend>Placar oficial do mapa</legend><label class="manual-result-toggle"><input type="checkbox" name="manualResult" value="true" ${manualResult ? "checked" : ""} /><span><b>Informar o placar manualmente</b><small>Para MD1, informe os rounds do único mapa. Este placar tem prioridade sobre demo, Leetify e print.</small></span></label><div class="manual-score-fields" ${manualResult ? "" : "hidden"}><label>${escapeHtml(item.teamA || "Time A")}<input type="number" name="manualScoreA" min="0" max="99" step="1" value="${escapeHtml(savedScores[0] || "")}" /></label><i>×</i><label>${escapeHtml(item.teamB || "Time B")}<input type="number" name="manualScoreB" min="0" max="99" step="1" value="${escapeHtml(savedScores[1] || "")}" /></label></div></fieldset>`;
    }
    const rows = maps.map((map, index) => {
      const scores = String(map.score || "").match(/\d+/g) || [];
      return `<article class="manual-map-row" data-manual-map="${index}"><label>Mapa<input name="manualMapName_${index}" value="${escapeHtml(map.name || map.mapName || `Mapa ${index + 1}`)}" placeholder="Ex.: Mirage" /></label><div><label>${escapeHtml(item.teamA || "Time A")}<input type="number" name="manualMapScoreA_${index}" min="0" max="99" step="1" value="${escapeHtml(scores[0] || "")}" /></label><i>×</i><label>${escapeHtml(item.teamB || "Time B")}<input type="number" name="manualMapScoreB_${index}" min="0" max="99" step="1" value="${escapeHtml(scores[1] || "")}" /></label></div></article>`;
    }).join("");
    return `<fieldset class="manual-result"><legend>Placar oficial por mapa</legend><label class="manual-result-toggle"><input type="checkbox" name="manualResult" value="true" ${manualResult ? "checked" : ""} /><span><b>Confirmar ou corrigir os rounds de cada mapa</b><small>O resultado da série (ex.: 2–0) será calculado automaticamente a partir dos mapas vencidos. As estatísticas da demo/Leetify permanecem separadas.</small></span></label><input type="hidden" name="manualMapCount" value="${maps.length}" /><div class="manual-map-score-fields" ${manualResult ? "" : "hidden"}>${rows}<div class="manual-series-live"><small>RESULTADO DA SÉRIE</small><b>Aguardando os placares dos mapas</b></div></div></fieldset>`;
  }

  function formFields(item) {
    if (section === "players") return `<div class="editor-tabs"><button type="button" class="active" data-editor-tab="profile">Dados do jogador</button><button type="button" data-editor-tab="teams">Equipes</button></div><div data-editor-panel="profile">${textField("name", "Nick principal", item.name, "Ex.: lanches", true)}<div class="field-row">${textField("alias", "Aliases conhecidos", item.alias, "Ex.: GJ, outro nick")}${selectField("status", item.status)}</div>${textField("steamId", "SteamID64", item.steamId, "Ex.: 76561198300371519")}${fileField("photo", "Foto do jogador", "image/*")}<div class="helper">Separe aliases por vírgula. O SteamID64 é a identidade principal e conecta automaticamente qualquer nick usado na demo ou no Leetify ao perfil correto.</div></div><div data-editor-panel="teams" hidden><span class="field-title">Equipes defendidas</span><div class="team-checklist">${state.teams.map((team) => `<label><input type="checkbox" name="teams" value="${escapeHtml(team.name)}" ${(item.teams || []).includes(team.name) ? "checked" : ""} /><span><b>${escapeHtml(team.name)}</b><small>${escapeHtml(team.acronym)}</small></span></label>`).join("")}</div><div class="helper">As equipes encontradas nas escalações históricas já aparecem marcadas. Use esta área para complementar ou corrigir o perfil.</div></div>`;
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
      const maps = editableSeriesMaps(item);
      const manualResult = item.manualResult === true || item.manualResult === "true" || ["manual", "manual-maps"].includes(item.resultSource) || maps.some((map) => map.scoreSource === "manual" || map.resultSource === "manual");
      const seriesMaps = seriesMapsMarkup(item, maps);
      const sourceSummary = item.demoInfo || item.leetifyUrl || item.scoreboardImage || manualResult ? `<div class="match-source-summary"><span class="${demoHasStats ? "verified" : item.demoInfo ? "partial" : "muted"}"><b>${demoHasStats ? "1 · Demo confirmada" : item.demoInfo?.extractionStatus === "skipped-large" ? "1 · Demo grande" : item.demoInfo ? "1 · Demo anexada" : "1 · Sem demo"}</b><small>${item.demoInfo ? `${escapeHtml(item.demoInfo.fileName)}${demoHasStats ? ` · ${(item.statistics || []).length} jogadores` : item.demoInfo.extractionStatus === "skipped-large" ? " · leitura local ignorada" : " · extração pendente"}` : "Fonte primária opcional"}</small></span><span class="${leetifyHasStats ? "verified" : item.leetifyUrl ? "partial" : "muted"}"><b>2 · Leetify</b><small>${leetifyHasStats ? `${(item.statistics || []).length} jogadores · ${escapeHtml(item.leetifyInfo.mapName || "mapa identificado")}` : item.leetifySyncError ? escapeHtml(item.leetifySyncError) : item.leetifyUrl ? "Link salvo · aguarda importação" : "Fonte secundária opcional"}</small></span><span class="${item.scoreboardImage ? "verified" : "muted"}"><b>3 · Print</b><small>${item.scoreboardImage ? "Imagem salva como comprovação" : "Evidência visual opcional"}</small></span><span class="${manualResult ? "verified" : "muted"}"><b>4 · Manual</b><small>${manualResult ? `Resultado confirmado: ${escapeHtml(item.score || "—")}` : "Disponível mesmo sem arquivos"}</small></span></div>` : "";
      const manualFields = manualResultFields(item, maps, manualResult);
      return `${tournamentField}${teamsField}${textField("name", "Fase", item.name, "Ex.: Semifinal", true)}${selectField("status", item.status)}${seriesMaps}${manualFields}<fieldset class="match-evidence"><legend>Fontes dos dados</legend><div class="evidence-order"><b>1</b><span><strong>Demo · fonte principal</strong><small>Até 500 MB, o painel tenta extrair data e estatísticas. Acima disso, ignora somente a leitura local e continua salvando as outras fontes.</small></span></div>${fileField("demo", "Selecionar arquivo .dem", ".dem")}${urlField("demoUrl", "Ou link da demo no Google Drive", item.demoUrl, "https://drive.google.com/file/d/...")}${item.demoInfo ? `<div class="demo-result ${demoHasStats ? "" : "partial"}"><b>${demoHasStats ? "✓ Demo processada" : item.demoInfo.extractionStatus === "skipped-large" ? "⚠ Demo grande registrada; leitura local ignorada" : item.demoUrl ? "✓ Demo vinculada pelo Drive" : "⚠ Demo anexada, sem estatísticas automáticas"}</b><span>${escapeHtml(item.demoInfo.fileName)} · ${escapeHtml(item.demoInfo.mapName || "mapa não identificado")} · ${item.demoInfo.rounds || 0} rounds</span><small>${escapeHtml(item.demoInfo.playedAtLabel || item.subtitle || "Data não identificada")} · ${(item.statistics || []).length} jogadores extraídos</small>${item.demoInfo.warnings?.length ? `<small>${escapeHtml(item.demoInfo.warnings.join(" · "))}</small>` : ""}</div>` : ""}<div class="evidence-order"><b>2</b><span><strong>Leetify · fonte secundária</strong><small>Use sozinho ou para complementar rating/KAST quando a demo estiver disponível.</small></span></div>${urlField("leetifyUrl", "Link da partida no Leetify", item.leetifyUrl, "https://leetify.com/app/match-details/...")}<div class="evidence-order"><b>3</b><span><strong>Print do placar · comprovação visual</strong><small>Envie a tela final quando a demo ou o Leetify não trouxerem tudo.</small></span></div>${fileField("scoreboardImage", item.scoreboardImage ? "Substituir print do placar" : "Enviar print do placar", "image/*")}${item.scoreboardImage ? `<div class="scoreboard-preview"><img src="${escapeHtml(item.scoreboardImage)}" alt="Print do placar salvo" /><span><b>Print salvo</b><small>Um novo arquivo substituirá esta imagem.</small><label><input type="checkbox" name="removeScoreboardImage" value="true" /> Remover print atual</label></span></div>` : ""}</fieldset>${sourceSummary}<div class="helper" id="matchHelper">${generated ? "A data será extraída do nome da demo quando ela puder ser lida. Cada fonte funciona de forma independente e fica ligada somente a este confronto." : "Escolha uma edição: os times serão limitados exclusivamente às escalações daquele campeonato."}</div>`;
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
      const manualToggle = document.querySelector('input[name="manualResult"]');
      const manualFields = document.querySelector(".manual-score-fields, .manual-map-score-fields");
      const refreshSeriesResult = () => {
        const summary = document.querySelector(".manual-series-live b");
        if (!summary) return;
        let winsA = 0;
        let winsB = 0;
        document.querySelectorAll("[data-manual-map]").forEach((row) => {
          const index = row.dataset.manualMap;
          const rawA = document.querySelector(`[name="manualMapScoreA_${index}"]`)?.value || "";
          const rawB = document.querySelector(`[name="manualMapScoreB_${index}"]`)?.value || "";
          if (rawA === "" || rawB === "") return;
          const scoreA = Number(rawA);
          const scoreB = Number(rawB);
          if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA === scoreB) return;
          if (scoreA > scoreB) winsA += 1; else winsB += 1;
        });
        summary.textContent = `${current?.teamA || "Time A"} ${winsA} × ${winsB} ${current?.teamB || "Time B"}`;
      };
      manualToggle?.addEventListener("change", () => {
        manualFields.hidden = !manualToggle.checked;
        refreshSeriesResult();
      });
      manualFields?.querySelectorAll('input[type="number"]').forEach((input) => input.addEventListener("input", refreshSeriesResult));
      document.querySelectorAll("[data-edit-map]").forEach((button) => button.addEventListener("click", () => {
        if (manualToggle) manualToggle.checked = true;
        if (manualFields) manualFields.hidden = false;
        document.querySelector(`[name="manualMapScoreA_${button.dataset.editMap}"]`)?.focus();
        refreshSeriesResult();
      }));
      refreshSeriesResult();
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

  function playerNames(player) {
    const aliases = [
      ...(Array.isArray(player.aliases) ? player.aliases : []),
      ...String(player.alias || "").split(/[,;|]/),
      ...(confirmedPlayerAliases.get(player.name) || [])
    ];
    return [...new Set([player.name, ...aliases].map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function findPlayerIdentity(name, steamId = "") {
    const id = String(steamId || "").trim();
    if (id) {
      const bySteam = state.players.find((item) => String(item.steamId || "").trim() === id);
      if (bySteam) return bySteam;
    }
    const normalized = normalizedNick(name);
    const confirmedCanonical = [...confirmedPlayerAliases.entries()].find(([, aliases]) => aliases.some((alias) => normalizedNick(alias) === normalized))?.[0];
    return state.players.find((item) => normalizedNick(item.name) === normalizedNick(confirmedCanonical || ""))
      || state.players.find((item) => playerNames(item).some((value) => normalizedNick(value) === normalized));
  }

  function canonicalPlayerName(name, steamId = "", learn = false) {
    const player = findPlayerIdentity(name, steamId);
    if (player && learn) {
      const id = String(steamId || "").trim();
      if (id && !player.steamId) {
        player.steamId = id;
        player.updated = "SteamID64 identificado automaticamente";
      }
      const rawName = String(name || "").trim();
      if (rawName && normalizedNick(rawName) !== normalizedNick(player.name) && !playerNames(player).some((value) => normalizedNick(value) === normalizedNick(rawName))) {
        player.alias = [...String(player.alias || "").split(/[,;|]/).map((value) => value.trim()).filter(Boolean), rawName].join(", ");
      }
    }
    return player?.name || String(name || "Desconhecido");
  }

  function leetifyMatchId(value) {
    const match = String(value || "").match(/match-details\/([0-9a-f-]{20,})/i);
    return match?.[1] || "";
  }

  function tournamentEntries(tournamentId) {
    return source.tournaments.find((event) => event.id === tournamentId)?.entries || [];
  }

  function sameTeamName(first, second) {
    const find = (name) => state.teams.find((team) => [team.name, ...(team.aliases || [])].some((value) => normalizedTeamName(value) === normalizedTeamName(name)));
    const firstTeam = find(first);
    const secondTeam = find(second);
    return firstTeam && secondTeam ? firstTeam.id === secondTeam.id : normalizedTeamName(first) === normalizedTeamName(second);
  }

  function rosterIdentity(tournamentId, team) {
    const entry = tournamentEntries(tournamentId).find((item) => sameTeamName(item.team, team));
    const steamIds = new Set();
    const names = new Set();
    (entry?.players || []).forEach((name) => {
      names.add(normalizedNick(name));
      const player = findPlayerIdentity(name);
      if (!player) return;
      playerNames(player).forEach((value) => names.add(normalizedNick(value)));
      if (player.steamId) steamIds.add(String(player.steamId));
    });
    return { steamIds, names };
  }

  function identityScore(player, roster) {
    const steamId = String(player.steam64Id || player.steamid || "");
    if (steamId && roster.steamIds.has(steamId)) return 100;
    const canonical = canonicalPlayerName(player.name || player.demoName, steamId);
    return roster.names.has(normalizedNick(canonical)) || roster.names.has(normalizedNick(player.name || player.demoName)) ? 5 : 0;
  }

  function mapGroupsToMatchTeams(match, players, groupValue) {
    const groups = [...new Set(players.map(groupValue).filter((value) => value !== "" && value != null))];
    if (groups.length !== 2) throw new Error("A fonte não retornou exatamente duas equipes. Use o resultado manual para esta partida.");
    const rosterA = rosterIdentity(match.tournamentId, match.teamA);
    const rosterB = rosterIdentity(match.tournamentId, match.teamB);
    const score = (group, roster) => players.filter((player) => groupValue(player) === group).reduce((total, player) => total + identityScore(player, roster), 0);
    const direct = score(groups[0], rosterA) + score(groups[1], rosterB);
    const swapped = score(groups[0], rosterB) + score(groups[1], rosterA);
    if (!Math.max(direct, swapped) || direct === swapped) throw new Error("Não foi possível distinguir os times com segurança. Cadastre os SteamID64 dos jogadores ou informe o resultado manualmente.");
    const groupA = direct > swapped ? groups[0] : groups[1];
    const groupB = direct > swapped ? groups[1] : groups[0];
    const matchedBySteamId = players.filter((player) => {
      const id = String(player.steam64Id || player.steamid || "");
      return id && (rosterA.steamIds.has(id) || rosterB.steamIds.has(id));
    }).length;
    return { groupA, groupB, confidence: Math.abs(direct - swapped), matchedBySteamId };
  }

  function leetifyTeamMapping(match, players) {
    const mapped = mapGroupsToMatchTeams(match, players, (player) => numberValue(player.initialTeamNumber));
    return { numberA: mapped.groupA, numberB: mapped.groupB, confidence: mapped.confidence, matchedBySteamId: mapped.matchedBySteamId };
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
    const { numberA, numberB, confidence, matchedBySteamId } = leetifyTeamMapping(match, payload.playerStats);
    const scoreA = roundsForTeam(numberA);
    const scoreB = roundsForTeam(numberB);
    const rounds = scoreA + scoreB;
    const statistics = payload.playerStats.map((player) => {
      const kills = numberValue(player.totalKills);
      const deaths = numberValue(player.totalDeaths);
      const teamNumber = numberValue(player.initialTeamNumber);
      return {
        steamid: String(player.steam64Id || ""),
        name: canonicalPlayerName(player.name, player.steam64Id, true),
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
    const manualResult = match.manualResult === true || match.manualResult === "true" || match.resultSource === "manual";
    const importedScore = scoreA || scoreB ? `${scoreA} - ${scoreB}` : "";
    const importedWinner = scoreA > scoreB ? match.teamA : scoreB > scoreA ? match.teamB : "";
    return {
      statistics,
      statisticsSource: "leetify",
      score: manualResult && match.score ? match.score : importedScore,
      winner: manualResult && match.winner ? match.winner : importedWinner,
      winnerId: manualResult && match.winnerId ? match.winnerId : importedWinner === match.teamA ? match.teamAId || "" : importedWinner === match.teamB ? match.teamBId || "" : "",
      resultSource: manualResult ? "manual" : "leetify",
      leetifySyncError: "",
      leetifyInfo: { matchId, importedAt: new Date().toISOString(), finishedAt: payload.finishedAt || "", mapName: payload.mapName || "", rounds, scoreA, scoreB, status: payload.status || "ready", teamMapping: { numberA, numberB, confidence, matchedBySteamId } }
    };
  }

  function mergeDemoWithLeetify(demoStatistics, leetifyStatistics) {
    const secondary = new Map();
    leetifyStatistics.forEach((player) => {
      if (player.steamid) secondary.set(`steam:${player.steamid}`, player);
      secondary.set(`name:${normalizedNick(player.name)}`, player);
    });
    return demoStatistics.map((player) => {
      const extra = secondary.get(`steam:${player.steamid}`) || secondary.get(`name:${normalizedNick(player.name)}`) || {};
      return {
        ...player,
        team: player.team || extra.team || "",
        kast: extra.kast ?? player.kast,
        rating: extra.rating ?? player.rating,
        leetifyRating: extra.leetifyRating ?? player.leetifyRating,
        hsPercent: extra.hsPercent ?? player.hsPercent
      };
    });
  }

  async function syncPendingLeetifyMatches() {
    let imported = 0;
    const needsIdentityMigration = (item) => item.leetifyUrl && (!(item.statistics || []).length || !item.leetifyInfo?.teamMapping);
    for (const match of state.matches.filter(needsIdentityMigration)) {
      try {
        const importedMatch = await importLeetifyMatch(match.leetifyUrl, match, true);
        if (match.statisticsSource === "demo" && (match.statistics || []).length) {
          const { statistics: leetifyStatistics, statisticsSource: _, ...metadata } = importedMatch;
          Object.assign(match, metadata);
          match.statistics = mergeDemoWithLeetify(match.statistics, leetifyStatistics);
          match.statisticsSource = "demo";
          match.statisticsSecondarySource = "leetify";
        } else Object.assign(match, importedMatch);
        match.updated = match.statisticsSource === "demo" ? "Identidade revisada · demo principal" : "Identidade e estatísticas revisadas pelo Leetify";
        imported += 1;
      } catch (reason) {
        match.leetifySyncError = reason.message;
      }
    }
    return imported;
  }

  async function parseDemoFile(file, match) {
    if (!file.name.toLowerCase().endsWith(".dem")) throw new Error("Selecione um arquivo .dem do Counter-Strike 2.");
    if (file.size > MAX_LOCAL_DEMO_BYTES) {
      const playedAt = demoPlayedAt(file);
      return {
        demoInfo: {
          fileName: file.name,
          fileSize: file.size,
          mapName: "",
          serverName: "",
          rounds: 0,
          playedAt: playedAt.iso,
          playedAtLabel: playedAt.label,
          processedAt: new Date().toISOString(),
          parser: "Leitura local ignorada",
          rawFileStored: false,
          extractionStatus: "skipped-large",
          warnings: ["Demo acima de 500 MB: a leitura local foi ignorada para proteger a memória. Leetify, print e resultado manual continuam disponíveis."]
        },
        statistics: [],
        statisticsSource: ""
      };
    }
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
      if (!stats.has(id)) stats.set(id, { steamid: String(steamid || ""), name: canonicalPlayerName(name, steamid, true), demoName: String(name || ""), team: String(team || ""), kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0 });
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
        if (scoreboard.length) statistics = scoreboard.map((player) => ({ steamid: String(player.steamid), name: canonicalPlayerName(player.name, player.steamid, true), demoName: String(player.name || ""), team: String(player.team_name || ""), kills: numberValue(player.kills_total), deaths: numberValue(player.deaths_total), assists: numberValue(player.assists_total), headshots: numberValue(player.headshot_kills_total), damage: numberValue(player.damage_total), adr: rounds ? Number((numberValue(player.damage_total) / rounds).toFixed(1)) : null, kd: numberValue(player.deaths_total) ? Number((numberValue(player.kills_total) / numberValue(player.deaths_total)).toFixed(2)) : numberValue(player.kills_total) })).sort((a, b) => b.kills - a.kills || b.damage - a.damage);
      } catch (reason) { warnings.push(`placar final: ${reason.message || reason}`); }
    }
    let teamMapping = null;
    if (statistics.length && match?.teamA && match?.teamB) {
      try {
        teamMapping = mapGroupsToMatchTeams(match, statistics, (player) => player.team);
        statistics = statistics.map((player) => ({ ...player, team: player.team === teamMapping.groupA ? match.teamA : player.team === teamMapping.groupB ? match.teamB : player.team }));
      } catch (reason) {
        warnings.push(`equipes: ${reason.message || reason}`);
      }
    }
    const playedAt = demoPlayedAt(file);
    return {
      demoInfo: { fileName: file.name, fileSize: file.size, mapName: String(header.map_name || ""), serverName: String(header.server_name || ""), rounds, playedAt: playedAt.iso, playedAtLabel: playedAt.label, processedAt: new Date().toISOString(), parser: "demoparser2 0.42.0", rawFileStored: false, extractionStatus: statistics.length ? "complete" : "pending", teamMapping: teamMapping ? { rawTeamA: teamMapping.groupA, rawTeamB: teamMapping.groupB, confidence: teamMapping.confidence, matchedBySteamId: teamMapping.matchedBySteamId } : null, warnings: [...new Set(warnings)] },
      statistics,
      statisticsSource: statistics.length ? "demo" : ""
    };
  }

  async function saveEditor() {
    const formData = new FormData(form);
    const values = {};
    const saveWarnings = [];
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
    if (scoreboardFile?.size > 2 * 1024 * 1024) saveWarnings.push("O print passou de 2 MB e foi ignorado");
    else if (scoreboardFile?.size) values.scoreboardImage = await fileAsDataUrl(scoreboardFile);
    if (section === "matches" && values.removeScoreboardImage === "true") values.scoreboardImage = "";
    delete values.removeScoreboardImage;
    const list = state[section];
    if (section === "matches" && values.teamA === values.teamB) { showToast("Escolha dois times diferentes"); return; }
    const previousTeam = section === "teams" && editingId ? state.teams.find((item) => item.id === editingId) : null;
    if (section === "teams") {
      const duplicate = state.teams.find((item) => item.id !== editingId && [item.name, ...(item.aliases || [])].some((name) => normalizedTeamName(name) === normalizedTeamName(values.name)));
      if (duplicate) { showToast(`Esse nome já pertence ao time ${duplicate.name}`); return; }
      values.aliases = [...new Set([...(previousTeam?.aliases || []), previousTeam?.name].filter((name) => name && name !== values.name))];
    }
    if (section === "players" && String(values.steamId || "").trim()) {
      values.steamId = String(values.steamId).trim();
      const duplicateSteamId = state.players.find((item) => item.id !== editingId && String(item.steamId || "").trim() === values.steamId);
      if (duplicateSteamId) { showToast(`Esse SteamID64 já pertence ao jogador ${duplicateSteamId.name}`); return; }
    }
    const index = list.findIndex((item) => item.id === editingId);
    const previousRecord = index >= 0 ? list[index] : {};
    const fallbackName = section === "matches" ? `${values.teamA} x ${values.teamB}` : "Novo registro";
    const record = { ...previousRecord, ...values, name: values.name || fallbackName, id: editingId || `${section}-${Date.now()}`, updated: "Atualizado pelo painel" };
    const demoFile = section === "matches" ? formData.get("demo") : null;
    let leetifyImported = false;
    if (section === "matches") {
      const manualResult = values.manualResult === "true";
      record.manualResult = manualResult;
      const manualMapCount = Number(values.manualMapCount || 0);
      if (manualResult && manualMapCount > 0) {
        const originalMaps = editableSeriesMaps(previousRecord);
        const maps = [];
        let winsA = 0;
        let winsB = 0;
        for (let mapIndex = 0; mapIndex < manualMapCount; mapIndex += 1) {
          const original = originalMaps[mapIndex] || {};
          const rawA = String(values[`manualMapScoreA_${mapIndex}`] || "").trim();
          const rawB = String(values[`manualMapScoreB_${mapIndex}`] || "").trim();
          const mapName = String(values[`manualMapName_${mapIndex}`] || original.name || `Mapa ${mapIndex + 1}`).trim();
          if (!rawA && !rawB) {
            if (original.demoUrl || original.leetifyUrl || (original.statistics || []).length) maps.push({ ...original, name: mapName });
            continue;
          }
          if (!rawA || !rawB) {
            showToast(`Preencha os dois lados do placar no ${mapName}`);
            return;
          }
          const scoreA = Number(rawA);
          const scoreB = Number(rawB);
          if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA === scoreB) {
            showToast(`Informe dois placares inteiros e diferentes no ${mapName}`);
            return;
          }
          if (scoreA > scoreB) winsA += 1; else winsB += 1;
          maps.push({
            ...original,
            id: original.id || `${record.id}-map-${mapIndex + 1}`,
            order: original.order || mapIndex + 1,
            name: mapName,
            scoreA,
            scoreB,
            score: `${scoreA} - ${scoreB}`,
            rounds: scoreA + scoreB,
            winner: scoreA > scoreB ? record.teamA : record.teamB,
            resultSource: "manual",
            scoreSource: "manual",
            statisticsSource: (original.statistics || []).length ? original.statisticsSource : "manual",
            evidenceNote: "Placar oficial confirmado manualmente no painel; estatísticas mantêm sua fonte original."
          });
        }
        if (!maps.some((map) => map.score)) {
          showToast("Informe o placar de pelo menos um mapa");
          return;
        }
        const winsNeeded = Math.ceil(Number(record.bestOf || manualMapCount) / 2);
        const seriesFinished = Math.max(winsA, winsB) >= winsNeeded;
        record.maps = maps;
        record.score = seriesFinished ? `${winsA} - ${winsB}` : "";
        record.winner = seriesFinished ? (winsA > winsB ? record.teamA : record.teamB) : "";
        record.winnerId = seriesFinished ? (winsA > winsB ? record.teamAId || "" : record.teamBId || "") : "";
        record.resultSource = "manual-maps";
        record.evidenceNote = seriesFinished ? `Resultado oficial calculado pelos mapas: ${record.teamA} ${winsA}–${winsB} ${record.teamB}.` : `Série em andamento: ${winsA}–${winsB} em mapas com placar confirmado.`;
        if (seriesFinished) record.status = "finished";
      } else if (manualResult) {
        const scoreA = Number(values.manualScoreA);
        const scoreB = Number(values.manualScoreB);
        if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA === scoreB) {
          showToast("Informe os rounds oficiais do mapa com dois placares inteiros e diferentes");
          return;
        }
        record.score = `${scoreA} - ${scoreB}`;
        record.winner = scoreA > scoreB ? record.teamA : record.teamB;
        record.winnerId = scoreA > scoreB ? record.teamAId || "" : record.teamBId || "";
        record.resultSource = "manual";
        record.evidenceNote = "Resultado informado manualmente pelo painel administrativo.";
      } else if (["manual", "manual-maps"].includes(previousRecord.resultSource)) {
        record.score = "";
        record.winner = "";
        record.winnerId = "";
        record.resultSource = "";
        if (record.evidenceNote === "Resultado informado manualmente pelo painel administrativo.") record.evidenceNote = "";
      }
      delete record.manualScoreA;
      delete record.manualScoreB;
      delete record.manualMapCount;
      Object.keys(record).filter((key) => /^manualMap(Name|ScoreA|ScoreB)_\d+$/.test(key)).forEach((key) => delete record[key]);
    }
    if (demoFile?.size) {
      try {
        Object.assign(record, await parseDemoFile(demoFile, record));
        record.subtitle = record.demoInfo.playedAtLabel;
        record.updated = record.demoInfo.extractionStatus === "skipped-large" ? "Demo grande registrada; leitura local ignorada" : "Demo processada pelo painel";
      } catch (reason) {
        const playedAt = demoPlayedAt(demoFile);
        record.demoInfo = { fileName: demoFile.name, fileSize: demoFile.size, playedAt: playedAt.iso, playedAtLabel: playedAt.label, processedAt: new Date().toISOString(), rawFileStored: false, extractionStatus: "failed", warnings: [String(reason.message || reason)] };
        saveWarnings.push(`A demo não pôde ser lida: ${reason.message || reason}`);
      }
    }
    if (section === "matches" && record.leetifyUrl) {
      try {
        const imported = await importLeetifyMatch(record.leetifyUrl, record);
        if (record.statisticsSource === "demo" && (record.statistics || []).length) {
          const { statistics: leetifyStatistics, statisticsSource: _, ...metadata } = imported;
          Object.assign(record, metadata);
          record.statistics = mergeDemoWithLeetify(record.statistics, leetifyStatistics);
          record.statisticsSource = "demo";
          record.statisticsSecondarySource = "leetify";
        } else Object.assign(record, imported);
        leetifyImported = true;
        record.updated = record.statisticsSource === "demo" ? "Demo principal · Leetify complementar" : "Estatísticas importadas do Leetify";
      } catch (reason) {
        record.leetifySyncError = String(reason.message || reason);
        saveWarnings.push(`Leetify não importado: ${reason.message || reason}`);
      }
    }
    if (index >= 0) list[index] = record; else list.unshift(record);
    if (section === "teams" && previousTeam) migrateTeamRename(record.id, previousTeam.name, record.name);
    if (section === "tournaments") ensureTournamentFixtures(index >= 0 ? list[index] : record);
    normalizeTeamReferences();
    await persistContent();
    dialog.close();
    const successMessage = leetifyImported ? `${record.name}: ${(record.statistics || []).length} jogadores e resultado conferidos` : demoFile?.size ? (record.demoInfo?.extractionStatus === "skipped-large" ? `${record.name}: demo grande registrada; outras fontes foram salvas` : record.statistics?.length ? `${record.name}: demo lida e ${record.statistics.length} jogadores extraídos` : `${record.name}: demo registrada sem estatísticas`) : `${record.name} foi salvo`;
    showToast(saveWarnings.length ? `${successMessage}. Aviso: ${saveWarnings.join(" · ")}` : successMessage);
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
