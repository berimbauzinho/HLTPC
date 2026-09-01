const ASSET_ROOT = "/assets/recovered";

const TEAM_RECOVERY = {
  "team-0": { name: "TAMPRIMES Club", acronym: "TP", logo: `${ASSET_ROOT}/tamprimes-club.webp` },
  "team-1": { name: "FROM SOFTWARE Gaming", acronym: "FS", logo: `${ASSET_ROOT}/from-software-gaming.webp` },
  "team-2": { name: "Amigos do Lanches", acronym: "ADL", logo: `${ASSET_ROOT}/amigos-do-lanches.webp` },
  "team-3": { name: "Amigos do Marcola", acronym: "ADM", logo: `${ASSET_ROOT}/amigos-do-marcola.webp` },
  "team-4": { name: "PROCEDER Gaming", acronym: "PROC", logo: `${ASSET_ROOT}/proceder-gaming.webp` },
  "team-5": { name: "TWICE E-sports", acronym: "TW", logo: `${ASSET_ROOT}/twice-esports.webp` },
  "team-6": { name: "KAMIKUAZI", acronym: "KMKZ", logo: `${ASSET_ROOT}/kamikuazi.webp` },
  "team-7": { name: "BOCA DE FUMO Gaming", acronym: "BDF", logo: `${ASSET_ROOT}/boca-de-fumo-gaming.webp` },
  "team-8": { name: "RED PILL Gaming", acronym: "RP", logo: `${ASSET_ROOT}/red-pill-gaming.webp` },
  "team-9": { name: "Deftones", acronym: "DFT", logo: `${ASSET_ROOT}/deftones.webp` }
};

const TOURNAMENT_RECOVERY = {
  "iem-gramadao-2024": {
    logo: `${ASSET_ROOT}/iem-major-gramadao-2024.webp`,
    banner: `${ASSET_ROOT}/iem-major-gramadao-2024.webp`
  },
  "blast-vila-sao-paulo-2025": {
    logo: `${ASSET_ROOT}/blast-resenha-series-2025.webp`,
    banner: `${ASSET_ROOT}/blast-resenha-series-2025.webp`
  },
  "esl-gramadao-2025": {
    logo: `${ASSET_ROOT}/esl-major-gramadao-2025.webp`,
    banner: `${ASSET_ROOT}/esl-major-gramadao-2025.webp`
  },
  "pgl-abadia-2026": {
    logo: `${ASSET_ROOT}/pgl-major-abadia-2026.webp`,
    banner: `${ASSET_ROOT}/pgl-major-abadia-banner.webp`
  }
};

const NEWS_RECOVERY = {
  "pgl-2026-lineups": `${ASSET_ROOT}/noticia-major-abadia-29-08.webp`,
  "historico-reorganizado": `${ASSET_ROOT}/hltpc-logo.webp`
};

function recoverTeams(content) {
  (content.teams || []).forEach((team) => {
    const recovered = TEAM_RECOVERY[team.id];
    if (!recovered) return;
    const previousName = team.name;
    team.name = recovered.name;
    team.acronym = recovered.acronym;
    team.logo = recovered.logo;
    team.aliases = Array.from(new Set([...(team.aliases || []), previousName].filter(Boolean)));
  });
}

function recoverTournaments(content) {
  (content.tournaments || []).forEach((tournament) => {
    const recovered = TOURNAMENT_RECOVERY[tournament.id];
    if (recovered) Object.assign(tournament, recovered);
  });
}

function recoverNews(content) {
  (content.news || []).forEach((item) => {
    if (NEWS_RECOVERY[item.id]) item.image = NEWS_RECOVERY[item.id];
  });

  if (!(content.news || []).some((item) => item.id === "boca-final-pgl-2026")) {
    content.news.unshift({
      id: "boca-final-pgl-2026",
      name: "BOCA DE FUMO garante vaga direta na final",
      subtitle: "Líder da fase de grupos, a BOCA enfrentará a RED PILL Gaming na decisão.",
      body: "A BOCA DE FUMO Gaming terminou a fase de grupos na primeira colocação e avançou diretamente à final do PGL Major Abadia 2026. Após vencer a semifinal contra a Deftones por 2–0, a RED PILL Gaming será a adversária na decisão.",
      author: "HLTPC",
      date: "2026-08-31",
      tournamentId: "pgl-abadia-2026",
      status: "published",
      updated: "Recuperado a partir da classificação e da arte original",
      image: `${ASSET_ROOT}/noticia-boca-classificada.webp`
    });
  }
}

function recoverFinalGroupMatch(content) {
  const match = (content.matches || []).find((item) => item.id === "pgl-abadia-2026-group-6");
  if (!match || match.resultSource === "manual" || match.scoreSource === "manual") return;
  match.score = "10 - 13";
  match.winner = "RED PILL Gaming";
  match.winnerId = "team-8";
  match.status = "finished";
  match.updated = "Placar recuperado da demo processada";
}

function applyRecoveryMedia(content) {
  if (!content || typeof content !== "object") return content || {};

  // A base sobrescrita não tinha revisão. Depois do primeiro salvamento seguro,
  // as escolhas feitas no Admin passam a prevalecer e não são reimpostas aqui.
  if (Number(content._revision || 0) > 0) return content;

  recoverTeams(content);
  recoverTournaments(content);
  recoverNews(content);
  recoverFinalGroupMatch(content);
  return content;
}

module.exports = { applyRecoveryMedia };
