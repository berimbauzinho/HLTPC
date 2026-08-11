(async () => {
  "use strict";

  const data = window.HLTPC_DATA;
  let shared = {};
  try {
    const response = await fetch("/api/content", { cache: "no-store" });
    if (response.ok) shared = await response.json();
  } catch (_) {}
  const baselineTeamNames = [...new Set(data.tournaments.flatMap((event) => event.entries.map((entry) => entry.team)))];
  const baselineTeamIdByName = new Map(baselineTeamNames.map((name, index) => [name, `team-${index}`]));
  const sharedTeamById = new Map((shared.teams || []).map((team) => [team.id, team]));
  const normalizedTeam = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");
  const sharedTeamIdByName = new Map();
  (shared.teams || []).forEach((team) => {
    const baseline = baselineTeamNames[Number(String(team.id || "").match(/^team-(\d+)$/)?.[1])];
    [team.name, ...(team.aliases || []), baseline].filter(Boolean).forEach((name) => sharedTeamIdByName.set(normalizedTeam(name), team.id));
  });
  const canonicalTeamName = (name, id = "") => sharedTeamById.get(id)?.name || sharedTeamById.get(sharedTeamIdByName.get(normalizedTeam(name)))?.name || name;
  data.tournaments.forEach((event) => {
    event.entries = event.entries.map((entry) => {
      const teamId = entry.teamId || baselineTeamIdByName.get(entry.team) || "";
      return { ...entry, teamId, team: canonicalTeamName(entry.team, teamId) };
    });
    if (event.champion) event.champion = canonicalTeamName(event.champion, event.championId);
  });
  const playerMeta = new Map((shared.players || []).map((item) => [item.name, item]));
  const teamMeta = new Map((shared.teams || []).map((item) => [item.name, item]));
  const tournamentMeta = new Map((shared.tournaments || []).map((item) => [item.id, item]));
  (shared.players || []).forEach((item) => { if (item.name && !data.players.includes(item.name)) data.players.push(item.name); });
  data.tournaments.forEach((event) => {
    const saved = tournamentMeta.get(event.id);
    if (!saved) return;
    if (saved.name) event.name = saved.name;
    if (saved.subtitle && Number(saved.subtitle)) event.year = Number(saved.subtitle);
    if (saved.format && saved.format !== "A definir") event.format = saved.format;
    if (Array.isArray(saved.teams) && saved.teams.length) {
      const historicEntries = new Map(event.entries.map((entry) => [entry.teamId || entry.team, entry]));
      event.entries = saved.teams.map((team, index) => {
        const teamId = saved.teamIds?.[index] || sharedTeamIdByName.get(normalizedTeam(team)) || "";
        const historic = historicEntries.get(teamId) || historicEntries.get(team);
        return { ...(historic || { players: [] }), teamId, team: canonicalTeamName(team, teamId) };
      });
    }
  });
  (shared.tournaments || []).filter((saved) => saved.status === "published" && !data.tournaments.some((event) => event.id === saved.id)).forEach((saved) => {
    data.tournaments.push({
      id: saved.id,
      name: saved.name,
      year: Number(saved.subtitle) || new Date().getFullYear(),
      category: saved.category || "official",
      status: saved.eventStatus || "ongoing",
      champion: saved.champion || null,
      format: saved.format || "Formato a definir",
      demos: "future",
      note: "Estrutura e confrontos publicados pelo painel administrativo.",
      entries: (saved.teams || []).map((team, index) => ({ teamId: saved.teamIds?.[index] || "", team: canonicalTeamName(team, saved.teamIds?.[index]), players: [] }))
    });
  });
  if (Array.isArray(shared.matches)) data.matches = shared.matches.filter((item) => ["published", "scheduled", "live", "finished"].includes(item.status)).map((match) => ({ ...match, teamA: canonicalTeamName(match.teamA, match.teamAId), teamB: canonicalTeamName(match.teamB, match.teamBId), winner: canonicalTeamName(match.winner, match.winnerId) }));
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
  const safeLeetifyUrl = (value) => {
    try { const url = new URL(String(value || "")); return url.protocol === "https:" && /(^|\.)leetify\.com$/i.test(url.hostname) ? url.href : ""; }
    catch (_) { return ""; }
  };
  const safeDriveUrl = (value) => {
    try { const url = new URL(String(value || "")); return url.protocol === "https:" && /(^|\.)drive\.google\.com$/i.test(url.hostname) ? url.href : ""; }
    catch (_) { return ""; }
  };
  const safeScoreboardImage = (value) => /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(String(value || "")) ? String(value) : "";
  const normalizedNick = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");

  function canonicalPublicPlayer(name, steamId = "") {
    const bySteam = [...playerMeta.entries()].find(([, meta]) => steamId && String(meta.steamId || "") === String(steamId));
    if (bySteam) return bySteam[0];
    const normalized = normalizedNick(name);
    const found = data.players.find((player) => {
      const meta = playerMeta.get(player) || {};
      return [player, meta.alias].some((value) => {
        const candidate = normalizedNick(value);
        return candidate && (candidate === normalized || (candidate.length >= 4 && normalized.startsWith(candidate)));
      });
    });
    return found || String(name || "Desconhecido");
  }

  function leetifyId(value) {
    return String(value || "").match(/match-details\/([0-9a-f-]{20,})/i)?.[1] || "";
  }

  function leetifyTeamMap(match, players, event) {
    const roster = (team) => new Set((event?.entries.find((entry) => entry.team === team)?.players || []).map(normalizedNick));
    const rosterA = roster(match.teamA);
    const numbers = [...new Set(players.map((player) => Number(player.initialTeamNumber)).filter(Boolean))];
    const matchesRoster = (number) => players.filter((player) => Number(player.initialTeamNumber) === number).reduce((total, player) => total + (rosterA.has(normalizedNick(canonicalPublicPlayer(player.name, player.steam64Id))) ? 1 : 0), 0);
    const numberA = numbers.sort((a, b) => matchesRoster(b) - matchesRoster(a))[0];
    return { numberA, numberB: numbers.find((number) => number !== numberA) };
  }

  function normalizeLeetifyMatch(match, payload) {
    const event = data.tournaments.find((item) => item.id === match.tournamentId);
    const players = Array.isArray(payload.playerStats) ? payload.playerStats : [];
    const { numberA, numberB } = leetifyTeamMap(match, players, event);
    const teamRounds = (number) => {
      const player = players.find((item) => Number(item.initialTeamNumber) === number);
      return player ? Number(player.ctRoundsWon || 0) + Number(player.tRoundsWon || 0) : 0;
    };
    const scoreA = teamRounds(numberA);
    const scoreB = teamRounds(numberB);
    const rounds = scoreA + scoreB;
    const statistics = players.map((player) => {
      const kills = Number(player.totalKills || 0);
      const deaths = Number(player.totalDeaths || 0);
      const teamNumber = Number(player.initialTeamNumber);
      return {
        steamid: String(player.steam64Id || ""),
        name: canonicalPublicPlayer(player.name, player.steam64Id),
        demoName: String(player.name || ""),
        teamNumber,
        team: teamNumber === numberA ? match.teamA : teamNumber === numberB ? match.teamB : "",
        kills,
        deaths,
        assists: Number(player.totalAssists || 0),
        adr: Number(Number(player.dpr || (rounds ? player.totalDamage / rounds : 0)).toFixed(1)),
        kast: Number((Number(player.kast || 0) * 100).toFixed(1)),
        rating: Number(Number(player.hltvRating || 0).toFixed(2)),
        leetifyRating: Number(Number(player.leetifyRating || 0).toFixed(4)),
        headshots: Math.round(kills * Number(player.hsp || 0)),
        hsPercent: Number((Number(player.hsp || 0) * 100).toFixed(1))
      };
    }).sort((a, b) => b.rating - a.rating || b.kills - a.kills);
    return {
      ...match,
      score: match.score || (scoreA || scoreB ? `${scoreA} - ${scoreB}` : ""),
      winner: match.winner || (scoreA > scoreB ? match.teamA : scoreB > scoreA ? match.teamB : ""),
      statistics,
      statisticsSource: "leetify",
      leetifyInfo: { ...(match.leetifyInfo || {}), matchId: payload.id, finishedAt: payload.finishedAt, mapName: payload.mapName, rounds, scoreA, scoreB, status: payload.status }
    };
  }

  async function fetchLeetifyMatch(match) {
    const matchId = leetifyId(match.leetifyUrl);
    if (!matchId) return match;
    const response = await fetch(`https://api.cs-prod.leetify.com/api/games/${encodeURIComponent(matchId)}`);
    if (!response.ok) throw new Error(`Leetify respondeu ${response.status}`);
    return normalizeLeetifyMatch(match, await response.json());
  }

  function matchSourcesMarkup(match, compact = false) {
    const stats = Array.isArray(match.statistics) ? match.statistics : [];
    const leetifyUrl = safeLeetifyUrl(match.leetifyUrl);
    const demoUrl = safeDriveUrl(match.demoUrl);
    const scoreboardImage = safeScoreboardImage(match.scoreboardImage);
    const demoHasStats = Boolean(match.demoInfo && match.statisticsSource !== "leetify" && stats.length);
    const demoContent = `<b>${demoUrl ? "↗ Demo no Drive" : demoHasStats ? "◉ Demo confirmada" : "◌ Demo anexada"}</b>${compact ? "" : `<small>${demoHasStats ? `${stats.length} jogadores extraídos` : demoUrl ? "Abrir arquivo original" : "Extração automática pendente"}</small>`}`;
    const demo = match.demoInfo || demoUrl ? (demoUrl ? `<a class="match-source ${demoHasStats ? "verified" : "partial"}" href="${escapeHtml(demoUrl)}" target="_blank" rel="noopener noreferrer">${demoContent}</a>` : `<span class="match-source ${demoHasStats ? "verified" : "partial"}">${demoContent}</span>`) : "";
    const leetify = leetifyUrl ? `<a class="match-source verified" href="${escapeHtml(leetifyUrl)}" target="_blank" rel="noopener noreferrer"><b>↗ Leetify</b>${compact ? "" : "<small>Conferir fonte secundária</small>"}</a>` : "";
    const screenshot = scoreboardImage ? `<a class="match-source verified" href="${escapeHtml(scoreboardImage)}" target="_blank" rel="noopener noreferrer"><b>▣ Print do placar</b>${compact ? "" : "<small>Abrir comprovação visual</small>"}</a>` : "";
    const content = `${demo}${leetify}${screenshot}`;
    return content ? `<div class="match-sources ${compact ? "compact" : ""}">${content}</div>` : "";
  }

  function titleCount(player, category) {
    return data.tournaments.filter((event) => event.category === category && event.champion && event.entries.some((entry) => entry.team === event.champion && entry.players.includes(player))).length;
  }

  function officialTitleCount(player) {
    return officialEvents.filter((event) => event.champion && event.entries.some((entry) => entry.team === event.champion && entry.players.includes(player))).length;
  }

  function renderHero() {
    const news = [...data.news].sort((a, b) => b.date.localeCompare(a.date));
    let index = 0;
    let timer = null;
    const draw = () => {
      const item = news[index];
      document.querySelector("#hero").innerHTML = item ? `<article class="hero news-hero" ${item.image ? `style="--hero-image:url('${escapeHtml(item.image)}')"` : ""}>
        <div class="hero-content"><span class="hero-tag">NOTÍCIA EM DESTAQUE</span><h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.summary)}</p><div class="hero-news-meta"><time>${formatDate(item.date)}</time><span>por ${escapeHtml(item.author)}</span><a href="#noticias">Ver todas as notícias →</a></div></div>
        ${news.length > 1 ? `<div class="hero-progress" aria-label="Notícia ${index + 1} de ${news.length}">${news.map((_, dot) => `<button type="button" class="${dot === index ? "active" : ""}" data-hero-index="${dot}" aria-label="Mostrar notícia ${dot + 1}"></button>`).join("")}</div>` : ""}
      </article>` : `<article class="hero"><div class="hero-content"><span class="hero-tag">HLTPC</span><h1>Histórias da turma</h1><p>As notícias publicadas pelo painel administrativo aparecerão aqui.</p></div></article>`;
      document.querySelectorAll("[data-hero-index]").forEach((button) => button.addEventListener("click", () => select(Number(button.dataset.heroIndex))));
    };
    const select = (next) => {
      index = next;
      draw();
      if (timer) window.clearInterval(timer);
      if (news.length > 1) timer = window.setInterval(() => { index = (index + 1) % news.length; draw(); }, 20000);
    };
    draw();
    if (news.length > 1) timer = window.setInterval(() => { index = (index + 1) % news.length; draw(); }, 20000);
  }

  function orderedEventMatches(event) {
    const structural = data.matches.filter((match) => match.tournamentId === event.id && !match.legacyFormat && Number.isFinite(Number(match.order)) && ["group", "semifinal", "final"].includes(match.round));
    return structural.sort((a, b) => Number(a.order) - Number(b.order));
  }

  function nextMatchForEvent(event) {
    return orderedEventMatches(event).find((match) => !match.score && match.teamA && match.teamB && ["published", "scheduled", "live"].includes(match.status));
  }

  function nextSiteMatch() {
    return data.tournaments.filter((event) => event.status === "ongoing").sort((a, b) => b.year - a.year).map(nextMatchForEvent).find(Boolean) || null;
  }

  function matchTimestamp(match) {
    const value = match?.leetifyInfo?.finishedAt || match?.demoInfo?.playedAt || match?.date || "";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : Number(match?.order || 0);
  }

  function latestMatchForEvent(event) {
    return orderedEventMatches(event).filter((match) => match.score).sort((a, b) => matchTimestamp(b) - matchTimestamp(a))[0] || null;
  }

  function renderTicker() {
    const current = data.tournaments.find((event) => event.status === "ongoing");
    const next = current && nextMatchForEvent(current);
    document.querySelector("#tickerText").textContent = current
      ? next ? `${current.name} ${current.year}: próxima partida — ${next.teamA} × ${next.teamB}` : `${current.name} ${current.year}: aguardando definição da próxima fase`
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
    const upcoming = nextSiteMatch();
    document.querySelector("#homeUpcoming").innerHTML = upcoming ? `<div class="event-matches home-match">${matchMarkup(upcoming)}</div>` : `<div class="empty compact"><b>Próxima partida ainda não divulgada</b>Assim que um confronto for publicado no painel, ele aparecerá aqui.</div>`;
  }

  function renderMatches() {
    const upcoming = data.matches.filter((match) => ["scheduled", "live"].includes(match.status));
    const finished = data.matches.filter((match) => match.status === "finished");
    document.querySelector("#upcomingMatches").innerHTML = upcoming.length ? "" : `<div class="empty"><b>Calendário ainda não divulgado</b>O PGL Major Abadia 2026 está em andamento, mas nenhum confronto oficial foi informado.</div>`;
    document.querySelector("#finishedMatches").innerHTML = finished.length ? "" : `<div class="empty"><b>Placares antigos não cadastrados</b>Os campeões e as escalações estão preservados em Campeonatos. Nenhum confronto foi deduzido a partir desses resultados.</div>`;
  }

  function tournamentMarkup(event) {
    return `
      <article class="tournament" data-category="${event.category}">
        <a class="tournament-link" href="#campeonato/${encodeURIComponent(event.id)}/overview">
          <span class="event-year">${event.year}</span>
          <div class="event-main"><h3>${escapeHtml(event.name)}</h3><p>${categoryLabel(event.category)} · ${event.entries.length} times</p></div>
          <span class="event-status ${event.status}">${event.status === "ongoing" ? "EM ANDAMENTO" : "FINALIZADO"}</span>
          <span class="event-enter">Ver campeonato <i>→</i></span>
        </a>
      </article>`;
  }

  function renderTournaments(filter = "all") {
    const filtered = data.tournaments.filter((event) => filter === "all" || event.category === filter).sort((a, b) => b.year - a.year || b.id.localeCompare(a.id));
    document.querySelector("#tournaments").innerHTML = filtered.map(tournamentMarkup).join("");
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
    const teamA = match.teamA || match.teams?.[0] || match.slotA || "A decidir";
    const teamB = match.teamB || match.teams?.[1] || match.slotB || "A decidir";
    const stats = Array.isArray(match.statistics) ? match.statistics : [];
    const teamLink = (team, confirmed) => confirmed && teams.has(team) ? `<a href="#time/${encodeURIComponent(team)}">${escapeHtml(team)}</a>` : `<span class="pending-team">${escapeHtml(team)}</span>`;
    return `<article class="event-match-card clickable-match" data-open-match="${escapeHtml(match.id)}" role="link" tabindex="0"><div class="event-match"><span>${escapeHtml(match.name || match.phase || "Partida")}${match.bestOf ? `<i>MD${match.bestOf}</i>` : ""}</span><div>${teamLink(teamA, Boolean(match.teamA))}<b>${escapeHtml(match.score || "—")}</b>${teamLink(teamB, Boolean(match.teamB))}</div><small>${escapeHtml(match.subtitle || match.date || "Data a definir")}</small></div>${matchSourcesMarkup(match)}${match.demoInfo ? `<details class="demo-analysis"><summary><span>${stats.length ? "◉ Estatísticas disponíveis" : "◌ Extração da demo pendente"}</span><b>${escapeHtml(match.demoInfo.mapName || match.leetifyInfo?.mapName || "Mapa não identificado")} · ${match.demoInfo.rounds || match.leetifyInfo?.rounds || 0} rounds</b></summary>${stats.length ? `<div class="demo-stats"><div class="demo-stats-head"><span>Jogador</span><span>K</span><span>D</span><span>A</span><span>ADR</span><span>HS</span></div>${stats.map((player) => `<div>${playerHistory.has(player.name) ? `<a href="#jogador/${encodeURIComponent(player.name)}">${escapeHtml(player.name)}</a>` : `<strong>${escapeHtml(player.name)}</strong>`}<span>${player.kills}</span><span>${player.deaths}</span><span>${player.assists}</span><span>${player.adr ?? "—"}</span><span>${player.headshots}</span></div>`).join("")}</div>` : `<p>A data da demo foi reconhecida, mas o leitor do navegador não conseguiu extrair os números. Confira o Leetify ou o print do placar, quando disponíveis.</p>`}</details>` : ""}</article>`;
  }

  function groupStandingsMarkup(matches, event) {
    const blankRow = (team) => ({ team, played: 0, wins: 0, losses: 0, roundsFor: 0, roundsAgainst: 0 });
    const table = new Map((event?.entries || []).map((entry) => [entry.team, blankRow(entry.team)]));

    matches.forEach((match) => {
      const teamA = match.teamA;
      const teamB = match.teamB;
      const scores = String(match.score || "").match(/\d+/g)?.map(Number) || [];
      if (!teamA || !teamB || scores.length < 2 || scores[0] === scores[1]) return;
      if (!table.has(teamA)) table.set(teamA, blankRow(teamA));
      if (!table.has(teamB)) table.set(teamB, blankRow(teamB));
      const rowA = table.get(teamA);
      const rowB = table.get(teamB);
      rowA.played += 1;
      rowB.played += 1;
      rowA.roundsFor += scores[0];
      rowA.roundsAgainst += scores[1];
      rowB.roundsFor += scores[1];
      rowB.roundsAgainst += scores[0];
      if (scores[0] > scores[1]) {
        rowA.wins += 1;
        rowB.losses += 1;
      } else {
        rowB.wins += 1;
        rowA.losses += 1;
      }
    });

    const rows = [...table.values()].map((row) => ({ ...row, roundDiff: row.roundsFor - row.roundsAgainst })).sort((a, b) =>
      b.wins - a.wins || b.roundDiff - a.roundDiff || b.roundsFor - a.roundsFor || a.team.localeCompare(b.team, "pt-BR")
    );
    if (!rows.length) return "";
    return `<section class="group-standings"><header><div><span>CLASSIFICAÇÃO</span><h4>Tabela da fase de grupos</h4></div><small>Classificação por campanha · desempate por saldo de rounds</small></header><div class="group-standings-scroll"><div class="group-standings-head"><span>#</span><span>Equipe</span><span title="Jogos / mapas jogados">J</span><span title="Vitórias e derrotas">Campanha</span><span title="Rounds pró">RP</span><span title="Rounds contra">RC</span><span title="Saldo de rounds">SR</span></div>${rows.map((row, index) => `<div class="group-standing-row"><strong>${index + 1}</strong><a href="#time/${encodeURIComponent(row.team)}"><span>${teamBadge(row.team)}</span><b>${escapeHtml(row.team)}</b></a><span>${row.played}</span><strong class="campaign">${row.wins}–${row.losses}</strong><span>${row.roundsFor}</span><span>${row.roundsAgainst}</span><span class="${row.roundDiff > 0 ? "positive" : row.roundDiff < 0 ? "negative" : ""}">${row.roundDiff > 0 ? "+" : ""}${row.roundDiff}</span></div>`).join("")}</div></section>`;
  }

  function eventBracketMarkup(matches, event) {
    const groups = matches.filter((match) => match.round === "group");
    const semifinals = matches.filter((match) => match.round === "semifinal");
    const finals = matches.filter((match) => match.round === "final");
    const stageMatch = (match) => {
      const teamA = match.teamA || match.slotA || "A decidir";
      const teamB = match.teamB || match.slotB || "A decidir";
      const scores = String(match.score || "").match(/\d+/g) || [];
      const teamRow = (team, confirmed, score, side) => `<div class="stage-team ${match.winner === team ? "winner" : ""}"><span>${confirmed && teams.has(team) ? teamBadge(team) : "?"}</span>${confirmed && teams.has(team) ? `<a href="#time/${encodeURIComponent(team)}">${escapeHtml(team)}</a>` : `<b>${escapeHtml(team)}</b>`}<strong>${score ?? (match.score ? "—" : "")}</strong><i>${side}</i></div>`;
      return `<article class="stage-match clickable-match" data-open-match="${escapeHtml(match.id)}" role="link" tabindex="0"><header><time>${escapeHtml(match.subtitle || "Data a definir")}</time><em>MD${match.bestOf || 1}</em></header>${teamRow(teamA, Boolean(match.teamA), scores[0], "A")}${teamRow(teamB, Boolean(match.teamB), scores[1], "B")}<footer><span>${escapeHtml(match.name || "Partida")}</span>${matchSourcesMarkup(match, true) || `<small>${match.score ? "Finalizada" : "Aguardando"}</small>`}</footer></article>`;
    };
    const playoffColumns = [];
    if (semifinals.length) playoffColumns.push(`<section><header><b>Semifinal${semifinals.length > 1 ? "is" : ""}</b><small>${semifinals.length} confronto${semifinals.length > 1 ? "s" : ""}</small></header>${semifinals.map(stageMatch).join("")}</section>`);
    if (finals.length) playoffColumns.push(`<section><header><b>Grande final</b><small>Decisão do título</small></header>${finals.map(stageMatch).join("")}</section>`);
    const playoffs = playoffColumns.length ? `<section class="event-stage-block"><header><div><span>CHAVE</span><h3>Playoffs</h3></div><small>Os classificados avançam da esquerda para a direita</small></header><div class="playoff-bracket ${playoffColumns.length === 1 ? "single" : ""}">${playoffColumns.join(`<i class="stage-arrow">→</i>`)}</div></section>` : "";
    const groupStage = groups.length ? `<section class="event-stage-block"><header><div><span>PRIMEIRA FASE</span><h3>Fase de grupos</h3></div><small>${groups.length} partidas previstas</small></header>${groupStandingsMarkup(groups, event)}<div class="group-match-grid">${groups.map(stageMatch).join("")}</div></section>` : "";
    return `<div class="event-competition">${playoffs}${groupStage}</div>`;
  }

  function tournamentMatchSummary(match, label, emptyText) {
    if (!match) return `<article class="event-overview-match empty-match"><span>${label}</span><b>${emptyText}</b><small>Aguardando atualização do formato.</small></article>`;
    const scores = String(match.score || "").match(/\d+/g) || [];
    const score = scores.length ? `${scores[0]} <i>:</i> ${scores[1]}` : "×";
    return `<article class="event-overview-match clickable-match" data-open-match="${escapeHtml(match.id)}" role="link" tabindex="0"><header><span>${label}</span><time>${escapeHtml(match.subtitle || "Data a definir")}</time></header><div><a href="#time/${encodeURIComponent(match.teamA)}"><span>${teamBadge(match.teamA)}</span><b>${escapeHtml(match.teamA)}</b></a><strong>${score}</strong><a href="#time/${encodeURIComponent(match.teamB)}"><span>${teamBadge(match.teamB)}</span><b>${escapeHtml(match.teamB)}</b></a></div><footer>${escapeHtml(match.name || "Partida")} · MD${match.bestOf || 1}<em>Abrir partida →</em></footer></article>`;
  }

  function renderTournamentPage(event, tab = "overview") {
    const validTab = ["overview", "matches", "statistics"].includes(tab) ? tab : "overview";
    const eventMatches = orderedEventMatches(event);
    const savedEvent = tournamentMeta.get(event.id) || {};
    const base = `#campeonato/${encodeURIComponent(event.id)}`;
    const tabs = `<nav class="event-tabs"><a class="${validTab === "overview" ? "active" : ""}" href="${base}/overview">Visão geral</a><a class="${validTab === "matches" ? "active" : ""}" href="${base}/matches">Partidas</a><a class="${validTab === "statistics" ? "active" : ""}" href="${base}/statistics">Estatísticas</a></nav>`;
    let body;
    if (validTab === "matches") body = `<section class="event-tab-body"><div class="section-heading"><div><span>ESTRUTURA OFICIAL</span><h2>Formato e confrontos</h2></div></div>${eventMatches.length ? eventBracketMarkup(eventMatches, event) : `<div class="empty"><b>Calendário ainda não divulgado</b>Nenhum confronto foi cadastrado para esta edição.</div>`}</section>`;
    else if (validTab === "statistics") body = `<section class="event-tab-body"><div class="section-heading"><div><span>EM PREPARAÇÃO</span><h2>Estatísticas do campeonato</h2></div></div><div class="empty"><b>Esta área será desenvolvida com calma</b>Vamos definir juntos quais rankings, recortes e critérios entram aqui antes de publicar qualquer número.</div></section>`;
    else {
      const completed = eventMatches.filter((match) => match.score);
      const latest = latestMatchForEvent(event);
      const next = nextMatchForEvent(event);
      const relatedNews = data.news.filter((item) => item.tournamentId === event.id).sort((a, b) => b.date.localeCompare(a.date));
      body = `<section class="event-tab-body"><div class="event-retrospective"><article><small>ANDAMENTO</small><b>${completed.length}/${eventMatches.length}</b><p>partidas concluídas</p></article><article><small>PARTICIPANTES</small><b>${event.entries.length}</b><p>times confirmados</p></article><article><small>FORMATO</small><b>${eventMatches.filter((match) => match.round === "group").length ? "Grupos + playoffs" : "Final direta"}</b><p>${escapeHtml(event.status === "ongoing" ? "Campeonato em andamento" : event.champion ? `Campeão: ${event.champion}` : "Edição finalizada")}</p></article></div><div class="section-heading spaced"><div><span>RETROSPECTO</span><h2>Última e próxima partida</h2></div><a href="${base}/matches">Ver todas as partidas →</a></div><div class="event-overview-matches">${tournamentMatchSummary(latest, "ÚLTIMA PARTIDA", "Nenhum resultado registrado")}${tournamentMatchSummary(next, "PRÓXIMA PARTIDA", event.status === "ongoing" ? "Aguardando definição" : "Campeonato finalizado")}</div><div class="section-heading spaced"><div><span>NOTÍCIAS</span><h2>Notícias relacionadas</h2></div></div>${relatedNews.length ? `<div class="news-list event-news">${newsMarkup(relatedNews.slice(0, 4))}</div>` : `<div class="empty compact"><b>Nenhuma notícia relacionada</b>As notícias vinculadas a este campeonato aparecerão aqui.</div>`}<div class="section-heading spaced"><div><span>PARTICIPANTES</span><h2>Times e escalações</h2></div></div><div class="participant-grid">${event.entries.map((entry) => `<article><a class="participant-team" href="#time/${encodeURIComponent(entry.team)}"><span>${teamBadge(entry.team)}</span><b>${escapeHtml(entry.team)}</b></a><ul>${entry.players.map((player) => `<li><a href="#jogador/${encodeURIComponent(player)}">${escapeHtml(player)}</a></li>`).join("")}</ul></article>`).join("")}</div></section>`;
    }
    document.querySelector("#tournamentPage").innerHTML = `<a class="profile-back" href="#campeonatos">← Voltar aos campeonatos</a><header class="event-hero">${savedEvent.logo ? `<img class="event-logo" src="${escapeHtml(savedEvent.logo)}" alt="" />` : ""}<span>${event.status === "ongoing" ? "EM ANDAMENTO" : "FINALIZADO"}</span><h1>${escapeHtml(event.name)} <b>${event.year}</b></h1><p>${categoryLabel(event.category)} · ${event.entries.length} times</p></header>${tabs}${body}`;
  }

  const mapLabel = (value) => ({ de_inferno: "Inferno", de_mirage: "Mirage", de_nuke: "Nuke", de_anubis: "Anubis", de_ancient: "Ancient", de_dust2: "Dust II", de_vertigo: "Vertigo", de_overpass: "Overpass", de_train: "Train", de_cache: "Cache" }[String(value || "").toLowerCase()] || String(value || "Mapa a definir").replace(/^de_/, ""));
  const teamLogoMarkup = (team) => `<span class="match-team-logo">${teamBadge(team)}</span>`;
  const ratingTone = (rating) => Number(rating) >= 1.1 ? "high" : Number(rating) < .9 ? "low" : "mid";

  function matchStatsTable(team, stats) {
    const rows = stats.filter((player) => player.team === team);
    if (!rows.length) return "";
    return `<section class="match-stat-team"><header>${teamLogoMarkup(team)}<a href="#time/${encodeURIComponent(team)}">${escapeHtml(team)}</a><span>${rows.length} jogadores</span></header><div class="match-stat-head"><span>Jogador</span><span>K-D</span><span>+/-</span><span>ADR</span><span>KAST</span><span>Rating</span></div>${rows.map((player) => {
      const difference = Number(player.kills || 0) - Number(player.deaths || 0);
      const known = playerHistory.has(player.name);
      return `<div class="match-stat-row"><span>${known ? `<a href="#jogador/${encodeURIComponent(player.name)}">${escapeHtml(player.name)}</a>` : `<b>${escapeHtml(player.demoName || player.name)}</b>`}${player.demoName && player.demoName !== player.name ? `<small>jogou como ${escapeHtml(player.demoName)}</small>` : ""}</span><span>${player.kills}-${player.deaths}</span><span class="${difference > 0 ? "positive" : difference < 0 ? "negative" : ""}">${difference > 0 ? "+" : ""}${difference}</span><span>${player.adr ?? "—"}</span><span>${player.kast != null ? `${player.kast}%` : "—"}</span><strong class="${ratingTone(player.rating)}">${player.rating || "—"}</strong></div>`;
    }).join("")}</section>`;
  }

  function matchLineup(team, event, stats) {
    const roster = event?.entries.find((entry) => entry.team === team)?.players || stats.filter((player) => player.team === team).map((player) => player.name);
    return `<section class="match-lineup"><header>${teamLogoMarkup(team)}<a href="#time/${encodeURIComponent(team)}">${escapeHtml(team)}</a></header><div>${roster.map((player) => {
      const meta = playerMeta.get(player) || {};
      return `<a href="#jogador/${encodeURIComponent(player)}"><span>${meta.photo ? `<img src="${escapeHtml(meta.photo)}" alt="" />` : escapeHtml(player.slice(0, 2).toUpperCase())}</span><b>${escapeHtml(player)}</b></a>`;
    }).join("")}</div></section>`;
  }

  function drawMatchPage(match, options = {}) {
    const event = data.tournaments.find((item) => item.id === match.tournamentId);
    const teamA = match.teamA || match.slotA || "A decidir";
    const teamB = match.teamB || match.slotB || "A decidir";
    const stats = Array.isArray(match.statistics) ? match.statistics : [];
    const scores = String(match.score || "").match(/\d+/g) || [];
    const mapName = mapLabel(match.leetifyInfo?.mapName || match.demoInfo?.mapName);
    const leetifyUrl = safeLeetifyUrl(match.leetifyUrl);
    const scoreboardImage = safeScoreboardImage(match.scoreboardImage);
    const mvp = [...stats].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || Number(b.kills || 0) - Number(a.kills || 0))[0];
    const mvpMeta = mvp && playerMeta.get(mvp.name) || {};
    const sourceLabel = match.statisticsSource === "leetify" ? `Leetify${match.statisticsStatus === "partial" ? " · parcial" : ""}` : match.statisticsSource === "demo" ? "Demo" : "Aguardando extração";
    const back = event ? `#campeonato/${encodeURIComponent(event.id)}/matches` : "#campeonatos";
    const statsBody = stats.length ? `${matchStatsTable(teamA, stats)}${matchStatsTable(teamB, stats)}` : `<div class="match-loading"><b>${options.loading ? "Buscando os números no Leetify…" : "Estatísticas ainda não disponíveis"}</b><span>${options.error ? escapeHtml(options.error) : "A demo e as fontes continuam anexadas à partida."}</span></div>`;
    document.querySelector("#matchPage").innerHTML = `<a class="profile-back" href="${back}">← Voltar ao campeonato</a><article class="match-detail-page"><header class="match-detail-hero"><a class="match-event-link" href="#campeonato/${encodeURIComponent(event?.id || "")}/overview">${escapeHtml(event?.name || "Campeonato HLTPC")} ${event?.year || ""}</a><div class="match-detail-team team-a">${teamLogoMarkup(teamA)}<a href="#time/${encodeURIComponent(teamA)}">${escapeHtml(teamA)}</a></div><div class="match-detail-score"><time>${escapeHtml(match.subtitle || "Data a definir")}</time><strong>${scores.length ? `${scores[0]} <i>:</i> ${scores[1]}` : "VS"}</strong><span>${escapeHtml(match.name || "Partida")} · MD${match.bestOf || 1}</span></div><div class="match-detail-team team-b">${teamLogoMarkup(teamB)}<a href="#time/${encodeURIComponent(teamB)}">${escapeHtml(teamB)}</a></div></header><nav class="match-detail-tabs"><span class="active">Overview</span><a href="#campeonato/${encodeURIComponent(event?.id || "")}/matches">Campeonato</a></nav><div class="match-detail-grid"><section class="match-map-panel"><header><span>MAPA</span><b>${escapeHtml(mapName)}</b></header><div><a href="#time/${encodeURIComponent(teamA)}">${escapeHtml(teamA)}</a><strong>${scores[0] ?? "—"}</strong></div><div><a href="#time/${encodeURIComponent(teamB)}">${escapeHtml(teamB)}</a><strong>${scores[1] ?? "—"}</strong></div><small>${match.leetifyInfo?.rounds || match.demoInfo?.rounds || 0} rounds registrados</small></section><section class="match-proof-panel"><header><span>FONTES</span><b>Conferência dos dados</b></header>${matchSourcesMarkup(match)}${match.evidenceNote ? `<p class="match-evidence-note">${escapeHtml(match.evidenceNote)}</p>` : ""}${scoreboardImage ? `<a class="scoreboard-evidence" href="${escapeHtml(scoreboardImage)}" target="_blank" rel="noopener"><img src="${escapeHtml(scoreboardImage)}" alt="Print do placar final" /><span>Abrir print do placar ↗</span></a>` : ""}${leetifyUrl ? `<a class="external-source" href="${escapeHtml(leetifyUrl)}" target="_blank" rel="noopener">Abrir partida no Leetify ↗</a>` : ""}</section></div><section class="match-stats-section"><header><div><span>DESEMPENHO</span><h2>Estatísticas da partida</h2></div><small>Fonte: ${sourceLabel}</small></header>${statsBody}</section>${stats.length ? `<section class="match-lineups-section"><header><span>ESCALAÇÕES</span><h2>Lineups</h2></header><div>${matchLineup(teamA, event, stats)}${matchLineup(teamB, event, stats)}</div></section>` : ""}${mvp ? `<section class="match-mvp"><div class="match-mvp-photo">${mvpMeta.photo ? `<img src="${escapeHtml(mvpMeta.photo)}" alt="" />` : escapeHtml((mvp.name || "MVP").slice(0, 2).toUpperCase())}</div><div><span>DESTAQUE DA PARTIDA</span><h2>${playerHistory.has(mvp.name) ? `<a href="#jogador/${encodeURIComponent(mvp.name)}">${escapeHtml(mvp.name)}</a>` : escapeHtml(mvp.demoName || mvp.name)}</h2><p>${mvp.kills}-${mvp.deaths} · ${mvp.adr} ADR · ${mvp.kast}% KAST</p></div><strong>${mvp.rating}<small>Rating</small></strong></section>` : ""}</article>`;
  }

  let matchRenderToken = 0;
  async function renderMatchPage(match) {
    const token = ++matchRenderToken;
    const shouldFetch = !Array.isArray(match.statistics) || !match.statistics.length;
    drawMatchPage(match, { loading: shouldFetch && Boolean(leetifyId(match.leetifyUrl)) });
    if (!shouldFetch || !leetifyId(match.leetifyUrl)) return;
    try {
      const enriched = await fetchLeetifyMatch(match);
      Object.assign(match, enriched);
      if (token === matchRenderToken) drawMatchPage(match);
    } catch (reason) {
      if (token === matchRenderToken) drawMatchPage(match, { error: `Não foi possível consultar o Leetify: ${reason.message}` });
    }
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
      const requestedTeam = decodeURIComponent(parameter);
      const team = canonicalTeamName(requestedTeam);
      if (teams.has(team)) {
        if (team !== requestedTeam) location.hash = `time/${encodeURIComponent(team)}/${detail || "overview"}`;
        else renderTeamProfile(team, detail);
      } else location.hash = "times";
    }
    if (route === "campeonato" && parameter) {
      const event = data.tournaments.find((item) => item.id === decodeURIComponent(parameter));
      if (event) renderTournamentPage(event, detail); else location.hash = "campeonatos";
    }
    if (route === "partida" && parameter) {
      const match = data.matches.find((item) => item.id === decodeURIComponent(parameter));
      if (match) renderMatchPage(match); else location.hash = "campeonatos";
    }
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === route));
    const navRoute = ({ jogador: "jogadores", time: "times", campeonato: "campeonatos", partida: "campeonatos" })[route] || route;
    document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === navRoute));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  document.querySelector("#playerSearch").addEventListener("input", (event) => renderPlayers(event.target.value));
  document.addEventListener("click", (event) => {
    const card = event.target.closest("[data-open-match]");
    if (!card || event.target.closest("a,button,summary")) return;
    location.hash = `partida/${encodeURIComponent(card.dataset.openMatch)}/overview`;
  });
  document.addEventListener("keydown", (event) => {
    const card = event.target.closest("[data-open-match]");
    if (!card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    location.hash = `partida/${encodeURIComponent(card.dataset.openMatch)}/overview`;
  });
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
