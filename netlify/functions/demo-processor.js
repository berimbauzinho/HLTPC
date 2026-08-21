const parser = require("@laihoe/demoparser2");

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function booleanValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizedName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function playedAtFromName(fileName) {
  const match = String(fileName || "").match(/(20\d{2})[-_](\d{2})[-_](\d{2})[_-](\d{2})[-_](\d{2})[-_](\d{2})/);
  if (!match) return { iso: "", label: "" };
  const [, year, month, day, hour, minute, second] = match;
  const local = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`);
  return {
    iso: local.toISOString(),
    label: `${day}/${month}/${year}, ${hour}:${minute}`
  };
}

function playerDirectory(content) {
  return new Map((content.players || []).filter((player) => player.steamId).map((player) => [String(player.steamId), player]));
}

function teamForPlayer(player, match) {
  if (!player) return "";
  const teams = new Set((player.teams || []).map(normalizedName));
  if (teams.has(normalizedName(match.teamA))) return match.teamA;
  if (teams.has(normalizedName(match.teamB))) return match.teamB;
  return "";
}

function roundIndexForTick(roundEnds, tick) {
  let low = 0;
  let high = roundEnds.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (numberValue(roundEnds[middle].tick) >= tick) high = middle;
    else low = middle + 1;
  }
  return low;
}

function calculateRating(player, rounds) {
  if (!rounds) return null;
  const kpr = player.kills / rounds;
  const dpr = player.deaths / rounds;
  const apr = player.assists / rounds;
  const impact = 2.13 * kpr + 0.42 * apr - 0.41;
  return Number((0.0073 * player.kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * player.adr + 0.1587).toFixed(2));
}

function processDemoPath(filePath, match, content, fileMeta = {}) {
  const warnings = [];
  const directory = playerDirectory(content || {});
  const header = parser.parseHeader(filePath) || {};
  const events = parser.parseEvents(
    filePath,
    ["begin_new_match", "round_end", "player_death", "player_hurt", "weapon_fire"],
    ["team_name"],
    ["total_rounds_played", "is_warmup_period"]
  );
  const starts = events.filter((event) => event.event_name === "begin_new_match" && !booleanValue(event.is_warmup_period)).sort((a, b) => numberValue(a.tick) - numberValue(b.tick));
  const matchStartTick = numberValue(starts[0]?.tick || 0);
  const matchEvents = events.filter((event) => numberValue(event.tick) >= matchStartTick && !booleanValue(event.is_warmup_period));
  const roundEnds = matchEvents.filter((event) => event.event_name === "round_end").sort((a, b) => numberValue(a.tick) - numberValue(b.tick));
  if (!roundEnds.length) throw new Error("A demo não possui rounds completos depois do início oficial.");
  const rounds = roundEnds.length;
  const deaths = matchEvents.filter((event) => event.event_name === "player_death").sort((a, b) => numberValue(a.tick) - numberValue(b.tick));
  const hurts = matchEvents.filter((event) => event.event_name === "player_hurt");
  const fires = matchEvents.filter((event) => event.event_name === "weapon_fire");
  const stats = new Map();
  const perRound = Array.from({ length: rounds }, () => new Map());

  function getPlayer(steamid, demoName, rawTeam) {
    const id = String(steamid || "");
    if (!id || id === "0") return null;
    if (!stats.has(id)) {
      const profile = directory.get(id);
      stats.set(id, {
        steamid: id,
        name: profile?.name || String(demoName || id),
        demoName: String(demoName || ""),
        team: teamForPlayer(profile, match),
        rawTeam: String(rawTeam || ""),
        kills: 0,
        deaths: 0,
        assists: 0,
        headshots: 0,
        damage: 0,
        shots: 0,
        hits: 0,
        headHits: 0,
        utilityDamage: 0,
        flashAssists: 0,
        openingKills: 0,
        openingDeaths: 0,
        multiKill2: 0,
        multiKill3: 0,
        multiKill4: 0,
        multiKill5: 0
      });
    }
    const result = stats.get(id);
    if (!result.team) result.team = teamForPlayer(directory.get(id), match);
    return result;
  }

  function roundFlags(index, steamid) {
    if (!perRound[index].has(steamid)) perRound[index].set(steamid, { kill: false, assist: false, death: false, traded: false, kills: 0 });
    return perRound[index].get(steamid);
  }

  const firstKillByRound = new Set();
  deaths.forEach((event, deathIndex) => {
    const attackerId = String(event.attacker_steamid || "");
    const victimId = String(event.user_steamid || "");
    const samePlayer = attackerId && attackerId === victimId;
    const teamKill = event.attacker_team_name && event.user_team_name && event.attacker_team_name === event.user_team_name;
    const victim = getPlayer(victimId, event.user_name, event.user_team_name);
    if (!victim) return;
    const roundIndex = roundIndexForTick(roundEnds, numberValue(event.tick));
    roundFlags(roundIndex, victimId).death = true;
    victim.deaths += 1;
    if (samePlayer || teamKill || !attackerId || attackerId === "0") return;
    const attacker = getPlayer(attackerId, event.attacker_name, event.attacker_team_name);
    if (!attacker) return;
    attacker.kills += 1;
    const attackerFlags = roundFlags(roundIndex, attackerId);
    attackerFlags.kill = true;
    attackerFlags.kills += 1;
    if (!firstKillByRound.has(roundIndex)) {
      firstKillByRound.add(roundIndex);
      attacker.openingKills += 1;
      victim.openingDeaths += 1;
    }
    if (booleanValue(event.headshot)) attacker.headshots += 1;
    const assisterId = String(event.assister_steamid || "");
    if (assisterId && assisterId !== "0" && assisterId !== attackerId) {
      const assister = getPlayer(assisterId, event.assister_name, event.assister_team_name);
      if (assister) {
        assister.assists += 1;
        roundFlags(roundIndex, assisterId).assist = true;
        if (booleanValue(event.assistedflash)) assister.flashAssists += 1;
      }
    }
    const traded = deaths.slice(deathIndex + 1).find((later) => {
      if (roundIndexForTick(roundEnds, numberValue(later.tick)) !== roundIndex) return false;
      if (numberValue(later.tick) - numberValue(event.tick) > 5 * 64) return false;
      return String(later.user_steamid || "") === attackerId && later.attacker_team_name === event.user_team_name;
    });
    if (traded) roundFlags(roundIndex, victimId).traded = true;
  });

  hurts.forEach((event) => {
    const attackerId = String(event.attacker_steamid || "");
    if (!attackerId || attackerId === "0" || attackerId === String(event.user_steamid || "")) return;
    if (event.attacker_team_name && event.user_team_name && event.attacker_team_name === event.user_team_name) return;
    const attacker = getPlayer(attackerId, event.attacker_name, event.attacker_team_name);
    if (!attacker) return;
    const damage = numberValue(event.dmg_health ?? event.health_damage);
    attacker.damage += damage;
    attacker.hits += 1;
    if (["head", "1"].includes(String(event.hitgroup || event.hit_group || "").toLowerCase())) attacker.headHits += 1;
    if (/hegrenade|inferno|molotov|incgrenade/i.test(String(event.weapon || event.weapon_name || ""))) attacker.utilityDamage += damage;
  });

  fires.forEach((event) => {
    const weapon = String(event.weapon || event.weapon_name || "").toLowerCase();
    if (/knife|bayonet|grenade|molotov|incgrenade|decoy|flashbang|c4/.test(weapon)) return;
    const player = getPlayer(event.user_steamid, event.user_name, event.user_team_name);
    if (player) player.shots += 1;
  });

  stats.forEach((player) => {
    perRound.forEach((round) => { if (!round.has(player.steamid)) round.set(player.steamid, { kill: false, assist: false, death: false, traded: false, kills: 0 }); });
  });
  perRound.forEach((round) => round.forEach((flags, steamid) => {
    const player = stats.get(steamid);
    if (!player) return;
    if (flags.kills >= 5) player.multiKill5 += 1;
    else if (flags.kills === 4) player.multiKill4 += 1;
    else if (flags.kills === 3) player.multiKill3 += 1;
    else if (flags.kills === 2) player.multiKill2 += 1;
  }));

  const endTicks = roundEnds.map((event) => numberValue(event.tick));
  const tickRows = parser.parseTicks(filePath, ["kills_total", "deaths_total", "assists_total", "headshot_kills_total", "damage_total", "team_name"], endTicks);
  const finalTick = endTicks[endTicks.length - 1];
  tickRows.filter((row) => numberValue(row.tick) === finalTick && row.steamid && String(row.steamid) !== "0").forEach((row) => {
    const player = getPlayer(row.steamid, row.name, row.team_name);
    if (!player) return;
    player.kills = numberValue(row.kills_total);
    player.deaths = numberValue(row.deaths_total);
    player.assists = numberValue(row.assists_total);
    player.headshots = numberValue(row.headshot_kills_total);
    player.damage = numberValue(row.damage_total);
    player.rawTeam = String(row.team_name || player.rawTeam || "");
  });

  let scoreA = 0;
  let scoreB = 0;
  roundEnds.forEach((roundEnd) => {
    const rows = tickRows.filter((row) => numberValue(row.tick) === numberValue(roundEnd.tick));
    const knownA = rows.find((row) => teamForPlayer(directory.get(String(row.steamid || "")), match) === match.teamA);
    const teamASide = knownA?.team_name;
    if (!teamASide) return;
    const winnerSide = roundEnd.winner === "T" ? "TERRORIST" : roundEnd.winner;
    if (winnerSide === teamASide) scoreA += 1;
    else scoreB += 1;
  });
  if (scoreA + scoreB !== rounds) warnings.push("Nem todos os rounds puderam ser ligados automaticamente aos times.");

  const statistics = [...stats.values()].map((player) => {
    const kastRounds = perRound.filter((round) => {
      const flags = round.get(player.steamid);
      return flags && (flags.kill || flags.assist || !flags.death || flags.traded);
    }).length;
    const result = {
      ...player,
      adr: Number((player.damage / rounds).toFixed(1)),
      kd: player.deaths ? Number((player.kills / player.deaths).toFixed(2)) : player.kills,
      kast: Number((kastRounds * 100 / rounds).toFixed(1)),
      hsPercent: player.kills ? Number((player.headshots * 100 / player.kills).toFixed(1)) : 0,
      accuracy: player.shots ? Number((player.hits * 100 / player.shots).toFixed(1)) : 0,
      headAccuracy: player.hits ? Number((player.headHits * 100 / player.hits).toFixed(1)) : 0
    };
    result.rating = calculateRating(result, rounds);
    delete result.rawTeam;
    return result;
  }).sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.kills - a.kills);

  const fileName = fileMeta.fileName || filePath.split(/[\\/]/).pop();
  const playedAt = playedAtFromName(fileName);
  const officialResult = scoreA + scoreB === rounds && scoreA !== scoreB ? {
    score: `${scoreA} - ${scoreB}`,
    winner: scoreA > scoreB ? match.teamA : match.teamB,
    winnerId: scoreA > scoreB ? match.teamAId || "" : match.teamBId || "",
    resultSource: "demo-final-scoreboard",
    status: "finished",
    evidenceNote: "Placar e estatísticas extraídos diretamente da demo pelo processador HLTPC."
  } : {};

  return {
    ...officialResult,
    subtitle: playedAt.label || match.subtitle || "",
    statistics,
    statisticsSource: "demo",
    statisticsSecondarySource: match.leetifyUrl ? "leetify" : "",
    demoInfo: {
      fileName,
      fileSize: numberValue(fileMeta.fileSize),
      mapName: String(header.map_name || ""),
      serverName: String(header.server_name || ""),
      rounds,
      playedAt: playedAt.iso,
      playedAtLabel: playedAt.label,
      processedAt: new Date().toISOString(),
      parser: "demoparser2 0.42.0 · servidor HLTPC",
      rawFileStored: false,
      storedExternally: Boolean(match.demoUrl),
      extractionStatus: statistics.length ? "complete" : "pending",
      finalScoreRead: Boolean(officialResult.score),
      teamMapping: { matchedBySteamId: statistics.filter((player) => player.team).length, confidence: statistics.filter((player) => player.team).length === statistics.length ? 1000 : 500 },
      warnings: [...new Set(warnings)]
    }
  };
}

module.exports = { processDemoPath, playedAtFromName };
