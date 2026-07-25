const test = require('node:test');
const assert = require('node:assert/strict');

test('edge scroll speed ramps toward the top and bottom edges', async () => {
  const { edgeScrollSpeed } = await import('../src/renderer/js/drag-scroll-speed.mjs');

  assert.equal(edgeScrollSpeed(200, 100, 500), 0);
  assert.equal(edgeScrollSpeed(100, 100, 500), -18);
  assert.equal(edgeScrollSpeed(120, 100, 500), -14);
  assert.equal(edgeScrollSpeed(480, 100, 500), 14);
  assert.equal(edgeScrollSpeed(500, 100, 500), 18);
  assert.equal(edgeScrollSpeed(90, 100, 500), 0);
  assert.equal(edgeScrollSpeed(510, 100, 500), 0);
});
