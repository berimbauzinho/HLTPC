(async () => {
  "use strict";

  const data = window.HLTPC_DATA;
  if (window.HLTPC_FAVICON || window.HLTPC_LOGO) {
    document.querySelectorAll("[data-hltpc-mark]").forEach((image) => { image.src = window.HLTPC_FAVICON || window.HLTPC_LOGO; });
    const icon = document.querySelector("#siteIcon");
    if (icon) icon.href = window.HLTPC_FAVICON || window.HLTPC_LOGO;
  }
  let shared = {};
  try {
    const response = await fetch("/api/content", { cache: "no-store" });
    if (response.ok) shared = await response.json();
  } catch (_) {}
  const historicalImport2025 = window.HLTPC_IMPORT_2025;
  if (historicalImport2025) {
    const mergeVersioned = (currentItems, importedItems, versionKey) => {
      const merged = new Map((currentItems || []).map((item) => [item.id, item]));
      (importedItems || []).forEach((imported) => {
        const current = merged.get(imported.id);
        const currentVersion = Number(current?.[versionKey] || current?.importVersion || 0);
        if (!current || currentVersion < Number(historicalImport2025.version || 1)) merged.set(imported.id, { ...(current || {}), ...imported });
      });
      return [...merged.values()];
    };
    shared.players = mergeVersioned(shared.players, historicalImport2025.players, "identityImportVersion");
    shared.matches = mergeVersioned(shared.matches, historicalImport2025.matches, "importVersion");
  }
  const confirmedPlayerIdentities = [
    { name: "cuavila", steamId: "76561199001115634", aliases: ["MANO CHORIS", "KMKZ | MANO CHORIS"] },
    { name: "Cuazzi", steamId: "76561198359845217", aliases: ["Voulin Raba", "cuallen", "cualy", "KMKZ | cuallen"] }
  ];
  const identityNick = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");
  const identityBySteam = new Map(confirmedPlayerIdentities.map((identity) => [identity.steamId, identity]));
  (shared.players || []).forEach((player) => {
    const identity = confirmedPlayerIdentities.find((candidate) => identityNick(candidate.name) === identityNick(player.name));
    if (!identity) return;
    const reservedAliases = new Set(confirmedPlayerIdentities.flatMap((candidate) => candidate === identity ? [] : candidate.aliases).map(identityNick));
    const retained = [...(player.aliases || []), ...String(player.alias || "").split(/[,;|]/)].map((alias) => String(alias || "").trim()).filter((alias) => alias && !reservedAliases.has(identityNick(alias)));
    player.steamId = identity.steamId;
    player.aliases = [...new Set([...retained, ...identity.aliases])];
    player.alias = player.aliases.join(", ");
  });
  (shared.matches || []).forEach((match) => {
    const correct = (player) => {
      const identity = identityBySteam.get(String(player.steamid || player.steam64Id || "").trim());
      return identity ? { ...player, name: identity.name } : player;
    };
    if (Array.isArray(match.statistics)) match.statistics = match.statistics.map(correct);
    (match.maps || []).forEach((map) => { if (Array.isArray(map.statistics)) map.statistics = map.statistics.map(correct); });
  });
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
  if (Array.isArray(shared.news) && shared.news.length) data.news = shared.news.filter((item) => item.status === "published").map((item) => ({ id: item.id, title: item.name, summary: item.subtitle, body: item.body || item.subtitle, author: item.author || "HLTPC", date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") ? item.date : new Date().toISOString().slice(0, 10), tournamentId: item.tournamentId || null, image: item.image || "" }));
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
  const entityInitials = (value, fallback = "HLT") => String(value || fallback).replace(/gaming|e-sports/ig, "").trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  const mediaImage = (src, alt, fallback, className = "") => src ? `<img ${className ? `class="${className}"` : ""} data-media-image src="${escapeHtml(src)}" alt="${escapeHtml(alt || "")}" /><b class="media-image-fallback" hidden>${escapeHtml(fallback)}</b>` : `<b class="media-image-fallback">${escapeHtml(fallback)}</b>`;
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-media-image]")) return;
    image.hidden = true;
    if (image.nextElementSibling?.classList.contains("media-image-fallback")) image.nextElementSibling.hidden = false;
  }, true);
  const formatDate = (value) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  const categoryLabel = (category) => ({ major: "Major", official: "Campeonato oficial", resenha: "Campeonato de resenha" }[category] || "Campeonato");
  const awardDetails = {
    mvp: { label: "MVP", icon: "★", className: "mvp" },
    crowd: { label: "Craque da galera", icon: "♥", className: "crowd" },
    bagre: { label: "Troféu Bagre", icon: "♟", className: "bagre" }
  };
  const demoLabel = (demos) => ({ unavailable: "Sem demo", partial: "Demos parciais", future: "Aguardando campeonato" }[demos] || "Não informado");
  const teamBadge = (team) => { const meta = teamMeta.get(team) || {}; const fallback = (meta.acronym || entityInitials(team)).toUpperCase(); return mediaImage(meta.logo, `Logo de ${team}`, fallback); };
  const safeLeetifyUrl = (value) => {
    try { const url = new URL(String(value || "")); return url.protocol === "https:" && /(^|\.)leetify\.com$/i.test(url.hostname) ? url.href : ""; }
    catch (_) { return ""; }
  };
  const safeDriveUrl = (value) => {
    try { const url = new URL(String(value || "")); return url.protocol === "https:" && /(^|\.)drive\.google\.com$/i.test(url.hostname) ? url.href : ""; }
    catch (_) { return ""; }
  };
  const safeScoreboardImage = (value) => {
    const raw = String(value || "");
    return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(raw) || /^\/api\/media\/[0-9a-f-]{36}$/i.test(raw) ? raw : "";
  };
  const normalizedNick = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");
  const confirmedPlayerAliases = new Map([
    ["GJota", ["GJ"]],
    ["Downey", ["Mikasa es su kasa"]],
    ["190", ["fraquinho"]],
    ["cuavila", ["MANO CHORIS", "KMKZ | MANO CHORIS"]],
    ["Cuazzi", ["Voulin Raba", "cuallen", "cualy", "KMKZ | cuallen"]]
  ]);

  function publicPlayerNames(name) {
    const meta = playerMeta.get(name) || {};
    const aliases = [
      ...(Array.isArray(meta.aliases) ? meta.aliases : []),
      ...String(meta.alias || "").split(/[,;|]/),
      ...(confirmedPlayerAliases.get(name) || [])
    ];
    return [...new Set([name, ...aliases].map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function canonicalPublicPlayer(name, steamId = "") {
    const id = String(steamId || "").trim();
    const bySteam = [...playerMeta.entries()].find(([, meta]) => id && String(meta.steamId || "").trim() === id);
    if (bySteam) return bySteam[0];
    const normalized = normalizedNick(name);
    const confirmed = [...confirmedPlayerAliases.entries()].find(([, aliases]) => aliases.some((alias) => normalizedNick(alias) === normalized))?.[0];
    if (confirmed) return confirmed;
    const found = data.players.find((player) => publicPlayerNames(player).some((value) => normalizedNick(value) === normalized));
    return found || String(name || "Desconhecido");
  }

  function leetifyId(value) {
    return String(value || "").match(/match-details\/([0-9a-f-]{20,})/i)?.[1] || "";
  }

  function leetifyTeamMap(match, players, event) {
    const roster = (team, teamId) => {
      const entry = event?.entries.find((candidate) => teamId && candidate.teamId === teamId) || event?.entries.find((candidate) => normalizedTeam(candidate.team) === normalizedTeam(team));
      const names = new Set();
      const steamIds = new Set();
      (entry?.players || []).forEach((player) => {
        publicPlayerNames(player).forEach((alias) => names.add(normalizedNick(alias)));
        const steamId = String(playerMeta.get(player)?.steamId || "").trim();
        if (steamId) steamIds.add(steamId);
      });
      return { names, steamIds };
    };
    const rosterA = roster(match.teamA, match.teamAId);
    const rosterB = roster(match.teamB, match.teamBId);
    const numbers = [...new Set(players.map((player) => Number(player.initialTeamNumber)).filter(Boolean))];
    if (numbers.length !== 2) throw new Error("O Leetify não retornou exatamente dois times");
    const identityScore = (player, target) => {
      const steamId = String(player.steam64Id || "").trim();
      if (steamId && target.steamIds.has(steamId)) return 100;
      return target.names.has(normalizedNick(canonicalPublicPlayer(player.name, steamId))) ? 5 : 0;
    };
    const groupScore = (number, target) => players.filter((player) => Number(player.initialTeamNumber) === number).reduce((total, player) => total + identityScore(player, target), 0);
    const [first, second] = numbers;
    const forward = groupScore(first, rosterA) + groupScore(second, rosterB);
    const reverse = groupScore(first, rosterB) + groupScore(second, rosterA);
    if (!forward && !reverse) throw new Error("Não foi possível relacionar os jogadores do Leetify às escalações do campeonato. Cadastre os SteamID64 no painel.");
    if (forward === reverse) throw new Error("A identificação dos times ficou ambígua. Confira os SteamID64 das escalações.");
    const numberA = forward > reverse ? first : second;
    return { numberA, numberB: forward > reverse ? second : first, confidence: Math.abs(forward - reverse), matchedBySteamId: players.filter((player) => {
      const steamId = String(player.steam64Id || "").trim();
      return steamId && (rosterA.steamIds.has(steamId) || rosterB.steamIds.has(steamId));
    }).length };
  }

  function normalizeLeetifyMatch(match, payload) {
    const event = data.tournaments.find((item) => item.id === match.tournamentId);
    const players = Array.isArray(payload.playerStats) ? payload.playerStats : [];
    const { numberA, numberB, confidence, matchedBySteamId } = leetifyTeamMap(match, players, event);
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
      score: match.resultSource === "manual" && match.score ? match.score : scoreA || scoreB ? `${scoreA} - ${scoreB}` : "",
      winner: match.resultSource === "manual" && match.winner ? match.winner : scoreA > scoreB ? match.teamA : scoreB > scoreA ? match.teamB : "",
      statistics,
      statisticsSource: "leetify",
      leetifyInfo: { ...(match.leetifyInfo || {}), matchId: payload.id, finishedAt: payload.finishedAt, mapName: payload.mapName, rounds, scoreA, scoreB, status: payload.status, teamMapping: { numberA, numberB, confidence, matchedBySteamId } }
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
    if (Array.isArray(match.maps) && match.maps.length) {
      const available = match.maps.filter((map) => safeDriveUrl(map.demoUrl) || safeLeetifyUrl(map.leetifyUrl));
      if (compact) return available.length ? `<div class="match-sources compact"><span class="match-source verified"><b>◉ ${available.length}/${match.maps.length} mapas com fonte</b></span></div>` : "";
      const sources = match.maps.map((map, index) => {
        const label = escapeHtml(map.name || mapLabel(map.mapName) || `Mapa ${index + 1}`);
        const demoUrl = safeDriveUrl(map.demoUrl);
        const leetifyUrl = safeLeetifyUrl(map.leetifyUrl);
        if (!demoUrl && !leetifyUrl) return `<span class="match-source partial"><b>${label}</b><small>Sem arquivo · confirmação manual pendente</small></span>`;
        return `${demoUrl ? `<a class="match-source verified" href="${escapeHtml(demoUrl)}" target="_blank" rel="noopener noreferrer"><b>↗ Demo · ${label}</b><small>Abrir arquivo original</small></a>` : ""}${leetifyUrl ? `<a class="match-source verified" href="${escapeHtml(leetifyUrl)}" target="_blank" rel="noopener noreferrer"><b>↗ Leetify · ${label}</b><small>Conferir estatísticas do mapa</small></a>` : ""}`;
      }).join("");
      return `<div class="match-sources series-sources">${sources}</div>`;
    }
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
    const news = [...data.news].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    let index = 0;
    let timer = null;
    const draw = () => {
      const item = news[index];
      document.querySelector("#hero").innerHTML = item ? `<article class="hero news-hero ${item.image ? "has-image" : ""}">
        ${item.image ? `<a class="news-hero-art" href="#noticia/${encodeURIComponent(item.id)}" aria-label="Ler ${escapeHtml(item.title)}"><img src="${escapeHtml(item.image)}" alt="" /></a>` : ""}
        <div class="hero-content"><span class="hero-tag">ÚLTIMAS NOTÍCIAS</span><h1><a href="#noticia/${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a></h1><p>${escapeHtml(item.summary)}</p><div class="hero-news-meta"><time>${formatDate(item.date)}</time><span>por ${escapeHtml(item.author)}</span><a href="#noticia/${encodeURIComponent(item.id)}">Ler notícia completa →</a><a class="hero-history-link" href="#noticias">Histórico</a></div></div>
        ${news.length > 1 ? `<div class="hero-progress" aria-label="Notícia ${index + 1} de ${news.length}">${news.map((_, dot) => `<button type="button" class="${dot === index ? "active" : ""}" data-hero-index="${dot}" aria-label="Mostrar notícia ${dot + 1}"></button>`).join("")}</div>` : ""}
      </article>` : `<article class="hero"><div class="hero-content"><span class="hero-tag">HLTPC</span><h1>A Plataforma Oficial do <span>TAMPICOUNTERS</span></h1><p>Campeonatos, equipes, jogadores e partidas reunidos em um só lugar.</p></div></article>`;
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
    const mapTimestamps = (match?.maps || []).flatMap((map) => [map?.leetifyInfo?.finishedAt, map?.demoInfo?.playedAt]).map((value) => Date.parse(value || "")).filter(Number.isFinite);
    if (mapTimestamps.length) return Math.max(...mapTimestamps);
    const value = match?.leetifyInfo?.finishedAt || match?.demoInfo?.playedAt || match?.date || "";
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
    const brazilianDate = String(match?.subtitle || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (brazilianDate) return Date.UTC(Number(brazilianDate[3]), Number(brazilianDate[2]) - 1, Number(brazilianDate[1])) + Number(match?.order || 0);
    return Number(match?.order || 0);
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
      <a class="news-item" href="#noticia/${encodeURIComponent(item.id)}">
        ${item.image ? `<span class="news-thumb"><img src="${escapeHtml(item.image)}" alt="" /></span>` : ""}
        <time class="news-date">${formatDate(item.date)}</time>
        <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)} · por ${escapeHtml(item.author)}</p></div>
        <span>›</span>
      </a>`).join("");
  }

  function renderNews() {
    const sorted = [...data.news].sort((a, b) => b.date.localeCompare(a.date));
    const homeNews = document.querySelector("#homeNews");
    if (homeNews) homeNews.innerHTML = newsMarkup(sorted.slice(0, 3));
    document.querySelector("#news").innerHTML = newsMarkup(sorted);
  }

  function renderRanking() {
    const ranking = data.players
      .map((player) => ({ player, official: officialTitleCount(player), majors: titleCount(player, "major") }))
      .sort((a, b) => b.official - a.official || b.majors - a.majors || a.player.localeCompare(b.player, "pt-BR"))
      .slice(0, 8);
    document.querySelector("#titleRanking").innerHTML = ranking.map((row, index) => {
      const meta = playerMeta.get(row.player) || {};
      return `<div class="rank-row"><span>${String(index + 1).padStart(2, "0")}</span><i class="rank-avatar">${meta.photo ? `<img src="${escapeHtml(meta.photo)}" alt="${escapeHtml(row.player)}" />` : `<b>${escapeHtml(row.player.slice(0, 2).toUpperCase())}</b>`}</i><b>${escapeHtml(row.player)}<small>${row.majors} Major${row.majors === 1 ? "" : "s"}</small></b><em>${row.official} título${row.official === 1 ? "" : "s"}</em></div>`;
    }).join("");
  }

  function renderHomeUpcoming() {
    const upcoming = nextSiteMatch();
    document.querySelector("#homeUpcoming").innerHTML = upcoming ? `<div class="event-matches home-match">${matchMarkup(upcoming)}</div>` : `<div class="empty compact"><b>Próxima partida ainda não divulgada</b>Assim que um confronto for publicado no painel, ele aparecerá aqui.</div>`;
  }

  function renderTeamPowerRanking() {
    const candidates = [...data.tournaments].sort((a, b) => (b.status === "ongoing") - (a.status === "ongoing") || b.year - a.year || b.id.localeCompare(a.id));
    const event = candidates.find((candidate) => orderedEventMatches(candidate).some((match) => match.score)) || candidates[0];
    const target = document.querySelector("#teamPowerRanking");
    const context = document.querySelector("#teamPowerContext");
    if (!target || !event) return;
    const matches = orderedEventMatches(event).filter((match) => match.score && match.teamA && match.teamB);
    const blank = (team) => ({ team, played: 0, wins: 0, weightedPlayed: 0, weightedWins: 0, roundsFor: 0, roundsAgainst: 0, playoff: 0 });
    const rows = new Map(event.entries.map((entry) => [entry.team, blank(entry.team)]));
    const stageWeight = (round) => round === "final" ? 1.5 : round === "semifinal" ? 1.25 : 1;
    const addRounds = (rowA, rowB, first, second) => {
      rowA.roundsFor += first; rowA.roundsAgainst += second;
      rowB.roundsFor += second; rowB.roundsAgainst += first;
    };
    matches.forEach((match) => {
      if (!rows.has(match.teamA)) rows.set(match.teamA, blank(match.teamA));
      if (!rows.has(match.teamB)) rows.set(match.teamB, blank(match.teamB));
      const rowA = rows.get(match.teamA);
      const rowB = rows.get(match.teamB);
      const score = String(match.score).match(/\d+/g)?.map(Number) || [];
      if (score.length < 2 || score[0] === score[1]) return;
      const weight = stageWeight(match.round);
      rowA.played += 1; rowB.played += 1;
      rowA.weightedPlayed += weight; rowB.weightedPlayed += weight;
      const winner = score[0] > score[1] ? rowA : rowB;
      winner.wins += 1; winner.weightedWins += weight;
      if (match.round === "final") winner.playoff = Math.max(winner.playoff, 1);
      else if (match.round === "semifinal") winner.playoff = Math.max(winner.playoff, .78);
      const maps = (match.maps || []).map((map) => String(map.score || "").match(/\d+/g)?.map(Number)).filter((mapScore) => mapScore?.length >= 2);
      if (maps.length) maps.forEach(([first, second]) => addRounds(rowA, rowB, first, second));
      else if (Number(match.bestOf || 1) === 1) addRounds(rowA, rowB, score[0], score[1]);
    });
    const orderedGroup = [...rows.values()].sort((a, b) => b.wins - a.wins || (b.roundsFor - b.roundsAgainst) - (a.roundsFor - a.roundsAgainst) || b.roundsFor - a.roundsFor || a.team.localeCompare(b.team, "pt-BR"));
    orderedGroup.forEach((row, index) => { row.campaign = orderedGroup.length === 1 ? 1 : .35 + .4 * ((orderedGroup.length - 1 - index) / (orderedGroup.length - 1)); });
    const ranked = [...rows.values()].map((row) => {
      const form = row.weightedPlayed ? row.weightedWins / row.weightedPlayed : 0;
      const roundShare = row.roundsFor + row.roundsAgainst ? row.roundsFor / (row.roundsFor + row.roundsAgainst) : .5;
      const campaign = Math.max(row.campaign || 0, row.playoff || 0);
      return { ...row, raw: .55 * form + .25 * roundShare + .2 * campaign };
    }).sort((a, b) => b.raw - a.raw || (b.roundsFor - b.roundsAgainst) - (a.roundsFor - a.roundsAgainst) || a.team.localeCompare(b.team, "pt-BR"));
    const ceiling = ranked[0]?.raw || 1;
    context.textContent = `${event.name} ${event.year} · forma 55% · rounds 25% · campanha 20%`;
    target.innerHTML = ranked.map((row, index) => {
      const score = Math.round((row.raw / ceiling) * 1000);
      const balance = row.roundsFor - row.roundsAgainst;
      return `<a class="team-power-row" href="#time/${encodeURIComponent(row.team)}"><span>${String(index + 1).padStart(2, "0")}</span><i>${teamBadge(row.team)}</i><b>${escapeHtml(row.team)}<small>${row.wins}–${Math.max(0, row.played - row.wins)} · saldo ${balance > 0 ? "+" : ""}${balance}</small></b><strong>${score}<small>pontos</small></strong></a>`;
    }).join("");
  }

  function renderMatches() {
    const upcoming = data.matches.filter((match) => ["scheduled", "live"].includes(match.status));
    const finished = data.matches.filter((match) => match.status === "finished");
    document.querySelector("#upcomingMatches").innerHTML = upcoming.length ? "" : `<div class="empty"><b>Calendário ainda não divulgado</b>O PGL Major Abadia 2026 está em andamento, mas nenhum confronto oficial foi informado.</div>`;
    document.querySelector("#finishedMatches").innerHTML = finished.length ? "" : `<div class="empty"><b>Placares antigos não cadastrados</b>Os campeões e as escalações estão preservados em Campeonatos. Nenhum confronto foi deduzido a partir desses resultados.</div>`;
  }

  function tournamentMarkup(event) {
    const saved = tournamentMeta.get(event.id) || {};
    const fallback = event.name.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]).join("").toUpperCase();
    return `
      <article class="tournament" data-category="${event.category}">
        <a class="tournament-link" href="#campeonato/${encodeURIComponent(event.id)}/overview">
          <span class="event-list-brand">${mediaImage(saved.logo, `Logo de ${event.name}`, fallback)}</span>
          <div class="event-main"><h3>${escapeHtml(event.name)}</h3><p>${categoryLabel(event.category)} · ${event.entries.length} times</p></div>
          <span class="event-status ${event.status}">${event.status === "ongoing" ? "EM ANDAMENTO" : "FINALIZADO"}</span>
          <time class="event-year">${event.year}</time>
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
      const latest = history[0];
      return `<a class="player-directory-card ${meta.photo ? "has-photo" : "without-photo"}" href="#jogador/${encodeURIComponent(player)}" aria-label="Abrir perfil de ${escapeHtml(player)}">
        <div class="player-directory-copy"><span>PLAYER HLTPC</span><h3>${escapeHtml(player)}</h3><div><b>${latest ? escapeHtml(latest.team) : "Sem equipe recente"}</b><small>${history.length} participaç${history.length === 1 ? "ão" : "ões"} · ${officialTitleCount(player)} título${officialTitleCount(player) === 1 ? "" : "s"}</small></div></div>
        <div class="player-directory-portrait">${meta.photo ? `<img src="${escapeHtml(meta.photo)}" alt="${escapeHtml(player)}" />` : `<strong>${escapeHtml(player.slice(0, 2).toUpperCase())}</strong>`}</div>
        <i>Ver perfil →</i>
      </a>`;
    }).join("");
  }

  function renderPlayerProfile(player) {
    const history = [...(playerHistory.get(player) || [])].sort(byNewest);
    const current = history[0];
    const meta = playerMeta.get(player) || {};
    const wins = data.tournaments.filter((event) => event.champion && event.entries.some((entry) => entry.team === event.champion && entry.players.includes(player)));
    const awards = (Array.isArray(meta.awards) ? meta.awards : []).map((award) => ({ award, event: data.tournaments.find((candidate) => candidate.id === award.tournamentId), details: awardDetails[award.type] || awardDetails.mvp })).filter((item) => item.event);
    const uniqueTeams = [...new Set([...history.map((item) => item.team), ...(meta.teams || [])])];
    document.querySelector("#playerProfile").innerHTML = `<a class="profile-back" href="#jogadores">← Voltar aos jogadores</a>
      <article class="player-hero">
        <div class="player-portrait">${meta.photo ? `<img src="${escapeHtml(meta.photo)}" alt="${escapeHtml(player)}" />` : `<span>${escapeHtml(player.slice(0, 2).toUpperCase())}</span>`}<small>PLAYER</small></div>
        <div class="player-summary"><span>PERFIL HLTPC</span><h1>${escapeHtml(player)}</h1><p>Competidor do histórico oficial da turma</p>
          <dl><div><dt>Equipe mais recente</dt><dd>${current ? `<a class="entity-link" href="#time/${encodeURIComponent(current.team)}">${escapeHtml(current.team)}</a>` : "Sem equipe"}</dd></div><div><dt>Participações</dt><dd>${history.length}</dd></div><div><dt>Títulos oficiais</dt><dd>${officialTitleCount(player)}</dd></div><div><dt>Majors conquistados</dt><dd>${titleCount(player, "major")}</dd></div></dl>
        </div>
        <div class="player-rating major-rating"><small>MAJORS</small><b>${titleCount(player, "major")}</b><span>conquistados</span></div>
      </article>
      ${awards.length ? `<section class="achievement-strip individual-awards"><header><span>PRÊMIOS INDIVIDUAIS</span><b>${awards.length} reconhecimento${awards.length === 1 ? "" : "s"}</b></header><div>${awards.map(({ event, details }) => `<a class="individual-award ${details.className} ${event.category === "major" ? "major-award" : ""}" href="#campeonato/${encodeURIComponent(event.id)}/overview"><i>${details.icon}</i><span><b>${escapeHtml(details.label)}${details.className === "mvp" && event.category === "major" ? " MAJOR" : ""}</b><small>${escapeHtml(event.name)} · ${event.year}</small></span></a>`).join("")}</div></section>` : ""}
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
        <div class="team-card-head"><span>${teamBadge(team)}</span><div><h3>${escapeHtml(team)}</h3><p class="profile-meta">${history.length} participaç${history.length === 1 ? "ão" : "ões"} · ${titles} título${titles === 1 ? "" : "s"}</p></div></div>
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
    document.querySelector("#teamProfile").innerHTML = `<a class="profile-back" href="#times">← Voltar aos times</a><section class="team-page"><div class="team-roster-strip">${rosterStrip}</div><header class="team-identity"><div class="entity-mark">${teamBadge(team)}</div><div><span>ORGANIZAÇÃO HLTPC</span><h1>${escapeHtml(team)}</h1><p>${appearances.length} participação${appearances.length === 1 ? "" : "ões"} · ${titles.length} título${titles.length === 1 ? "" : "s"} oficial${titles.length === 1 ? "" : "is"} · ${majors.length} Major${majors.length === 1 ? "" : "s"}</p></div></header>${tabs}${body}</section>`;
  }

  function matchMarkup(match) {
    const teamA = match.teamA || match.teams?.[0] || match.slotA || "A decidir";
    const teamB = match.teamB || match.teams?.[1] || match.slotB || "A decidir";
    const stats = Array.isArray(match.statistics) ? match.statistics : [];
    const teamLink = (team, confirmed) => confirmed && teams.has(team) ? `<a class="event-team-identity" href="#time/${encodeURIComponent(team)}"><span>${teamBadge(team)}</span><strong>${escapeHtml(team)}</strong></a>` : `<span class="pending-team">${escapeHtml(team)}</span>`;
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
      const teamRow = (team, confirmed, score, side) => `<div class="stage-team ${match.winner === team ? "winner" : ""}"><span>${confirmed && teams.has(team) ? teamBadge(team) : "?"}</span>${confirmed && teams.has(team) ? `<a class="stage-team-name" href="#time/${encodeURIComponent(team)}">${escapeHtml(team)}</a>` : `<b>${escapeHtml(team)}</b>`}<strong>${score ?? (match.score ? "—" : "")}</strong><i>${side}</i></div>`;
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
    const matchName = match.name || "Partida";
    const descriptor = /\bMD\d\b/i.test(matchName) ? matchName : `${matchName} · MD${match.bestOf || 1}`;
    return `<article class="event-overview-match clickable-match" data-open-match="${escapeHtml(match.id)}" role="link" tabindex="0"><header><span>${label}</span><time>${escapeHtml(match.subtitle || "Data a definir")}</time></header><div><a href="#time/${encodeURIComponent(match.teamA)}"><span>${teamBadge(match.teamA)}</span><b>${escapeHtml(match.teamA)}</b></a><strong>${score}</strong><a href="#time/${encodeURIComponent(match.teamB)}"><span>${teamBadge(match.teamB)}</span><b>${escapeHtml(match.teamB)}</b></a></div><footer>${escapeHtml(descriptor)}<em>Abrir partida →</em></footer></article>`;
  }

  const numberOrZero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const parsedScore = (value) => {
    const scores = String(value || "").match(/\d+/g)?.map(Number) || [];
    return scores.length >= 2 ? scores.slice(0, 2) : [];
  };

  function statisticalSlices(match) {
    const maps = (match.maps || []).filter((map) => Array.isArray(map.statistics) && map.statistics.length);
    if (maps.length) return maps.map((map) => {
      const score = parsedScore(map.score);
      const rounds = numberOrZero(map.rounds || map.demoInfo?.rounds || map.leetifyInfo?.rounds) || (score.length ? score[0] + score[1] : 0);
      return { statistics: map.statistics, rounds };
    });
    const score = parsedScore(match.score);
    const rounds = numberOrZero(match.demoInfo?.rounds || match.leetifyInfo?.rounds) || (Number(match.bestOf || 1) === 1 && score.length ? score[0] + score[1] : 0);
    return Array.isArray(match.statistics) && match.statistics.length ? [{ statistics: match.statistics, rounds }] : [];
  }

  function tournamentPlayerStatistics(matches) {
    const players = new Map();
    matches.forEach((match) => statisticalSlices(match).forEach((slice) => slice.statistics.forEach((record) => {
      const name = canonicalPublicPlayer(record.name || record.demoName, record.steamid || record.steam64Id);
      const key = `${name}::${record.team || ""}`;
      if (!players.has(key)) players.set(key, { name, team: record.team || "Sem equipe", matchIds: new Set(), kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, hits: 0, headHits: 0, utilityDamage: 0, openingKills: 0, openingDeaths: 0, multiKill2: 0, multiKill3: 0, multiKill4: 0, multiKill5: 0, rounds: 0, kastTotal: 0, kastRounds: 0, ratingTotal: 0, ratingRounds: 0 });
      const row = players.get(key);
      const rounds = slice.rounds || numberOrZero(record.rounds);
      row.matchIds.add(match.id);
      row.kills += numberOrZero(record.kills);
      row.deaths += numberOrZero(record.deaths);
      row.assists += numberOrZero(record.assists);
      row.headshots += numberOrZero(record.headshots);
      row.hits += numberOrZero(record.hits);
      row.headHits += numberOrZero(record.headHits);
      row.utilityDamage += numberOrZero(record.utilityDamage);
      row.openingKills += numberOrZero(record.openingKills);
      row.openingDeaths += numberOrZero(record.openingDeaths);
      row.multiKill2 += numberOrZero(record.multiKill2);
      row.multiKill3 += numberOrZero(record.multiKill3);
      row.multiKill4 += numberOrZero(record.multiKill4);
      row.multiKill5 += numberOrZero(record.multiKill5);
      row.rounds += rounds;
      row.damage += numberOrZero(record.damage) || (numberOrZero(record.adr) * rounds);
      if (numberOrZero(record.kast) > 0 && rounds) { row.kastTotal += numberOrZero(record.kast) * rounds; row.kastRounds += rounds; }
      if (numberOrZero(record.rating) > 0) { const weight = rounds || 1; row.ratingTotal += numberOrZero(record.rating) * weight; row.ratingRounds += weight; }
    })));
    return [...players.values()].map((row) => ({
      ...row,
      matches: row.matchIds.size,
      adr: row.rounds ? row.damage / row.rounds : 0,
      hs: row.kills ? (row.headshots / row.kills) * 100 : 0,
      kd: row.deaths ? row.kills / row.deaths : row.kills,
      kpr: row.rounds ? row.kills / row.rounds : 0,
      dpr: row.rounds ? row.deaths / row.rounds : 0,
      apr: row.rounds ? row.assists / row.rounds : 0,
      headAccuracy: row.hits ? (row.headHits / row.hits) * 100 : null,
      openingSuccess: row.openingKills + row.openingDeaths ? (row.openingKills / (row.openingKills + row.openingDeaths)) * 100 : null,
      kast: row.kastRounds ? row.kastTotal / row.kastRounds : null,
      rating: row.ratingRounds ? row.ratingTotal / row.ratingRounds : 0
    })).sort((a, b) => b.rating - a.rating || (b.kills - b.deaths) - (a.kills - a.deaths) || b.kills - a.kills);
  }

  function tournamentTeamStatistics(event, matches) {
    const participating = matches.length ? [...new Set(matches.flatMap((match) => [match.teamA, match.teamB]).filter(Boolean))] : event.entries.map((entry) => entry.team);
    const rows = new Map(participating.map((team) => [team, { team, series: 0, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, roundsFor: 0, roundsAgainst: 0, kills: 0, deaths: 0, assists: 0, damage: 0, playerRounds: 0, ratingTotal: 0, ratingRounds: 0 }]));
    const ensure = (team) => {
      if (!rows.has(team)) rows.set(team, { team, series: 0, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, roundsFor: 0, roundsAgainst: 0, kills: 0, deaths: 0, assists: 0, damage: 0, playerRounds: 0, ratingTotal: 0, ratingRounds: 0 });
      return rows.get(team);
    };
    matches.forEach((match) => {
      const teamA = ensure(match.teamA);
      const teamB = ensure(match.teamB);
      const seriesScore = parsedScore(match.score);
      if (seriesScore.length) {
        teamA.series += 1; teamB.series += 1;
        if (seriesScore[0] > seriesScore[1]) { teamA.wins += 1; teamB.losses += 1; }
        else if (seriesScore[1] > seriesScore[0]) { teamB.wins += 1; teamA.losses += 1; }
      }
      const mapScores = (match.maps || []).map((map) => parsedScore(map.score)).filter((score) => score.length);
      if (!mapScores.length && Number(match.bestOf || 1) === 1 && seriesScore.length) mapScores.push(seriesScore);
      mapScores.forEach(([scoreA, scoreB]) => {
        teamA.roundsFor += scoreA; teamA.roundsAgainst += scoreB;
        teamB.roundsFor += scoreB; teamB.roundsAgainst += scoreA;
        if (scoreA > scoreB) { teamA.mapsWon += 1; teamB.mapsLost += 1; }
        else if (scoreB > scoreA) { teamB.mapsWon += 1; teamA.mapsLost += 1; }
      });
      statisticalSlices(match).forEach((slice) => slice.statistics.forEach((record) => {
        const team = ensure(record.team || "Sem equipe");
        team.kills += numberOrZero(record.kills);
        team.deaths += numberOrZero(record.deaths);
        team.assists += numberOrZero(record.assists);
        const playerRounds = slice.rounds || numberOrZero(record.rounds);
        team.playerRounds += playerRounds;
        team.damage += numberOrZero(record.damage) || numberOrZero(record.adr) * playerRounds;
        if (numberOrZero(record.rating) > 0) { const weight = playerRounds || 1; team.ratingTotal += numberOrZero(record.rating) * weight; team.ratingRounds += weight; }
      }));
    });
    return [...rows.values()].map((row) => ({ ...row, roundDiff: row.roundsFor - row.roundsAgainst, kdDiff: row.kills - row.deaths, adr: row.playerRounds ? row.damage / row.playerRounds : 0, rating: row.ratingRounds ? row.ratingTotal / row.ratingRounds : 0 })).sort((a, b) => b.wins - a.wins || b.roundDiff - a.roundDiff || b.mapsWon - a.mapsWon || a.team.localeCompare(b.team, "pt-BR"));
  }

  function playerComparisonMarkup(rows) {
    if (rows.length < 2) return `<div class="empty compact"><b>Comparação indisponível</b>São necessários dados de pelo menos dois jogadores neste recorte.</div>`;
    const options = rows.map((row, index) => `<option value="${index}">${escapeHtml(row.name)} · ${escapeHtml(row.team)}</option>`).join("");
    return `<section class="player-comparison"><header><div><span>DASHBOARD HLTPC</span><h3>Jogador contra jogador</h3></div><small>Cada cartão coloca os dois jogadores lado a lado, na mesma escala daquela métrica.</small></header><div class="comparison-selectors"><label>Jogador A<select id="comparisonPlayerA">${options}</select></label><b>×</b><label>Jogador B<select id="comparisonPlayerB">${options}</select></label></div><div class="comparison-identities" id="comparisonIdentities"></div><div class="comparison-chart" id="playerComparisonChart"></div></section>`;
  }

  function playerHighlightsMarkup(rows) {
    if (!rows.length) return "";
    const byAdr = [...rows].sort((a, b) => b.adr - a.adr)[0];
    const byDiff = [...rows].sort((a, b) => (b.kills - b.deaths) - (a.kills - a.deaths))[0];
    const cards = [
      { label: "MAIOR RATING", row: rows[0], value: rows[0].rating ? rows[0].rating.toFixed(2) : "—" },
      { label: "MAIOR ADR", row: byAdr, value: byAdr.adr ? byAdr.adr.toFixed(1) : "—" },
      { label: "MELHOR SALDO", row: byDiff, value: `${byDiff.kills - byDiff.deaths > 0 ? "+" : ""}${byDiff.kills - byDiff.deaths}` }
    ];
    return `<div class="statistics-highlights">${cards.map(({ label, row, value }) => `<article><span>${label}</span><b>${escapeHtml(value)}</b><a href="#jogador/${encodeURIComponent(row.name)}">${escapeHtml(row.name)}</a><small>${escapeHtml(row.team)}</small></article>`).join("")}</div>`;
  }

  function bindPlayerComparison(rows) {
    const selectA = document.querySelector("#comparisonPlayerA");
    const selectB = document.querySelector("#comparisonPlayerB");
    const chart = document.querySelector("#playerComparisonChart");
    if (!selectA || !selectB || !chart || rows.length < 2) return;
    if (chart.dataset.bound === "true") return;
    chart.dataset.bound = "true";
    if (selectA.value === selectB.value) selectB.value = "1";
    const metrics = [
      { label: "Rating", key: "rating", max: 2, digits: 2 },
      { label: "ADR", key: "adr", max: 140, digits: 1 },
      { label: "K/D", key: "kd", max: 2.5, digits: 2 },
      { label: "Kills / round", key: "kpr", max: 1.2, digits: 2 },
      { label: "Assist. / round", key: "apr", max: .6, digits: 2 },
      { label: "Mortes / round ↓", key: "dpr", max: 1.1, digits: 2 },
      { label: "KAST", key: "kast", max: 100, digits: 1, suffix: "%" },
      { label: "Headshots", key: "hs", max: 100, digits: 1, suffix: "%" }
    ];
    if (rows.some((row) => row.headAccuracy !== null)) metrics.push({ label: "Precisão na cabeça", key: "headAccuracy", max: 100, digits: 1, suffix: "%", nullable: true });
    if (rows.some((row) => row.openingSuccess !== null)) metrics.push({ label: "Opening duels", key: "openingSuccess", max: 100, digits: 1, suffix: "%", nullable: true });
    const render = () => {
      if (selectA.value === selectB.value) selectB.value = selectA.value === "0" ? "1" : "0";
      const first = rows[Number(selectA.value)] || rows[0];
      const second = rows[Number(selectB.value)] || rows[1];
      const identities = document.querySelector("#comparisonIdentities");
      if (identities) identities.innerHTML = [
        { row: first, side: "a", label: "JOGADOR A" },
        { row: second, side: "b", label: "JOGADOR B" }
      ].map(({ row, side, label }) => { const meta = playerMeta.get(row.name) || {}; return `<article class="comparison-identity player-${side}"><span>${mediaImage(meta.photo, row.name, entityInitials(row.name))}</span><div><small>${label}</small><b>${escapeHtml(row.name)}</b><em>${escapeHtml(row.team)}</em></div></article>`; }).join("");
      chart.innerHTML = metrics.map((metric) => {
        const valueA = (metric.key === "kast" && first.kast === null) || (metric.nullable && first[metric.key] === null) ? null : numberOrZero(first[metric.key]);
        const valueB = (metric.key === "kast" && second.kast === null) || (metric.nullable && second[metric.key] === null) ? null : numberOrZero(second[metric.key]);
        const heightA = valueA === null ? 0 : Math.max(3, Math.min(100, (valueA / metric.max) * 100));
        const heightB = valueB === null ? 0 : Math.max(3, Math.min(100, (valueB / metric.max) * 100));
        const formatted = (value) => value === null ? "—" : `${value.toFixed(metric.digits)}${metric.suffix || ""}`;
        return `<article class="comparison-metric"><b>${metric.label}</b><div class="comparison-columns"><div class="comparison-column player-a"><strong>${formatted(valueA)}</strong><i style="height:${heightA}%"></i><small>A</small></div><div class="comparison-column player-b"><strong>${formatted(valueB)}</strong><i style="height:${heightB}%"></i><small>B</small></div></div></article>`;
      }).join("");
    };
    selectA.addEventListener("change", render);
    selectB.addEventListener("change", render);
    render();
  }

  function tournamentStatisticsContent(event, matches) {
    const playerRows = tournamentPlayerStatistics(matches);
    const teamRows = tournamentTeamStatistics(event, matches);
    const signed = (value) => `${value > 0 ? "+" : ""}${value}`;
    const playerTable = playerRows.length ? `${playerHighlightsMarkup(playerRows)}${playerComparisonMarkup(playerRows)}<div class="section-heading compact-heading"><div><span>DETALHAMENTO</span><h3>Todos os jogadores</h3></div></div><div class="tournament-stats-scroll"><div class="tournament-stats-table player-stats-table"><header><span>Jogador</span><span>J</span><span>R</span><span>K–D</span><span>A</span><span>+/−</span><span>K/D</span><span>K/R</span><span>D/R</span><span>Dano</span><span>ADR</span><span>HS%</span><span>KAST</span><span>Rating</span></header>${playerRows.map((row, index) => `<div><span class="stats-player"><i>${String(index + 1).padStart(2, "0")}</i><b>${playerHistory.has(row.name) ? `<a href="#jogador/${encodeURIComponent(row.name)}">${escapeHtml(row.name)}</a>` : escapeHtml(row.name)}<small>${teams.has(row.team) ? `<a href="#time/${encodeURIComponent(row.team)}">${escapeHtml(row.team)}</a>` : escapeHtml(row.team)}</small></b></span><span>${row.matches}</span><span>${row.rounds || "—"}</span><strong>${row.kills}–${row.deaths}</strong><span>${row.assists}</span><span class="${row.kills - row.deaths > 0 ? "positive" : row.kills - row.deaths < 0 ? "negative" : ""}">${signed(row.kills - row.deaths)}</span><span>${row.kd.toFixed(2)}</span><span>${row.rounds ? row.kpr.toFixed(2) : "—"}</span><span>${row.rounds ? row.dpr.toFixed(2) : "—"}</span><span>${row.damage ? Math.round(row.damage).toLocaleString("pt-BR") : "—"}</span><span>${row.rounds ? row.adr.toFixed(1) : "—"}</span><span>${row.kills ? `${row.hs.toFixed(1)}%` : "—"}</span><span>${row.kast === null ? "—" : `${row.kast.toFixed(1)}%`}</span><strong class="rating ${ratingTone(row.rating)}">${row.rating ? row.rating.toFixed(2) : "—"}</strong></div>`).join("")}</div></div>` : `<div class="empty compact"><b>Sem estatísticas individuais neste recorte</b>O placar continua válido, mas nenhuma fonte anexada retornou dados de jogadores.</div>`;
    const teamTable = `<div class="tournament-stats-scroll"><div class="tournament-stats-table team-stats-table"><header><span>Equipe</span><span>Séries</span><span>Campanha</span><span>Mapas</span><span>Rounds</span><span>SR</span><span>K–D–A</span><span>ADR</span><span>Rating</span></header>${teamRows.map((row, index) => `<div><span class="stats-team"><i>${String(index + 1).padStart(2, "0")}</i><span>${teamBadge(row.team)}</span><b><a href="#time/${encodeURIComponent(row.team)}">${escapeHtml(row.team)}</a></b></span><span>${row.series}</span><strong>${row.wins}–${row.losses}</strong><span>${row.mapsWon}–${row.mapsLost}</span><span>${row.roundsFor}–${row.roundsAgainst}</span><span class="${row.roundDiff > 0 ? "positive" : row.roundDiff < 0 ? "negative" : ""}">${signed(row.roundDiff)}</span><span>${row.kills || row.deaths ? `${row.kills}–${row.deaths}–${row.assists}` : "—"}</span><span>${row.adr ? row.adr.toFixed(1) : "—"}</span><strong class="rating ${ratingTone(row.rating)}">${row.rating ? row.rating.toFixed(2) : "—"}</strong></div>`).join("")}</div></div>`;
    return `<div class="tournament-stats-panels"><section data-statistics-panel="players">${playerTable}</section><section data-statistics-panel="teams" hidden>${teamTable}</section></div>`;
  }

  function tournamentStatisticsMarkup(event, matches) {
    const completed = matches.filter((match) => match.score || statisticalSlices(match).length);
    const options = completed.map((match) => `<option value="${escapeHtml(match.id)}">${escapeHtml(match.name || "Partida")} · ${escapeHtml(match.teamA)} × ${escapeHtml(match.teamB)}</option>`).join("");
    return `<section class="event-tab-body tournament-statistics"><div class="section-heading"><div><span>DADOS CONFIRMADOS</span><h2>Estatísticas do campeonato</h2></div></div><div class="tournament-stats-toolbar"><label>Recorte<select id="tournamentStatsMatch"><option value="">Campeonato completo</option>${options}</select></label><div class="tournament-stats-switch" role="tablist"><button class="active" type="button" data-statistics-view="players">Por jogador</button><button type="button" data-statistics-view="teams">Por time</button></div></div><p class="tournament-stats-note">Somente números disponíveis nas fontes anexadas. “—” indica dado não retornado; nenhum valor é estimado.</p><div id="tournamentStatsContent">${tournamentStatisticsContent(event, completed)}</div></section>`;
  }

  function bindTournamentStatistics(event, matches) {
    const select = document.querySelector("#tournamentStatsMatch");
    const target = document.querySelector("#tournamentStatsContent");
    let view = "players";
    const applyView = () => {
      document.querySelectorAll("[data-statistics-view]").forEach((button) => button.classList.toggle("active", button.dataset.statisticsView === view));
      target?.querySelectorAll("[data-statistics-panel]").forEach((panel) => { panel.hidden = panel.dataset.statisticsPanel !== view; });
      if (view === "players") bindPlayerComparison(tournamentPlayerStatistics(select?.value ? matches.filter((match) => match.id === select.value) : matches.filter((match) => match.score || statisticalSlices(match).length)));
    };
    const refresh = () => {
      const selected = select?.value ? matches.filter((match) => match.id === select.value) : matches.filter((match) => match.score || statisticalSlices(match).length);
      if (target) target.innerHTML = tournamentStatisticsContent(event, selected);
      applyView();
    };
    document.querySelectorAll("[data-statistics-view]").forEach((button) => button.addEventListener("click", () => { view = button.dataset.statisticsView; applyView(); }));
    select?.addEventListener("change", refresh);
    applyView();
  }

  function renderTournamentPage(event, tab = "overview") {
    const validTab = ["overview", "matches", "statistics"].includes(tab) ? tab : "overview";
    const eventMatches = orderedEventMatches(event);
    const savedEvent = tournamentMeta.get(event.id) || {};
    const base = `#campeonato/${encodeURIComponent(event.id)}`;
    const tabs = `<nav class="event-tabs"><a class="${validTab === "overview" ? "active" : ""}" href="${base}/overview">Visão geral</a><a class="${validTab === "matches" ? "active" : ""}" href="${base}/matches">Partidas</a><a class="${validTab === "statistics" ? "active" : ""}" href="${base}/statistics">Estatísticas</a></nav>`;
    let body;
    if (validTab === "matches") body = `<section class="event-tab-body"><div class="section-heading"><div><span>ESTRUTURA OFICIAL</span><h2>Formato e confrontos</h2></div></div>${eventMatches.length ? eventBracketMarkup(eventMatches, event) : `<div class="empty"><b>Calendário ainda não divulgado</b>Nenhum confronto foi cadastrado para esta edição.</div>`}</section>`;
    else if (validTab === "statistics") body = tournamentStatisticsMarkup(event, eventMatches);
    else {
      const completed = eventMatches.filter((match) => match.score);
      const latest = latestMatchForEvent(event);
      const next = nextMatchForEvent(event);
      const relatedNews = data.news.filter((item) => item.tournamentId === event.id).sort((a, b) => b.date.localeCompare(a.date));
      body = `<section class="event-tab-body"><div class="event-retrospective"><article><small>ANDAMENTO</small><b>${completed.length}/${eventMatches.length}</b><p>partidas concluídas</p></article><article><small>PARTICIPANTES</small><b>${event.entries.length}</b><p>times confirmados</p></article><article><small>FORMATO</small><b>${eventMatches.filter((match) => match.round === "group").length ? "Grupos + playoffs" : "Final direta"}</b><p>${escapeHtml(event.status === "ongoing" ? "Campeonato em andamento" : event.champion ? `Campeão: ${event.champion}` : "Edição finalizada")}</p></article></div><div class="section-heading spaced"><div><span>RETROSPECTO</span><h2>Última e próxima partida</h2></div><a href="${base}/matches">Ver todas as partidas →</a></div><div class="event-overview-matches">${tournamentMatchSummary(latest, "ÚLTIMA PARTIDA", "Nenhum resultado registrado")}${tournamentMatchSummary(next, "PRÓXIMA PARTIDA", event.status === "ongoing" ? "Aguardando definição" : "Campeonato finalizado")}</div><div class="section-heading spaced"><div><span>NOTÍCIAS</span><h2>Notícias relacionadas</h2></div></div>${relatedNews.length ? `<div class="news-list event-news">${newsMarkup(relatedNews.slice(0, 4))}</div>` : `<div class="empty compact"><b>Nenhuma notícia relacionada</b>As notícias vinculadas a este campeonato aparecerão aqui.</div>`}<div class="section-heading spaced"><div><span>PARTICIPANTES</span><h2>Times e escalações</h2></div></div><div class="participant-grid">${event.entries.map((entry) => `<article><a class="participant-team" href="#time/${encodeURIComponent(entry.team)}"><span>${teamBadge(entry.team)}</span><b>${escapeHtml(entry.team)}</b></a><ul>${entry.players.map((player) => `<li><a href="#jogador/${encodeURIComponent(player)}">${escapeHtml(player)}</a></li>`).join("")}</ul></article>`).join("")}</div></section>`;
    }
    const eventFallback = entityInitials(event.name);
    document.querySelector("#tournamentPage").innerHTML = `<a class="profile-back" href="#campeonatos">← Voltar aos campeonatos</a><header class="event-hero"><div class="event-brand-art">${mediaImage(savedEvent.logo, `Logo de ${event.name}`, eventFallback, "event-logo")}</div><span>${event.status === "ongoing" ? "EM ANDAMENTO" : "FINALIZADO"}</span><h1>${escapeHtml(event.name)} <b>${event.year}</b></h1><p>${categoryLabel(event.category)} · ${event.entries.length} times</p></header>${tabs}${body}`;
    if (validTab === "statistics") bindTournamentStatistics(event, eventMatches);
  }

  function renderNewsPage(item) {
    const event = item.tournamentId ? data.tournaments.find((candidate) => candidate.id === item.tournamentId) : null;
    const eventLogo = event ? tournamentMeta.get(event.id)?.logo : "";
    const body = String(item.body || item.summary || "").split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`).join("");
    document.querySelector("#newsPage").innerHTML = `<a class="profile-back" href="#noticias">← Voltar às notícias</a><article class="news-detail-page"><header class="news-detail-header">${event ? `<a class="news-event-chip" href="#campeonato/${encodeURIComponent(event.id)}/overview">${eventLogo ? `<img src="${escapeHtml(eventLogo)}" alt="" />` : ""}<span>${escapeHtml(event.name)} <b>${event.year}</b></span></a>` : `<span class="news-detail-kicker">NOTÍCIA HLTPC</span>`}<h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.summary)}</p><div><span>por <b>${escapeHtml(item.author)}</b></span><time>${formatDate(item.date)}</time></div></header>${item.image ? `<figure class="news-detail-image"><img src="${escapeHtml(item.image)}" alt="Imagem de ${escapeHtml(item.title)}" /></figure>` : ""}<div class="news-detail-body">${body || `<p>${escapeHtml(item.summary)}</p>`}</div>${event ? `<footer><span>CAMPEONATO RELACIONADO</span><a href="#campeonato/${encodeURIComponent(event.id)}/overview">${escapeHtml(event.name)} ${event.year} →</a></footer>` : ""}</article>`;
  }

  const mapLabel = (value) => ({ de_inferno: "Inferno", de_mirage: "Mirage", de_nuke: "Nuke", de_anubis: "Anubis", de_ancient: "Ancient", de_dust2: "Dust II", de_vertigo: "Vertigo", de_overpass: "Overpass", de_train: "Train", de_cache: "Cache" }[String(value || "").toLowerCase()] || String(value || "Mapa a definir").replace(/^de_/, ""));
  const teamLogoMarkup = (team) => `<span class="match-team-logo">${teamBadge(team)}</span>`;
  const ratingTone = (rating) => Number(rating) >= 1.1 ? "high" : Number(rating) < .9 ? "low" : "mid";

  function matchMapPanelMarkup(match, teamA, teamB, scores) {
    if (!Array.isArray(match.maps) || !match.maps.length) return `<section class="match-map-panel"><header><span>MAPA</span><b>${escapeHtml(mapLabel(match.leetifyInfo?.mapName || match.demoInfo?.mapName))}</b></header><div><a href="#time/${encodeURIComponent(teamA)}">${escapeHtml(teamA)}</a><strong>${scores[0] ?? "—"}</strong></div><div><a href="#time/${encodeURIComponent(teamB)}">${escapeHtml(teamB)}</a><strong>${scores[1] ?? "—"}</strong></div><small>${match.leetifyInfo?.rounds || match.demoInfo?.rounds || 0} rounds registrados</small></section>`;
    return `<section class="match-map-panel match-series-panel"><header><span>MAPAS DA SÉRIE</span><b>${match.maps.filter((map) => map.score).length}/${match.maps.length} registrados</b></header><div class="match-series-team"><a href="#time/${encodeURIComponent(teamA)}">${escapeHtml(teamA)}</a><strong>${scores[0] ?? "—"}</strong></div><div class="match-series-team"><a href="#time/${encodeURIComponent(teamB)}">${escapeHtml(teamB)}</a><strong>${scores[1] ?? "—"}</strong></div><ol>${match.maps.map((map, index) => {
      const mapScores = String(map.score || "").match(/\d+/g) || [];
      const statisticsSource = map.leetifyUrl && map.demoUrl ? "Demo + Leetify" : map.leetifyUrl ? "Leetify" : map.demoUrl ? "Demo" : "sem estatísticas";
      const source = map.scoreSource === "manual" || map.resultSource === "manual" ? `Placar oficial manual · ${statisticsSource}` : map.statisticsSource === "missing" ? "Fonte pendente" : statisticsSource;
      return `<li class="${map.statisticsSource === "missing" ? "missing" : ""}"><span><b>${escapeHtml(map.name || mapLabel(map.mapName) || `Mapa ${index + 1}`)}</b><small>${escapeHtml(source)}</small></span><strong>${mapScores.length ? `${mapScores[0]} : ${mapScores[1]}` : "A confirmar"}</strong></li>`;
    }).join("")}</ol></section>`;
  }

  function matchStatsTable(team, stats) {
    const rows = stats.filter((player) => player.team === team);
    if (!rows.length) return "";
    return `<section class="match-stat-team"><header>${teamLogoMarkup(team)}<a href="#time/${encodeURIComponent(team)}">${escapeHtml(team)}</a><span>${rows.length} jogadores</span></header><div class="match-stat-head"><span>Jogador</span><span>K-D</span><span>+/-</span><span>ADR</span><span>KAST</span><span>Rating</span></div>${rows.map((player) => {
      const difference = Number(player.kills || 0) - Number(player.deaths || 0);
      const known = playerHistory.has(player.name);
      return `<div class="match-stat-row"><span>${known ? `<a href="#jogador/${encodeURIComponent(player.name)}">${escapeHtml(player.name)}</a>` : `<b>${escapeHtml(player.demoName || player.name)}</b>`}${player.demoName && player.demoName !== player.name ? `<small>jogou como ${escapeHtml(player.demoName)}</small>` : ""}</span><span>${player.kills}-${player.deaths}</span><span class="${difference > 0 ? "positive" : difference < 0 ? "negative" : ""}">${difference > 0 ? "+" : ""}${difference}</span><span>${player.adr ?? "—"}</span><span>${player.kast != null ? `${player.kast}%` : "—"}</span><strong class="${ratingTone(player.rating)}">${player.rating || "—"}</strong></div>`;
    }).join("")}</section>`;
  }

  function statisticsSourceLabel(record) {
    if (record.statisticsSource === "mixed") return "Demo + Leetify · série";
    if (record.statisticsSource === "leetify") return `Leetify${record.statisticsStatus === "partial" ? " · parcial" : ""}`;
    if (record.statisticsSource === "demo") return "Demo";
    if (record.statisticsSource === "manual") return "Sem estatísticas automáticas";
    return "Fonte não identificada";
  }

  function matchStatsViewsMarkup(match, teamA, teamB, options = {}) {
    const views = [{ key: "overall", label: "Geral", statistics: Array.isArray(match.statistics) ? match.statistics : [], source: statisticsSourceLabel(match) }];
    (match.maps || []).forEach((map, index) => views.push({ key: `map-${index}`, label: map.name || mapLabel(map.mapName) || `Mapa ${index + 1}`, statistics: Array.isArray(map.statistics) ? map.statistics : [], source: statisticsSourceLabel(map), score: map.score || "" }));
    const tabs = views.length > 1 ? `<nav class="match-stat-tabs" aria-label="Estatísticas por mapa">${views.map((view, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-match-stats-tab="${view.key}"><span>${escapeHtml(view.label)}</span>${view.score ? `<small>${escapeHtml(view.score.replace(" - ", " : "))}</small>` : ""}</button>`).join("")}</nav>` : "";
    const panels = views.map((view, index) => {
      const body = view.statistics.length ? `${matchStatsTable(teamA, view.statistics)}${matchStatsTable(teamB, view.statistics)}` : `<div class="match-loading"><b>${options.loading && index === 0 ? "Buscando os números no Leetify…" : "Estatísticas não disponíveis neste recorte"}</b><span>${options.error && index === 0 ? escapeHtml(options.error) : "O placar oficial e as fontes anexadas continuam preservados."}</span></div>`;
      return `<div class="match-stat-panel" data-match-stats-panel="${view.key}" ${index === 0 ? "" : "hidden"}><div class="match-stat-context"><b>${index === 0 ? "Série completa" : escapeHtml(view.label)}</b><span>Fonte das estatísticas: ${escapeHtml(view.source)}</span></div>${body}</div>`;
    }).join("");
    return `${tabs}${panels}`;
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
    const leetifyUrl = safeLeetifyUrl(match.leetifyUrl);
    const scoreboardImage = safeScoreboardImage(match.scoreboardImage);
    const mvp = [...stats].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || Number(b.kills || 0) - Number(a.kills || 0))[0];
    const mvpMeta = mvp && playerMeta.get(mvp.name) || {};
    const sourceLabel = statisticsSourceLabel(match);
    const matchDescriptor = /\bMD\d\b/i.test(match.name || "") ? match.name : `${match.name || "Partida"} · MD${match.bestOf || 1}`;
    const back = event ? `#campeonato/${encodeURIComponent(event.id)}/matches` : "#campeonatos";
    const statsBody = matchStatsViewsMarkup(match, teamA, teamB, options);
    const mapPanel = matchMapPanelMarkup(match, teamA, teamB, scores);
    const eventLogo = tournamentMeta.get(event?.id)?.logo || "";
    document.querySelector("#matchPage").innerHTML = `<a class="profile-back" href="${back}">← Voltar ao campeonato</a><article class="match-detail-page"><header class="match-detail-hero"><a class="match-event-link" href="#campeonato/${encodeURIComponent(event?.id || "")}/overview">${eventLogo ? `<img src="${escapeHtml(eventLogo)}" alt="" />` : ""}<span><b>${escapeHtml(event?.name || "Campeonato HLTPC")}</b><small>${event?.year || ""}</small></span></a><div class="match-detail-team team-a"><div class="match-team-art">${teamLogoMarkup(teamA)}</div><a href="#time/${encodeURIComponent(teamA)}">${escapeHtml(teamA)}</a></div><div class="match-detail-score"><time>${escapeHtml(match.subtitle || "Data a definir")}</time><strong>${scores.length ? `${scores[0]} <i>:</i> ${scores[1]}` : "VS"}</strong><span>${escapeHtml(matchDescriptor)}</span></div><div class="match-detail-team team-b"><div class="match-team-art">${teamLogoMarkup(teamB)}</div><a href="#time/${encodeURIComponent(teamB)}">${escapeHtml(teamB)}</a></div></header><div class="match-detail-grid">${mapPanel}<section class="match-proof-panel"><header><span>FONTES</span><b>Conferência dos dados</b></header>${matchSourcesMarkup(match)}${match.evidenceNote ? `<p class="match-evidence-note">${escapeHtml(match.evidenceNote)}</p>` : ""}${scoreboardImage ? `<a class="scoreboard-evidence" href="${escapeHtml(scoreboardImage)}" target="_blank" rel="noopener"><img src="${escapeHtml(scoreboardImage)}" alt="Print do placar final" /><span>Abrir print do placar ↗</span></a>` : ""}${leetifyUrl ? `<a class="external-source" href="${escapeHtml(leetifyUrl)}" target="_blank" rel="noopener">Abrir partida no Leetify ↗</a>` : ""}</section></div><section class="match-stats-section"><header><div><span>DESEMPENHO</span><h2>Estatísticas da partida</h2></div><small>Fonte geral: ${sourceLabel}</small></header>${statsBody}</section>${stats.length ? `<section class="match-lineups-section"><header><span>ESCALAÇÕES</span><h2>Lineups</h2></header><div>${matchLineup(teamA, event, stats)}${matchLineup(teamB, event, stats)}</div></section>` : ""}${mvp ? `<section class="match-mvp"><div class="match-mvp-photo">${mvpMeta.photo ? `<img src="${escapeHtml(mvpMeta.photo)}" alt="" />` : escapeHtml((mvp.name || "MVP").slice(0, 2).toUpperCase())}</div><div><span>DESTAQUE DA PARTIDA</span><h2>${playerHistory.has(mvp.name) ? `<a href="#jogador/${encodeURIComponent(mvp.name)}">${escapeHtml(mvp.name)}</a>` : escapeHtml(mvp.demoName || mvp.name)}</h2><p>${mvp.kills}-${mvp.deaths} · ${mvp.adr} ADR · ${mvp.kast}% KAST</p></div><strong>${mvp.rating}<small>Rating</small></strong></section>` : ""}</article>`;
    document.querySelectorAll("[data-match-stats-tab]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-match-stats-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
      document.querySelectorAll("[data-match-stats-panel]").forEach((panel) => { panel.hidden = panel.dataset.matchStatsPanel !== button.dataset.matchStatsTab; });
    }));
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
    if (route === "noticia" && parameter) {
      const item = data.news.find((candidate) => candidate.id === decodeURIComponent(parameter));
      if (item) renderNewsPage(item); else location.hash = "noticias";
    }
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === route));
    const navRoute = ({ jogador: "jogadores", time: "times", campeonato: "campeonatos", partida: "campeonatos", noticia: "inicio", noticias: "inicio" })[route] || route;
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
  renderTeamPowerRanking();
  renderRanking();
  renderMatches();
  renderTournaments();
  renderPlayers();
  renderTeams();
  navigate();
})();
