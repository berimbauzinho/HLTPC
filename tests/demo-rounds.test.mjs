import test from 'node:test';
import assert from 'node:assert/strict';
import rounds from '../netlify/functions/demo-rounds.js';
test('a cancelled live round before a restart cannot alter official score or event stats', () => {
  // Regression fixture from the actual PGL group-1 demo: a live start and round
  // were followed by a new match before the 22 official rounds.
  const events = [
    {event_name:'begin_new_match',tick:3877,is_warmup_period:true},
    {event_name:'begin_new_match',tick:3986,is_warmup_period:false},
    {event_name:'player_death',tick:5000,is_warmup_period:false},
    {event_name:'round_end',tick:5633,total_rounds_played:1,is_warmup_period:false},
    {event_name:'begin_new_match',tick:6845,is_warmup_period:false},
    {event_name:'player_death',tick:12000,is_warmup_period:false},
    ...Array.from({length:22},(_,i)=>({event_name:'round_end',tick:14080+i*7000,total_rounds_played:i+1,is_warmup_period:false}))
  ];
  const selected = rounds.officialMatchEvents(events.reverse());
  assert.equal(selected.filter(event=>event.event_name==='round_end').length,22);
  assert.deepEqual(selected.filter(event=>event.event_name==='player_death').map(event=>event.tick),[12000]);
});
test('a demo without begin_new_match retains non-warmup rounds', () => {
  assert.equal(rounds.officialMatchEvents([{event_name:'round_end',tick:1,is_warmup_period:'true'},{event_name:'round_end',tick:2,is_warmup_period:false}]).length,1);
});
