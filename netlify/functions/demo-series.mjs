const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const scoreParts = (value) => {
  const parts = String(value || "").match(/\d+/g)?.map(Number) || [];
  return parts.length >= 2 ? parts.slice(0, 2) : [];
};

function consolidateSeries(match) {
  const maps = (match.maps || []).filter((map) => Array.isArray(map.statistics) && map.statistics.length);
  if (!maps.length) return;
  const players = new Map();
  let totalRounds = 0;
  maps.forEach((map) => {
    const scores = scoreParts(map.score);
    const rounds = number(map.rounds || map.demoInfo?.rounds) || (scores.length ? scores[0] + scores[1] : 0);
    totalRounds += rounds;
    map.statistics.forEach((player) => {
      const key = `${player.steamid || player.steam64Id || player.name}::${player.team || ""}`;
      if (!players.has(key)) players.set(key, { ...player, kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, shots: 0, hits: 0, headHits: 0, utilityDamage: 0, openingKills: 0, openingDeaths: 0, multiKill2: 0, multiKill3: 0, multiKill4: 0, multiKill5: 0, kastWeight: 0, ratingWeight: 0, rounds: 0 });
      const row = players.get(key);
      ["kills", "deaths", "assists", "headshots", "damage", "shots", "hits", "headHits", "utilityDamage", "openingKills", "openingDeaths", "multiKill2", "multiKill3", "multiKill4", "multiKill5"].forEach((field) => { row[field] += number(player[field]); });
      row.rounds += rounds;
      row.kastWeight += number(player.kast) * rounds;
      row.ratingWeight += number(player.rating) * rounds;
    });
  });
  match.statistics = [...players.values()].map((player) => ({
    ...player,
    adr: player.rounds ? Number((player.damage / player.rounds).toFixed(1)) : 0,
    kd: player.deaths ? Number((player.kills / player.deaths).toFixed(2)) : player.kills,
    kast: player.rounds ? Number((player.kastWeight / player.rounds).toFixed(1)) : 0,
    rating: player.rounds ? Number((player.ratingWeight / player.rounds).toFixed(2)) : 0,
    hsPercent: player.kills ? Number((player.headshots * 100 / player.kills).toFixed(1)) : 0,
    accuracy: player.shots ? Number((player.hits * 100 / player.shots).toFixed(1)) : 0,
    headAccuracy: player.hits ? Number((player.headHits * 100 / player.hits).toFixed(1)) : 0
  })).sort((a, b) => b.rating - a.rating || b.kills - a.kills);
  match.statisticsSource = "demo";
  match.statisticsSecondarySource = "";
  match.demoInfo = { ...(match.demoInfo || {}), rounds: totalRounds, mapCount: maps.length, extractionStatus: "complete", rawFileStored: false };

  const scores = (match.maps || []).map((map) => scoreParts(map.score)).filter((score) => score.length);
  const winsNeeded = Math.ceil(number(match.bestOf || match.maps?.length) / 2);
  let winsA = 0; let winsB = 0;
  scores.forEach(([a, b]) => { if (a > b) winsA += 1; else if (b > a) winsB += 1; });
  if (Math.max(winsA, winsB) >= winsNeeded) {
    if (match.manualResult) return;
    match.score = `${winsA} - ${winsB}`;
    match.winner = winsA > winsB ? match.teamA : match.teamB;
    match.winnerId = winsA > winsB ? match.teamAId || "" : match.teamBId || "";
    if (!match.manualResult) match.resultSource = "demo-maps";
    match.status = "finished";
    match.evidenceNote = match.manualResult ? match.evidenceNote : `Resultado e estatísticas consolidados de ${maps.length} demos da série.`;
  }
}


export { consolidateSeries };
