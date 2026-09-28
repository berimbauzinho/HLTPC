const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureAllTournamentFixtures } = require('../netlify/functions/tournament-progression.js');

test('a two-team MD5 tournament creates one final with five editable maps', () => {
  const content = {
    tournaments: [{ id: 'fpg-2026', status: 'published', formatType: 'two_team_md5', teams: ['Time 1', 'Time 2'] }],
    matches: []
  };
  ensureAllTournamentFixtures(content);
  assert.equal(content.matches.length, 1);
  const final = content.matches[0];
  assert.equal(final.name, 'Final · MD5');
  assert.equal(final.bestOf, 5);
  assert.deepEqual([final.teamA, final.teamB], ['Time 1', 'Time 2']);
  assert.deepEqual(final.maps.map((map) => map.order), [1, 2, 3, 4, 5]);
  ensureAllTournamentFixtures(content);
  assert.equal(content.matches.length, 1);
});
