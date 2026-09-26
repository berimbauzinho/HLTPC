function repairHistoricalRelations(content) {
  if (content._relationsVersion >= 1) return content;
  const event = content.tournaments?.find((item) => item.id === 'esl-gramadao-2025');
  // Only the known migration bug, not arbitrary future tournament edits.
  if (event && JSON.stringify(event.teamIds) === JSON.stringify(['team-0', 'team-1', 'team-2'])) {
    event.teamIds = ['team-4', 'team-5', 'team-6'];
    event.teams = event.teamIds.map((id) => content.teams.find((team) => team.id === id)?.name);
    const final = content.matches?.find((item) => item.id === 'esl-gramadao-2025-final');
    if (final && final.teamAId === 'team-1' && final.teamBId === 'team-4') {
      final.teamAId = 'team-5';
      final.teamA = content.teams.find((team) => team.id === 'team-5')?.name || 'TWICE E-sports';
      final.slotA = final.teamA;
    }
  }
  for (const team of content.teams || []) {
    const names = { 'team-0': ['TAMPRIMES', 'TAMPRIMES Club'], 'team-2': ['TIME 1', 'Amigos do Lanches'], 'team-3': ['TIME 2', 'Amigos do Marcola'] };
    if (names[team.id]?.[0] === team.name) team.name = names[team.id][1];
  }
  content._relationsVersion = 1;
  return content;
}
module.exports = { repairHistoricalRelations };
