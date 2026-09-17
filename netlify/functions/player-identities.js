const CONFIRMED_PLAYER_IDENTITIES = [
  { name: "190", steamId: "76561198848909379", aliases: ["fraquinho", "[PROC] 190"] },
  { name: "cerex", steamId: "76561198804861759", aliases: ["TW | cerex"] },
  { name: "Cobix", steamId: "76561198145978890", aliases: ["[PROC] Cobix"] },
  { name: "cuavila", steamId: "76561199001115634", aliases: ["MANO CHORIS", "KMKZ | MANO CHORIS"] },
  { name: "Cuazzi", steamId: "76561198359845217", aliases: ["Voulin Raba", "cuallen", "cualy", "KMKZ | cuallen"] },
  { name: "Downey", steamId: "76561198080805450", aliases: ["Mikasa es su kasa"] },
  { name: "fancy", steamId: "76561198078860579", aliases: ["TW | fancy"] },
  { name: "GJota", steamId: "76561198827482340", aliases: ["GJ", "KMKZ | GJ"] },
  { name: "hhh", steamId: "76561198040780943", aliases: ["[PROC] hhh"] },
  { name: "ice greg", steamId: "76561198365761058", aliases: ["menor gelado", "[PROC] menor gelado"] },
  { name: "JohnWeed", steamId: "76561198090993134", aliases: ["ᴊʜᴏɴʏsᴋ8🛹"] },
  { name: "lanches", steamId: "76561198300371519", aliases: ["[PROC] lanches"] },
  { name: "LnW", steamId: "76561198086202414", aliases: ["TW | LnW"] },
  { name: "Oblivion", steamId: "76561199591751431", aliases: ["DEF | Oblivion"] },
  { name: "PIRUVATO", steamId: "76561198073026493", aliases: ["TW | PIRUVATO <3", "PIRUVATO <3"] },
  { name: "PRIMO", steamId: "76561198219090713", aliases: ["Primus", "KMKZ | Primus"] },
  { name: "ROMAOCrazy", steamId: "76561198204872171", aliases: ["TW | ROMAOcrazy", "ROMAOcrazy"] }
];

function normalizedNick(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function applyPlayerIdentities(content) {
  if (!content || !Array.isArray(content.players)) return content || {};

  const bySteamId = new Map(CONFIRMED_PLAYER_IDENTITIES.map((item) => [item.steamId, item]));
  const byName = new Map(CONFIRMED_PLAYER_IDENTITIES.map((item) => [normalizedNick(item.name), item]));

  content.players.forEach((player) => {
    const identity = bySteamId.get(player.steamId) || byName.get(normalizedNick(player.name));
    if (!identity) return;

    player.steamId = identity.steamId;
    const existingAliases = Array.isArray(player.aliases)
      ? player.aliases
      : String(player.alias || "").split(/[,;|]/).map((s) => s.trim()).filter(Boolean);

    const merged = Array.from(new Set([...existingAliases, ...identity.aliases]));
    player.aliases = merged;
    player.alias = merged.join(", ");
    player.identityCorrectionVersion = 1;
  });

  // Also correct any stats in matches/maps that might have recorded alternate nicks
  if (Array.isArray(content.matches)) {
    content.matches.forEach((match) => {
      const correctStats = (statistics) => {
        if (!Array.isArray(statistics)) return;
        statistics.forEach((stat) => {
          const sid = String(stat.steamid || stat.steam64Id || "").trim();
          const identity = bySteamId.get(sid);
          if (identity && stat.name !== identity.name) {
            stat.name = identity.name;
          }
        });
      };
      correctStats(match.statistics);
      (match.maps || []).forEach((map) => correctStats(map.statistics));
    });
  }

  return content;
}

module.exports = {
  CONFIRMED_PLAYER_IDENTITIES,
  applyPlayerIdentities
};
