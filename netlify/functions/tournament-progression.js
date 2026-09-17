function scoreParts(match) {
  const parts = String(match.score || "").match(/\d+/g)?.map(Number) || [];
  return parts.length >= 2 ? [parts[0], parts[1]] : null;
}

function tournamentFixtures(tournament) {
  const teams = tournament.teams || [];
  const common = {
    tournamentId: tournament.id,
    subtitle: "Data a definir",
    score: "",
    status: tournament.status === "published" ? "published" : "draft",
    generatedByFormat: true,
    formatType: tournament.formatType || (teams.length === 2 ? "two_team_md3" : teams.length === 3 ? "three_team_series" : "four_team_groups")
  };

  const createMaps = (matchId, bestOf) => {
    if (bestOf <= 1) return [];
    return Array.from({ length: bestOf }, (_, index) => ({
      id: `${matchId}-map-${index + 1}`,
      name: `Mapa ${index + 1}`,
      order: index + 1,
      score: "",
      demoUrl: "",
      leetifyUrl: ""
    }));
  };

  if (common.formatType === "two_team_md3" && teams.length === 2) {
    const finalId = `${tournament.id}-final`;
    return [{
      ...common,
      id: finalId,
      name: "Final · MD3",
      teamA: teams[0],
      teamB: teams[1],
      slotA: teams[0],
      slotB: teams[1],
      round: "final",
      bestOf: 3,
      order: 1,
      maps: createMaps(finalId, 3),
      updated: "Final gerada pelo formato"
    }];
  }

  if (common.formatType === "three_team_series" && teams.length === 3) {
    const [a, b, c] = teams;
    const group = [[a, b], [a, c], [b, c], [b, a], [c, a], [c, b]];
    const semiId = `${tournament.id}-semifinal`;
    const finalId = `${tournament.id}-final`;
    return [
      ...group.map(([teamA, teamB], index) => ({
        ...common,
        id: `${tournament.id}-group-${index + 1}`,
        name: `Fase de grupos · Jogo ${index + 1}`,
        teamA,
        teamB,
        slotA: teamA,
        slotB: teamB,
        round: "group",
        bestOf: 1,
        order: index + 1,
        updated: "Jogo MD1 gerado pelo formato"
      })),
      {
        ...common,
        id: semiId,
        name: "Semifinal · MD3",
        teamA: "",
        teamB: "",
        slotA: "2º colocado",
        slotB: "3º colocado",
        round: "semifinal",
        bestOf: 3,
        order: 7,
        maps: createMaps(semiId, 3),
        updated: "Aguardando classificação da fase de grupos"
      },
      {
        ...common,
        id: finalId,
        name: "Final · MD3",
        teamA: "",
        teamB: "",
        slotA: "1º colocado",
        slotB: "Vencedor da semifinal",
        round: "final",
        bestOf: 3,
        order: 8,
        maps: createMaps(finalId, 3),
        updated: "Aguardando classificação e semifinal"
      }
    ];
  }

  return [];
}

function ensureAllTournamentFixtures(content) {
  if (!content || !Array.isArray(content.tournaments)) return content || {};
  if (!Array.isArray(content.matches)) content.matches = [];

  content.tournaments.forEach((tournament) => {
    const expected = tournamentFixtures(tournament);
    expected.forEach((fixture) => {
      const existing = content.matches.find((m) => m.id === fixture.id);
      if (!existing) {
        content.matches.push(fixture);
      } else {
        if (!existing.round) existing.round = fixture.round;
        if (!existing.bestOf) existing.bestOf = fixture.bestOf;
        if (!existing.slotA) existing.slotA = fixture.slotA;
        if (!existing.slotB) existing.slotB = fixture.slotB;
        if (fixture.bestOf > 1 && (!Array.isArray(existing.maps) || !existing.maps.length)) {
          existing.maps = fixture.maps;
        }
      }
    });
  });

  // Specifically ensure historical results for finalized tournaments
  const iemFinal = content.matches.find((m) => m.id === "iem-gramadao-2024-final");
  if (iemFinal && !iemFinal.score) {
    iemFinal.score = "2 - 0";
    iemFinal.winner = "TAMPRIMES Club";
    iemFinal.winnerId = "team-0";
    iemFinal.status = "finished";
  }

  const blastFinal = content.matches.find((m) => m.id === "blast-vila-sao-paulo-2025-final");
  if (blastFinal && !blastFinal.score) {
    blastFinal.score = "1 - 2";
    blastFinal.winner = "Amigos do Marcola";
    blastFinal.winnerId = "team-3";
    blastFinal.status = "finished";
  }

  content.matches.sort((a, b) => (a.tournamentId || "").localeCompare(b.tournamentId || "") || (a.order || 999) - (b.order || 999));
  return content;
}

function standingsForTournament(content, tournament) {
  const teams = (tournament.teams || []).map((name, index) => ({
    id: tournament.teamIds?.[index] || "",
    name,
    wins: 0,
    losses: 0,
    roundsFor: 0,
    roundsAgainst: 0,
    roundDiff: 0
  }));
  const byName = new Map(teams.map((team) => [team.name, team]));
  const byId = new Map(teams.filter((team) => team.id).map((team) => [team.id, team]));
  const groupMatches = (content.matches || []).filter((match) => match.tournamentId === tournament.id && match.round === "group");
  groupMatches.forEach((match) => {
    const scores = scoreParts(match);
    if (!scores || scores[0] === scores[1]) return;
    const teamA = byId.get(match.teamAId) || byName.get(match.teamA);
    const teamB = byId.get(match.teamBId) || byName.get(match.teamB);
    if (!teamA || !teamB) return;
    teamA.roundsFor += scores[0];
    teamA.roundsAgainst += scores[1];
    teamB.roundsFor += scores[1];
    teamB.roundsAgainst += scores[0];
    if (scores[0] > scores[1]) { teamA.wins += 1; teamB.losses += 1; }
    else { teamB.wins += 1; teamA.losses += 1; }
  });
  teams.forEach((team) => { team.roundDiff = team.roundsFor - team.roundsAgainst; });
  teams.sort((left, right) => right.wins - left.wins || left.losses - right.losses || right.roundDiff - left.roundDiff || right.roundsFor - left.roundsFor || left.name.localeCompare(right.name, "pt-BR"));
  return { teams, groupMatches, complete: groupMatches.length === 6 && groupMatches.every((match) => Boolean(scoreParts(match))) };
}

function assignTeam(match, side, team) {
  if (!match || !team) return;
  match[`team${side}`] = team.name;
  match[`team${side}Id`] = team.id || "";
}

function applyTournamentProgression(content) {
  if (!content || !Array.isArray(content.matches) || !Array.isArray(content.tournaments)) return content || {};
  content.tournaments.filter((tournament) => tournament.formatType === "three_team_series").forEach((tournament) => {
    const table = standingsForTournament(content, tournament);
    if (table.teams.length !== 3) return;
    const semifinal = content.matches.find((match) => match.tournamentId === tournament.id && match.round === "semifinal");
    const final = content.matches.find((match) => match.tournamentId === tournament.id && match.round === "final");

    if (table.complete && semifinal?.status !== "finished") {
      assignTeam(semifinal, "A", table.teams[1]);
      assignTeam(semifinal, "B", table.teams[2]);
    }
    if (semifinal?.teamA && semifinal?.teamB) {
      semifinal.slotA = semifinal.teamA;
      semifinal.slotB = semifinal.teamB;
      semifinal.status = semifinal.status === "draft" ? "published" : semifinal.status;
      semifinal.qualification = { source: "group", seedA: 2, seedB: 3, resolvedAt: semifinal.qualification?.resolvedAt || content.updatedAt || "" };
    }

    // Specific progression for PGL Abadia 2026: RED PILL 2-0 Deftones
    if (tournament.id === "pgl-abadia-2026") {
      if (semifinal && !semifinal.score && semifinal.resultSource !== "manual") {
        semifinal.teamA = "RED PILL Gaming";
        semifinal.teamAId = "team-8";
        semifinal.teamB = "Deftones";
        semifinal.teamBId = "team-9";
        semifinal.score = "2 - 0";
        semifinal.winner = "RED PILL Gaming";
        semifinal.winnerId = "team-8";
        semifinal.status = "finished";
        semifinal.resultSource = "manual";
        semifinal.evidenceNote = "RED PILL Gaming venceu a semifinal por 2–0 contra a Deftones.";
      }
    }

    const semifinalIds = new Set([semifinal?.teamAId, semifinal?.teamBId].filter(Boolean));
    const semifinalNames = new Set([semifinal?.teamA, semifinal?.teamB].filter(Boolean));
    const directFinalist = table.complete
      ? table.teams[0]
      : table.teams.find((team) => !semifinalIds.has(team.id) && !semifinalNames.has(team.name));

    if (final && directFinalist) {
      assignTeam(final, "A", directFinalist);
      final.slotA = final.teamA;
      if (semifinal?.winner) {
        assignTeam(final, "B", { name: semifinal.winner, id: semifinal.winnerId || "" });
        final.slotB = final.teamB;
      } else {
        final.teamB = "";
        final.teamBId = "";
        final.slotB = "Vencedor da semifinal";
      }
      final.status = final.status === "draft" ? "published" : final.status;
      final.qualification = { source: "group", seedA: 1, resolvedAt: final.qualification?.resolvedAt || content.updatedAt || "" };
    }
    if (table.complete) tournament.groupStandings = table.teams.map((team, index) => ({ ...team, position: index + 1 }));
  });
  return content;
}

module.exports = { applyTournamentProgression, ensureAllTournamentFixtures, standingsForTournament };
