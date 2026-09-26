import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateSeries } from '../netlify/functions/demo-series.mjs';
test('two maps yield a 2-0 series and aggregate per-player statistics exactly once', () => {
  const match = { bestOf: 3, teamA: 'A', teamB: 'B', maps: [0,1].map((i) => ({ score: '13 - 10', rounds: 23, statistics: [{ steamid: '1', name: 'P', team: 'A', kills: 10 + i, deaths: 5, damage: 2300, rating: 1.2 }] })) };
  consolidateSeries(match);
  assert.equal(match.score, '2 - 0');
  assert.equal(match.statistics[0].kills, 21);
  assert.equal(match.statistics[0].adr, 100);
  consolidateSeries(match);
  assert.equal(match.statistics[0].kills, 21);
});
test('processing a demo preserves a manually confirmed result', () => {
  const match = { bestOf: 1, manualResult: true, score: '13 - 11', winner: 'B', maps: [{ score: '13 - 5', rounds: 18, statistics: [{ name: 'P', team: 'A', kills: 8 }] }] };
  consolidateSeries(match);
  assert.equal(match.score, '13 - 11');
  assert.equal(match.winner, 'B');
});
