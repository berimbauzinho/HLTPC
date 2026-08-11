const BASE_TEAM_NAMES = {
  "team-0": "TAMPRIMES",
  "team-1": "FROM SOFTWARE Gaming",
  "team-2": "TIME 1",
  "team-3": "TIME 2",
  "team-4": "PROCEDER Gaming",
  "team-5": "TWICE E-sports",
  "team-6": "KAMIKUAZI",
  "team-7": "BOCA DE FUMO Gaming",
  "team-8": "RED PILL Gaming",
  "team-9": "Deftones"
};

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeContentTeamReferences(content) {
  if (!content || !Array.isArray(content.teams)) return content || {};
  const byId = new Map(content.teams.map((team) => [team.id, team]));
  const idByName = new Map();
  content.teams.forEach((team) => {
    [team.name, ...(team.aliases || []), BASE_TEAM_NAMES[team.id]].filter(Boolean).forEach((name) => idByName.set(normalized(name), team.id));
  });
  const resolveId = (id, name) => byId.has(id) ? id : idByName.get(normalized(name)) || "";
  const currentName = (id, fallback) => byId.get(id)?.name || fallback || "";
  const normalizeList = (record, namesKey, idsKey) => {
    const names = Array.isArray(record[namesKey]) ? record[namesKey] : [];
    const ids = Array.isArray(record[idsKey]) ? record[idsKey] : [];
    const nextIds = names.map((name, index) => resolveId(ids[index], name));
    record[idsKey] = nextIds;
    record[namesKey] = names.map((name, index) => currentName(nextIds[index], name));
  };

  content.tournaments?.forEach((event) => {
    normalizeList(event, "teams", "teamIds");
    const championId = resolveId(event.championId, event.champion);
    if (championId) { event.championId = championId; event.champion = currentName(championId, event.champion); }
  });
  content.players?.forEach((player) => normalizeList(player, "teams", "teamIds"));
  content.matches?.forEach((match) => {
    ["A", "B"].forEach((side) => {
      const idKey = `team${side}Id`;
      const nameKey = `team${side}`;
      const id = resolveId(match[idKey], match[nameKey]);
      if (!id) return;
      const previous = match[nameKey];
      match[idKey] = id;
      match[nameKey] = currentName(id, previous);
      if (match[`slot${side}`] === previous) match[`slot${side}`] = match[nameKey];
      (match.statistics || []).forEach((player) => { if (player.team === previous) player.team = match[nameKey]; });
    });
    const winnerId = resolveId(match.winnerId, match.winner);
    if (winnerId) { match.winnerId = winnerId; match.winner = currentName(winnerId, match.winner); }
  });
  return content;
}

module.exports = { BASE_TEAM_NAMES, normalizeContentTeamReferences };
