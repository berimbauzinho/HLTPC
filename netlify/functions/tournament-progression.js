function scoreParts(match) {
  const parts = String(match.score || "").match(/\d+/g)?.map(Number) || [];
  return parts.length >= 2 ? [parts[0], parts[1]] : null;
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
    if (!table.complete || table.teams.length !== 3) return;
    const semifinal = content.matches.find((match) => match.tournamentId === tournament.id && match.round === "semifinal");
    const final = content.matches.find((match) => match.tournamentId === tournament.id && match.round === "final");
    assignTeam(semifinal, "A", table.teams[1]);
    assignTeam(semifinal, "B", table.teams[2]);
    if (semifinal) {
      semifinal.slotA = semifinal.teamA;
      semifinal.slotB = semifinal.teamB;
      semifinal.status = semifinal.status === "draft" ? "published" : semifinal.status;
      semifinal.qualification = { source: "group", seedA: 2, seedB: 3, resolvedAt: semifinal.qualification?.resolvedAt || content.updatedAt || "" };
    }
    assignTeam(final, "A", table.teams[0]);
    if (final) {
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
    tournament.groupStandings = table.teams.map((team, index) => ({ ...team, position: index + 1 }));
  });
  return content;
}

module.exports = { applyTournamentProgression, standingsForTournament };
