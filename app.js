(async () => {
  "use strict";

  const data = window.HLTPC_DATA;
  let shared = {};
  try {
    const response = await fetch("/api/content", { cache: "no-store" });
    if (response.ok) shared = await response.json();
  } catch (_) {}
  const playerMeta = new Map((shared.players || []).map((item) => [item.name, item]));
  const teamMeta = new Map((shared.teams || []).map((item) => [item.name, item]));
  const tournamentMeta = new Map((shared.tournaments || []).map((item) => [item.id, item]));
  (shared.players || []).forEach((item) => { if (item.name && !data.players.includes(item.name)) data.players.push(item.name); });
  data.tournaments.forEach((event) => {
    const saved = tournamentMeta.get(event.id);
    if (!saved) return;
    if (saved.name) event.name = saved.name;
    if (saved.subtitle && Number(saved.subtitle)) event.year = Number(saved.subtitle);
    if (saved.format) event.format = saved.format;
  });
  if (Array.isArray(shared.matches)) data.matches = shared.matches.filter((item) => item.status === "published");
  if (Array.isArray(shared.news) && shared.news.length) data.news = shared.news.filter((item) => item.status === "published").map((item) => ({ id: item.id, title: item.name, summary: item.subtitle, author: item.author || "HLTPC", date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") ? item.date : new Date().toISOString().slice(0, 10), tournamentId: item.tournamentId || null, image: item.image || "" }));
  const isOfficialEvent = (event) => ["major", "official"].includes(event.category);
  const officialEvents = data.tournaments.filter(isOfficialEvent);
  const playerHistory = new Map(data.players.map((player) => [player, []]));
  const teams = new Map();

  data.tournaments.forEach((event) => {
    event.entries.forEach((entry) => {
      entry.players.forEach((player) => {
        if (!playerHistory.has(player)) playerHistory.set(player, []);
        playerHistory.get(player).push({ event, team: entry.team });
      });

      if (!teams.has(entry.team)) teams.set(entry.team, []);
      teams.get(entry.team).push({ event, players: entry.players });
    });
  });
  (shared.teams || []).forEach((item) => { if (item.name && !teams.has(item.name)) teams.set(item.name, []); });

  const byNewest = (a, b) => b.event.year - a.event.year || b.event.id.localeCompare(a.event.id);
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const formatDate = (value) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  const categoryLabel = (category) => ({ major: "Major", official: "Campeonato oficial", resenha: "Campeonato de resenha" }[category] || "Campeonato");
  const demoLabel = (demos) => ({ unavailable: "Sem demo", partial: "Demos parciais", future: "Aguardando campeonato" }[demos] || "Não informado");
  const teamBadge = (team) => { const meta = teamMeta.get(team) || {}; return meta.logo ? `<img src="${escapeHtml(meta.logo)}" alt="" />` : escapeHtml((meta.acronym || team.split(/\s+/).map((part) => part[0]).join("").slice(0, 3)).toUpperCase()); };

  function titleCount(player, category) {
    return data.tournaments.filter((event) => event.category === category && event.champion && event.entries.some((entry) => entry.team === event.champion && entry.players.includes(player))).length;
  }

  function officialTitleCount(player) {
    return officialEvents.filter((event) => event.champion && event.entries.some((entry) => entry.team === event.champion && entry.players.includes(player))).length;
  }

  function renderHero() {
    const news = [...data.news].sort((a, b) => b.date.localeCompare(a.date));
    let index = 0;
    const draw = () => {
      const item = news[index];
      document.querySelector("#hero").innerHTML = item ? `<article class="hero news-hero" ${item.image ? `style="--hero-image:url('${escapeHtml(item.image)}')"` : ""}>
        <div class="hero-content"><span class="hero-tag">NOTÍCIA EM DESTAQUE</span><h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.summary)}</p><div class="hero-news-meta"><time>${formatDate(item.date)}</time><span>por ${escapeHtml(item.author)}</span><a href="#noticias">Ver todas as notícias →</a></div></div>
        ${news.length > 1 ? `<div class="hero-progress" aria-label="Notícia ${index + 1} de ${news.length}">${news.map((_, dot) => `<i class="${dot === index ? "active" : ""}"></i>`).join("")}</div>` : ""}
      </article>` : `<article class="hero"><div class="hero-content"><span class="hero-tag">HLTPC</span><h1>Histórias da turma</h1><p>As notícias publicadas pelo painel administrativo aparecerão aqui.</p></div></article>`;
    };
    draw();
    if (news.length > 1) window.setInterval(() => { index = (index + 1) % news.length; draw(); }, 20000);
  }

  function renderTicker() {
    const current = data.tournaments.find((event) => event.status === "ongoing");
    document.querySelector("#tickerText").textContent = current
      ? `${current.name} ${current.year}: ${current.entries.map((entry) => entry.team).join(" · ")} — calendário ainda não divulgado`
      : "Nenhum campeonato em andamento";
  }

  function newsMarkup(items) {
    return items.map((item) => `
      <article class="news-item">
        <time class="news-date">${formatDate(item.date)}</time>
        <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)} · por ${escapeHtml(item.author)}</p></div>
        <span>›</span>
      </article>`).join("");
  }

  function renderNews() {
    const sorted = [...data.news].sort((a, b) => b.date.localeCompare(a.date));
    document.querySelector("#homeNews").innerHTML = newsMarkup(sorted.slice(0, 1));
    document.querySelector("#news").innerHTML = newsMarkup(sorted);
  }

  function renderRanking() {
    const ranking = data.players
      .map((player) => ({ player, official: officialTitleCount(player), majors: titleCount(player, "major") }))
      .sort((a, b) => b.official - a.official || b.majors - a.majors || a.player.localeCompare(b.player, "pt-BR"))
      .slice(0, 8);
    document.querySelector("#titleRanking").innerHTML = ranking.map((row, index) => `
      <div class="rank-row"><span>${String(index + 1).padStart(2, "0")}</span><b>${escapeHtml(row.player)}<small>${row.majors} Major${row.majors === 1 ? "" : "s"}</small></b><em>${row.official} título${row.official === 1 ? "" : "s"}</em></div>`).join("");
  }

  function renderHomeUpcoming() {
    const upcoming = data.matches.find((match) => ["published", "scheduled", "live"].includes(match.status) && !match.score);
    document.querySelector("#homeUpcoming").innerHTML = upcoming ? `<div class="event-matches home-match">${matchMarkup(upcoming)}</div>` : `<div class="empty compact"><b>Próxima partida ainda não divulgada</b>Assim que um confronto for publicado no painel, ele aparecerá aqui.</div>`;
  }

  function renderMatches() {
    const upcoming = data.matches.filter((match) => ["scheduled", "live"].includes(match.status));
    const finished = data.matches.filter((match) => match.status === "finished");
    document.querySelector("#upcomingMatches").innerHTML = upcoming.length ? "" : `<div class="empty"><b>Calendário ainda não divulgado</b>O PGL Major Abadia 2026 está em andamento, mas nenhum confronto oficial foi informado.</div>`;
    document.querySelector("#finishedMatches").innerHTML = finished.length ? "" : `<div class="empty"><b>Placares antigos não cadastrados</b>Os campeões e as escalações estão preservados em Campeonatos. Nenhum confronto foi deduzido a partir desses resultados.</div>`;
  }

  function tournamentMarkup(event) {
    const winner = event.champion || "A definir";
    return `
      <article class="tournament" data-category="${event.category}">
        <button type="button" aria-expanded="false">
          <span class="event-year">${event.year}</span>
          <div class="event-main"><h3>${escapeHtml(event.name)}</h3><p>${categoryLabel(event.category)} · ${event.entries.length} times</p></div>
          <span class="event-status ${event.status}">${event.status === "ongoing" ? "EM ANDAMENTO" : "FINALIZADO"}</span>
          <span class="event-toggle">＋</span>
        </button>
        <div class="event-body">
          <div class="event-details">
            <div><small>CAMPEÃO</small><b>${escapeHtml(winner)}</b></div>
            <div><small>FORMATO</small><b>${escapeHtml(event.format)}</b></div>
            <div><small>BASE ESTATÍSTICA</small><b>${demoLabel(event.demos)}</b></div>
          </div>
          <div class="rosters">${event.entries.map((entry) => `
            <div class="roster ${entry.team === event.champion ? "champion" : ""}">
              <h4>${entry.team === event.champion ? "🏆 " : ""}${escapeHtml(entry.team)}</h4>
              <ul>${entry.players.map((player) => `<li><a class="entity-link" href="#jogador/${encodeURIComponent(player)}">${escapeHtml(player)}</a></li>`).join("")}</ul>
            </div>`).join("")}</div>
          <p class="event-note">${escapeHtml(event.note)}</p>
          <a class="event-page-link" href="#campeonato/${encodeURIComponent(event.id)}/overview">Abrir página do campeonato →</a>
        </div>
      </article>`;
  }

  function renderTournaments(filter = "all") {
    const filtered = data.tournaments.filter((event) => filter === "all" || event.category === filter).sort((a, b) => b.year - a.year || b.id.localeCompare(a.id));
    document.querySelector("#tournaments").innerHTML = filtered.map(tournamentMarkup).join("");
    document.querySelectorAll(".tournament>button").forEach((button) => button.addEventListener("click", () => {
      const card = button.closest(".tournament");
      card.classList.toggle("open");
      button.setAttribute("aria-expanded", String(card.classList.contains("open")));
    }));
  }

  function renderPlayers(search = "") {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    const visible = data.players.filter((player) => player.toLocaleLowerCase("pt-BR").includes(normalized));
    document.querySelector("#players").innerHTML = visible.map((player) => {
      const history = [...(playerHistory.get(player) || [])].sort(byNewest);
      const meta = playerMeta.get(player) || {};
      return `<a class="profile-card player-card" href="#jogador/${encodeURIComponent(player)}">
        <div class="player-card-head"><span>${meta.photo ? `<img src="${escapeHtml(meta.photo)}" alt="" />` : escapeHtml(player.slice(0, 2).toUpperCase())}</span><div><h3>${escapeHtml(player)}</h3><p class="profile-meta">${history.length} participaç${history.length === 1 ? "ão" : "ões"}</p></div></div>
        <div class="trophies"><div class="trophy-count"><b>${officialTitleCount(player)}</b><small>títulos oficiais</small></div><div class="trophy-count major-count"><b>${titleCount(player, "major")}</b><small>Majors</small></div></div>
        <ul class="history">${history.map(({ event, team }) => `<li><b>${event.year} · ${escapeHtml(team)}</b>${escapeHtml(event.name)}</li>`).join("")}</ul>
      </a>`;
    }).join("");
  }

  function renderPlayerProfile(player) {
    const history = [...(playerHistory.get(player) || [])].sort(byNewest);
    const current = history[0];
    const meta = playerMeta.get(player) || {};
    const wins = data.tournaments.filter((event) => event.champion && event.entries.some((entry) => entry.team === event.champion && entry.players.includes(player)));
    const uniqueTeams = [...new Set([...history.map((item) => item.team), ...(meta.teams || [])])];
    document.querySelector("#playerProfile").innerHTML = `<a class="profile-back" href="#jogadores">← Voltar aos jogadores</a>
      <article class="player-hero">
        <div class="player-portrait">${meta.photo ? `<img src="${escapeHtml(meta.photo)}" alt="${escapeHtml(player)}" />` : `<span>${escapeHtml(player.slice(0, 2).toUpperCase())}</span>`}<small>PLAYER</small></div>
        <div class="player-summary"><span>PERFIL HLTPC</span><h1>${escapeHtml(player)}</h1><p>Competidor do histórico oficial da turma</p>
          <dl><div><dt>Equipe mais recente</dt><dd>${current ? `<a class="entity-link" href="#time/${encodeURIComponent(current.team)}">${escapeHtml(current.team)}</a>` : "Sem equipe"}</dd></div><div><dt>Participações</dt><dd>${history.length}</dd></div><div><dt>Títulos oficiais</dt><dd>${officialTitleCount(player)}</dd></div><div><dt>Majors conquistados</dt><dd>${titleCount(player, "major")}</dd></div></dl>
        </div>
        <div class="player-rating major-rating"><small>MAJORS</small><b>${titleCount(player, "major")}</b><span>conquistados</span></div>
      </article>
      <section class="achievement-strip"><header><span>CONQUISTAS</span><b>${officialTitleCount(player)} título${officialTitleCount(player) === 1 ? "" : "s"} oficial${officialTitleCount(player) === 1 ? "" : "is"} · ${titleCount(player, "major")} Major${titleCount(player, "major") === 1 ? "" : "s"}</b></header><div>${wins.length ? wins.map((event) => `<article class="${event.category === "major" ? "major-win" : ""}"><i>${event.category === "major" ? "♛" : "★"}</i><span><b>${escapeHtml(event.name)}</b><small>${event.year} · ${categoryLabel(event.category)}</small></span></article>`).join("") : `<p>Nenhum título registrado até o momento.</p>`}</div></section>
      <div class="player-detail-grid"><section><div class="section-heading"><div><span>CARREIRA</span><h2>Histórico por campeonato</h2></div></div><div class="career-list">${history.map(({ event, team }) => `<article><time>${event.year}</time><div><b><a class="entity-link" href="#time/${encodeURIComponent(team)}">${escapeHtml(team)}</a></b><span><a class="entity-link" href="#campeonato/${encodeURIComponent(event.id)}/overview">${escapeHtml(event.name)}</a></span></div><em>${event.champion === team ? "CAMPEÃO" : event.status === "ongoing" ? "EM ANDAMENTO" : "PARTICIPANTE"}</em></article>`).join("")}</div></section><aside><div class="section-heading"><div><span>ORGANIZAÇÕES</span><h2>Equipes</h2></div></div><div class="profile-teams">${uniqueTeams.map((team) => `<a href="#time/${encodeURIComponent(team)}">${escapeHtml(team)}</a>`).join("")}</div></aside></div>`;
  }

  function renderTeams() {
    const organizations = [...teams.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
    document.querySelector("#teams").innerHTML = organizations.map(([team, appearances]) => {
      const history = [...appearances].sort(byNewest);
      const titles = officialEvents.filter((event) => event.champion === team).length;
      const meta = teamMeta.get(team) || {};
      return `<a class="profile-card team-card" href="#time/${encodeURIComponent(team)}">
        <div class="team-card-head"><span>${meta.logo ? `<img src="${escapeHtml(meta.logo)}" alt="" />` : escapeHtml((meta.acronym || team.slice(0, 3)).toUpperCase())}</span><div><h3>${escapeHtml(team)}</h3><p class="profile-meta">${history.length} participaç${history.length === 1 ? "ão" : "ões"} · ${titles} título${titles === 1 ? "" : "s"}</p></div></div>
        <ul class="history">${history.map(({ event, players }) => `<li><b>${event.year} · ${escapeHtml(event.name)}</b>${players.map(escapeHtml).join(" · ")}</li>`).join("")}</ul>
      </a>`;
    }).join("");
  }

  function renderTeamProfile(team, tab = "overview") {
    const appearances = [...(teams.get(team) || [])].sort(byNewest);
    const latest = appearances[0];
    const titles = officialEvents.filter((event) => event.champion === team);
    const majors = titles.filter((event) => event.category === "major");
    const meta = teamMeta.get(team) || {};
    const validTab = ["overview", "roster", "matches", "events", "achievements"].includes(tab) ? tab : "overview";
    const base = `#time/${encodeURIComponent(team)}`;
    const teamMatches = data.matches.filter((match) => [match.teamA, match.teamB, ...(match.teams || [])].includes(team));
    const roster = latest?.players || [];
    const rosterStrip = roster.length ? roster.map((player) => { const playerData = playerMeta.get(player) || {}; return `<a href="#jogador/${encodeURIComponent(player)}"><span>${playerData.photo ? `<img src="${escapeHtml(playerData.photo)}" alt="${escapeHtml(player)}" />` : escapeHtml(player.slice(0, 2).toUpperCase())}</span><b>${escapeHtml(player)}</b></a>`; }).join("") : `<p>Elenco ainda não cadastrado.</p>`;
    const tabs = `<nav class="team-tabs"><a class="${validTab === "overview" ? "active" : ""}" href="${base}/overview">Visão geral</a><a class="${validTab === "roster" ? "active" : ""}" href="${base}/roster">Elenco</a><a class="${validTab === "matches" ? "active" : ""}" href="${base}/matches">Partidas</a><a class="${validTab === "events" ? "active" : ""}" href="${base}/events">Eventos</a><a class="${validTab === "achievements" ? "active" : ""}" href="${base}/achievements">Conquistas</a></nav>`;
    let body;
    if (validTab === "roster") body = `<section class="team-tab-body"><div class="section-heading"><div><span>FORMAÇÃO MAIS RECENTE</span><h2>${escapeHtml(latest?.event.name || "Elenco")}</h2></div></div><div class="team-roster-list">${rosterStrip}</div></section>`;
    else if (validTab === "matches") body = `<section class="team-tab-body"><div class="section-heading"><div><span>CONFRONTOS</span><h2>Partidas da equipe</h2></div></div>${teamMatches.length ? `<div class="event-matches">${teamMatches.map(matchMarkup).join("")}</div>` : `<div class="empty"><b>Nenhuma partida cadastrada</b>Os resultados não serão deduzidos a partir do campeão dos eventos.</div>`}</section>`;
    else if (validTab === "events") body = `<section class="team-tab-body"><div class="section-heading"><div><span>HISTÓRICO</span><h2>Campeonatos disputados</h2></div></div><div class="career-list">${appearances.map(({ event, players }) => `<article><time>${event.year}</time><div><b><a class="entity-link" href="#campeonato/${encodeURIComponent(event.id)}/overview">${escapeHtml(event.name)}</a></b><span>${players.map((player) => `<a class="entity-link" href="#jogador/${encodeURIComponent(player)}">${escapeHtml(player)}</a>`).join(" · ")}</span></div><em>${event.champion === team ? "CAMPEÃO" : event.status === "ongoing" ? "EM ANDAMENTO" : "PARTICIPANTE"}</em></article>`).join("")}</div></section>`;
    else if (validTab === "achievements") body = `<section class="team-tab-body"><div class="section-heading"><div><span>GALERIA</span><h2>Conquistas da equipe</h2></div></div>${titles.length ? `<div class="team-achievements">${titles.map((event) => `<a class="${event.category === "major" ? "major" : ""}" href="#campeonato/${encodeURIComponent(event.id)}/overview"><i>${event.category === "major" ? "♛" : "★"}</i><span><b>${escapeHtml(event.name)}</b><small>${event.year} · ${categoryLabel(event.category)}</small></span></a>`).join("")}</div>` : `<div class="empty"><b>Nenhum título registrado</b>A equipe ainda não possui conquistas confirmadas.</div>`}</section>`;
    else body = `<section class="team-tab-body"><div class="team-overview-grid"><article><small>PARTICIPAÇÕES</small><b>${appearances.length}</b><p>Edições com escalação registrada.</p></article><article><small>TÍTULOS OFICIAIS</small><b>${titles.length}</b><p>Inclui títulos Major e oficiais.</p></article><article class="major-stat"><small>MAJORS</small><b>${majors.length}</b><p>A conquista especial do HLTPC.</p></article></div><div class="section-heading spaced"><div><span>ÚLTIMA EDIÇÃO</span><h2>${escapeHtml(latest?.event.name || "Sem participação")}</h2></div><a href="${base}/events">Ver histórico →</a></div><div class="team-roster-list compact">${rosterStrip}</div></section>`;
    document.querySelector("#teamProfile").innerHTML = `<a class="profile-back" href="#times">← Voltar aos times</a><section class="team-page"><div class="team-roster-strip">${rosterStrip}</div><header class="team-identity"><div class="entity-mark">${meta.logo ? `<img src="${escapeHtml(meta.logo)}" alt="${escapeHtml(team)}" />` : escapeHtml(team.split(/\s+/).map((part) => part[0]).join("").slice(0, 3))}</div><div><span>ORGANIZAÇÃO HLTPC</span><h1>${escapeHtml(team)}</h1><p>${appearances.length} participação${appearances.length === 1 ? "" : "ões"} · ${titles.length} título${titles.length === 1 ? "" : "s"} oficial${titles.length === 1 ? "" : "is"} · ${majors.length} Major${majors.length === 1 ? "" : "s"}</p></div></header>${tabs}${body}</section>`;
  }

  function matchMarkup(match) {
    const teamA = match.teamA || match.teams?.[0] || "A definir";
    const teamB = match.teamB || match.teams?.[1] || "A definir";
    return `<article class="event-match"><span>${escapeHtml(match.name || match.phase || "Partida")}</span><div><a href="#time/${encodeURIComponent(teamA)}">${escapeHtml(teamA)}</a><b>${escapeHtml(match.score || "—")}</b><a href="#time/${encodeURIComponent(teamB)}">${escapeHtml(teamB)}</a></div><small>${escapeHtml(match.subtitle || match.date || "Data a definir")}</small></article>`;
  }

  function renderTournamentPage(event, tab = "overview") {
    const validTab = ["overview", "matches", "participants"].includes(tab) ? tab : "overview";
    const eventMatches = data.matches.filter((match) => match.tournamentId === event.id);
    const savedEvent = tournamentMeta.get(event.id) || {};
    const base = `#campeonato/${encodeURIComponent(event.id)}`;
    const tabs = `<nav class="event-tabs"><a class="${validTab === "overview" ? "active" : ""}" href="${base}/overview">Visão geral</a><a class="${validTab === "matches" ? "active" : ""}" href="${base}/matches">Partidas</a><a class="${validTab === "participants" ? "active" : ""}" href="${base}/participants">Participantes</a></nav>`;
    let body;
    if (validTab === "matches") body = `<section class="event-tab-body"><div class="section-heading"><div><span>CONFRONTOS</span><h2>Partidas do campeonato</h2></div></div>${eventMatches.length ? `<div class="event-matches">${eventMatches.map(matchMarkup).join("")}</div>` : `<div class="empty"><b>Calendário ainda não divulgado</b>Nenhum confronto foi cadastrado para esta edição. O painel administrativo só publicará partidas confirmadas.</div>`}</section>`;
    else if (validTab === "participants") body = `<section class="event-tab-body"><div class="section-heading"><div><span>ESCALAÇÕES</span><h2>Times participantes</h2></div></div><div class="participant-grid">${event.entries.map((entry) => `<article><a class="participant-team" href="#time/${encodeURIComponent(entry.team)}"><span>${teamBadge(entry.team)}</span><b>${escapeHtml(entry.team)}</b></a><ul>${entry.players.map((player) => `<li><a href="#jogador/${encodeURIComponent(player)}">${escapeHtml(player)}</a></li>`).join("")}</ul></article>`).join("")}</div></section>`;
    else body = `<section class="event-tab-body"><div class="event-overview-grid"><article><small>FORMATO</small><b>${escapeHtml(event.format)}</b><p>${escapeHtml(event.note)}</p></article><article><small>CAMPEÃO</small><b>${escapeHtml(event.champion || "A definir")}</b><p>${event.status === "ongoing" ? "Campeonato em andamento." : "Resultado histórico confirmado."}</p></article><article><small>DADOS DISPONÍVEIS</small><b>${demoLabel(event.demos)}</b><p>${event.demos === "partial" ? "Estatísticas futuras devem ser identificadas como parciais." : "Nenhuma estatística será inventada."}</p></article></div><div class="section-heading spaced"><div><span>RESUMO</span><h2>Participantes confirmados</h2></div><a href="${base}/participants">Ver escalações →</a></div><div class="participant-summary">${event.entries.map((entry) => `<a href="#time/${encodeURIComponent(entry.team)}"><span>${teamBadge(entry.team)}</span><b>${escapeHtml(entry.team)}</b><small>${entry.players.length} jogadores</small></a>`).join("")}</div></section>`;
    document.querySelector("#tournamentPage").innerHTML = `<a class="profile-back" href="#campeonatos">← Voltar aos campeonatos</a><header class="event-hero">${savedEvent.logo ? `<img class="event-logo" src="${escapeHtml(savedEvent.logo)}" alt="" />` : ""}<span>${event.status === "ongoing" ? "EM ANDAMENTO" : "FINALIZADO"}</span><h1>${escapeHtml(event.name)} <b>${event.year}</b></h1><p>${categoryLabel(event.category)} · ${event.entries.length} times</p></header>${tabs}${body}`;
  }

  function navigate() {
    const requested = location.hash.slice(1) || "inicio";
    const [requestedRoute, parameter, detail] = requested.split("/");
    const route = document.querySelector(`[data-view="${CSS.escape(requestedRoute)}"]`) ? requestedRoute : "inicio";
    if (route === "jogador" && parameter) {
      const player = decodeURIComponent(parameter);
      if (playerHistory.has(player)) renderPlayerProfile(player); else location.hash = "jogadores";
    }
    if (route === "time" && parameter) {
      const team = decodeURIComponent(parameter);
      if (teams.has(team)) renderTeamProfile(team, detail); else location.hash = "times";
    }
    if (route === "campeonato" && parameter) {
      const event = data.tournaments.find((item) => item.id === decodeURIComponent(parameter));
      if (event) renderTournamentPage(event, detail); else location.hash = "campeonatos";
    }
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === route));
    const navRoute = ({ jogador: "jogadores", time: "times", campeonato: "campeonatos" })[route] || route;
    document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === navRoute));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  document.querySelector("#playerSearch").addEventListener("input", (event) => renderPlayers(event.target.value));
  document.querySelectorAll("#tournamentFilters button").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("#tournamentFilters button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    renderTournaments(button.dataset.filter);
  }));
  window.addEventListener("hashchange", navigate);

  renderHero();
  renderTicker();
  renderNews();
  renderHomeUpcoming();
  renderRanking();
  renderMatches();
  renderTournaments();
  renderPlayers();
  renderTeams();
  navigate();
})();
