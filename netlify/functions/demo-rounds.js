// A begin_new_match after live play resets the match; prior rounds were cancelled.
function officialMatchEvents(events) {
  const warmup = value => value === true || value === 1 || value === '1' || value === 'true';
  const starts = events.filter(event => event.event_name === 'begin_new_match' && !warmup(event.is_warmup_period))
    .sort((a,b) => Number(a.tick || 0) - Number(b.tick || 0));
  const startTick = Number(starts.at(-1)?.tick || 0);
  return events.filter(event => Number(event.tick || 0) >= startTick && !warmup(event.is_warmup_period));
}
module.exports = { officialMatchEvents };
