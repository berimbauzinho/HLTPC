(() => {
  "use strict";

  const data = window.HLTPC_DATA;
  const officialEvents = data.tournaments.filter((event) => event.category === "major");
  const playerHistory = new Map(data.players.map((player) => [player, []]));
  const teams = new Map();

  data.tournaments.forEach((event) => {
    event.entries.forEach((entry) => {
      entry.players.forEach((player) => {
        if (!playerHistory.has(player)) playerHistory.set(player, []);
        playerHistory.get(player).push({ event, team: entry.team });
      });

      if (event.category === "resenha") return;
      if (!teams.has(entry.team)) teams.set(entry.team, []);
      teams.get(entry.team).push({ event, players: entry.players });
    });
  });

  const byNewest = (a, b) => b.event.year - a.event.year || b.event.id.localeCompare(a.event.id);
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const formatDate = (value) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  const categoryLabel = (category) => category === "major" ? "Major oficial" : "Campeonato de resenha";
  const demoLabel = (demos) => ({ unavailable: "Sem demo", partial: "Demos parciais", future: "Aguardando campeonato" }[demos] || "Não informado");

  function titleCount(player, category) {
    return data.tournaments.filter((event) => event.category === category && event.champion && event.entries.some((entry) => entry.team === event.champion && entry.players.includes(player))).length;
  }

  function renderHero() {
    const current = data.tournaments.find((event) => event.status === "ongoing");
    const confirmedTeams = current ? current.entries.length : 0;
    document.querySelector("#hero").innerHTML = `
      <article class="hero">
        <div class="hero-content">
          <span class="hero-tag">${current ? "EM ANDAMENTO" : "PRÓXIMA EDIÇÃO"}</span>
          <h1>${escapeHtml(current?.name || "Próximo campeonato")} <span>${current?.year || ""}</span></h1>
          <p>${escapeHtml(current?.note || "Calendário ainda não divulgado.")}</p>
          <div class="hero-meta">
            <div><b>${confirmedTeams}</b><small>times confirmados</small></div>
            <div><b>${current ? current.entries.reduce((sum, entry) => sum + entry.players.length, 0) : 0}</b><small>jogadores</small></div>
            <div><b>${data.matches.length}</b><small>partidas registradas</small></div>
          </div>
        </div>
      </article>`;
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
    document.querySelector("#homeNews").innerHTML = newsMarkup(sorted.slice(0, 3));
    document.querySelector("#news").innerHTML = newsMarkup(sorted);
  }

  function renderRanking() {
    const ranking = data.players
      .map((player) => ({ player, majors: titleCount(player, "major"), resenha: titleCount(player, "resenha") }))
      .sort((a, b) => b.majors - a.majors || b.resenha - a.resenha || a.player.localeCompare(b.player, "pt-BR"))
      .slice(0, 8);
    document.querySelector("#titleRanking").innerHTML = ranking.map((row, index) => `
      <div class="rank-row"><span>${String(index + 1).padStart(2, "0")}</span><b>${escapeHtml(row.player)}</b><em>${row.majors} major${row.majors === 1 ? "" : "s"}</em></div>`).join("");
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
              <ul>${entry.players.map((player) => `<li>${escapeHtml(player)}</li>`).join("")}</ul>
            </div>`).join("")}</div>
          <p class="event-note">${escapeHtml(event.note)}</p>
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
      return `<a class="profile-card player-card" href="#jogador/${encodeURIComponent(player)}">
        <div class="player-card-head"><span>${escapeHtml(player.slice(0, 2).toUpperCase())}</span><div><h3>${escapeHtml(player)}</h3><p class="profile-meta">${history.length} participaç${history.length === 1 ? "ão" : "ões"}</p></div></div>
        <div class="trophies"><div class="trophy-count"><b>${titleCount(player, "major")}</b><small>títulos oficiais</small></div><div class="trophy-count"><b>${titleCount(player, "resenha")}</b><small>títulos de resenha</small></div></div>
        <ul class="history">${history.map(({ event, team }) => `<li><b>${event.year} · ${escapeHtml(team)}</b>${escapeHtml(event.name)}</li>`).join("")}</ul>
      </a>`;
    }).join("");
  }

  function renderPlayerProfile(player) {
    const history = [...(playerHistory.get(player) || [])].sort(byNewest);
    const current = history[0];
    const wins = data.tournaments.filter((event) => event.champion && event.entries.some((entry) => entry.team === event.champion && entry.players.includes(player)));
    const uniqueTeams = [...new Set(history.map((item) => item.team))];
    document.querySelector("#playerProfile").innerHTML = `<a class="profile-back" href="#jogadores">← Voltar aos jogadores</a>
      <article class="player-hero">
        <div class="player-portrait"><span>${escapeHtml(player.slice(0, 2).toUpperCase())}</span><small>PLAYER</small></div>
        <div class="player-summary"><span>PERFIL HLTPC</span><h1>${escapeHtml(player)}</h1><p>Competidor do histórico oficial da turma</p>
          <dl><div><dt>Equipe mais recente</dt><dd>${escapeHtml(current?.team || "Sem equipe")}</dd></div><div><dt>Participações</dt><dd>${history.length}</dd></div><div><dt>Equipes defendidas</dt><dd>${uniqueTeams.length}</dd></div><div><dt>Títulos oficiais</dt><dd>${titleCount(player, "major")}</dd></div></dl>
        </div>
        <div class="player-rating"><small>HLTPC SCORE</small><b>${String(titleCount(player, "major") * 100 + history.length * 10).padStart(3, "0")}</b><span>base histórica</span></div>
      </article>
      <section class="achievement-strip"><header><span>CONQUISTAS</span><b>${wins.length} título${wins.length === 1 ? "" : "s"}</b></header><div>${wins.length ? wins.map((event) => `<article><i>★</i><span><b>${escapeHtml(event.name)}</b><small>${event.year} · ${categoryLabel(event.category)}</small></span></article>`).join("") : `<p>Nenhum título registrado até o momento.</p>`}</div></section>
      <div class="player-detail-grid"><section><div class="section-heading"><div><span>CARREIRA</span><h2>Histórico por campeonato</h2></div></div><div class="career-list">${history.map(({ event, team }) => `<article><time>${event.year}</time><div><b>${escapeHtml(team)}</b><span>${escapeHtml(event.name)}</span></div><em>${event.champion === team ? "CAMPEÃO" : event.status === "ongoing" ? "EM ANDAMENTO" : "PARTICIPANTE"}</em></article>`).join("")}</div></section><aside><div class="section-heading"><div><span>ORGANIZAÇÕES</span><h2>Equipes</h2></div></div><div class="profile-teams">${uniqueTeams.map((team) => `<span>${escapeHtml(team)}</span>`).join("")}</div></aside></div>`;
  }

  function renderTeams() {
    const organizations = [...teams.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
    document.querySelector("#teams").innerHTML = organizations.map(([team, appearances]) => {
      const history = [...appearances].sort(byNewest);
      const titles = officialEvents.filter((event) => event.champion === team).length;
      return `<article class="profile-card">
        <h3>${escapeHtml(team)}</h3><p class="profile-meta">${history.length} participaç${history.length === 1 ? "ão" : "ões"} · ${titles} título${titles === 1 ? "" : "s"}</p>
        <ul class="history">${history.map(({ event, players }) => `<li><b>${event.year} · ${escapeHtml(event.name)}</b>${players.map(escapeHtml).join(" · ")}</li>`).join("")}</ul>
      </article>`;
    }).join("");
  }

  function navigate() {
    const requested = location.hash.slice(1) || "inicio";
    const [requestedRoute, parameter] = requested.split("/");
    const route = document.querySelector(`[data-view="${CSS.escape(requestedRoute)}"]`) ? requestedRoute : "inicio";
    if (route === "jogador" && parameter) {
      const player = decodeURIComponent(parameter);
      if (playerHistory.has(player)) renderPlayerProfile(player); else location.hash = "jogadores";
    }
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === route));
    document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === (route === "jogador" ? "jogadores" : route)));
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
  renderRanking();
  renderMatches();
  renderTournaments();
  renderPlayers();
  renderTeams();
  navigate();
})();
