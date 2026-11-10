const test = require('node:test');
const assert = require('node:assert/strict');

test('commit graph keeps linear history in one continuous lane', async () => {
  const { layoutCommitGraph } = await import('../src/renderer/js/commit-graph.mjs');
  const graph = layoutCommitGraph([
    { sha: 'working', parents: ['head'], workingTree: true },
    { sha: 'head', parents: ['root'] },
    { sha: 'root', parents: [] },
  ]);
  assert.equal(graph.laneCount, 1);
  assert.deepEqual(graph.rows.map((row) => row.lane), [0, 0, 0]);
  assert.equal(graph.rows[1].incomingDashed, true);
  assert.equal(graph.rows[2].incomingDashed, false);
  assert.equal(graph.continues, false);
});

test('commit graph splits merge parents and rejoins their shared ancestor', async () => {
  const { layoutCommitGraph } = await import('../src/renderer/js/commit-graph.mjs');
  const graph = layoutCommitGraph([
    { sha: 'merge', parents: ['main', 'feature'] },
    { sha: 'feature', parents: ['root'] },
    { sha: 'main', parents: ['root'] },
    { sha: 'root', parents: [] },
  ]);
  assert.equal(graph.laneCount, 2);
  assert.deepEqual(graph.rows[0].edges.map((edge) => edge.lane), [0, 1]);
  assert.deepEqual(graph.rows.map((row) => row.lane), [0, 1, 0, 1]);
  assert.equal(graph.rows[1].through[0].lane, 0);
  assert.equal(graph.rows[2].edges[0].lane, graph.rows[3].lane);
  assert.equal(graph.continues, false);
});

test('commit graph retains all parents and marks a truncated history', async () => {
  const { layoutCommitGraph } = await import('../src/renderer/js/commit-graph.mjs');
  const graph = layoutCommitGraph([{ sha: 'merge', parents: ['one', 'two', 'three'] }]);
  assert.equal(graph.laneCount, 3);
  assert.equal(graph.rows[0].edges.length, 3);
  assert.equal(graph.continues, true);
});
