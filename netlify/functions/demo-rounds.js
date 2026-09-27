// A begin_new_match after live play resets the match; prior rounds were cancelled.
function officialMatchEvents(events) {
  const warmup = value => value === true || value === 1 || value === '1' || value === 'true';
  const starts = events.filter(event => event.event_name === 'begin_new_match' && !warmup(event.is_warmup_period))
    .sort((a,b) => Number(a.tick || 0) - Number(b.tick || 0));
  const startTick = Number(starts.at(-1)?.tick || 0);
  return events.filter(event => Number(event.tick || 0) >= startTick && !warmup(event.is_warmup_period));
}
function hasCompetitiveActivity(player) {
  return ['CT', 'TERRORIST', 'T'].includes(String(player.rawTeam || '').toUpperCase()) ||
    ['kills', 'deaths', 'assists', 'damage', 'shots'].some(key => Number(player[key] || 0) > 0);
}
function isFinalCompetitiveScore(a, b) {
  const high = Math.max(a, b), low = Math.min(a, b);
  return (high === 13 && low <= 11) || (high >= 16 && high % 3 === 1 && high - low >= 2);
}
module.exports = { officialMatchEvents, hasCompetitiveActivity, isFinalCompetitiveScore };
