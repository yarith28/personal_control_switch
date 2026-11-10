const test = require('node:test');
const assert = require('node:assert/strict');

test('history diff distinguishes increment/decrement content from file headers', async () => {
  const { parseHistoryDiff } = await import('../src/renderer/js/history-diff.mjs');
  const rows = parseHistoryDiff([
    'diff --git a/counter.js b/counter.js',
    '--- a/counter.js',
    '+++ b/counter.js',
    '@@ -1,2 +1,2 @@',
    '---counter;',
    '+++counter;',
    ' done();',
    '',
  ].join('\n'));
  assert.deepEqual(rows.slice(1, 3).map((row) => [row.className, row.oldNumber, row.newNumber]), [
    ['', '', ''], ['', '', ''],
  ]);
  assert.deepEqual(rows.slice(4).map((row) => [row.className, row.oldNumber, row.newNumber]), [
    ['history-diff-removed', '1', ''],
    ['history-diff-added', '', '1'],
    ['', '2', '2'],
  ]);
});

test('history diff handles zero-length ranges, missing newlines, and multiple files', async () => {
  const { parseHistoryDiff } = await import('../src/renderer/js/history-diff.mjs');
  const rows = parseHistoryDiff([
    '@@ -0,0 +1 @@',
    '+++new;',
    '\\ No newline at end of file',
    'diff --git a/removed.js b/removed.js',
    '--- a/removed.js',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '---old;',
    '\\ No newline at end of file',
  ].join('\n'));
  assert.deepEqual([rows[1].className, rows[1].newNumber], ['history-diff-added', '1']);
  assert.deepEqual([rows[7].className, rows[7].oldNumber], ['history-diff-removed', '1']);
  for (const index of [2, 3, 4, 5, 8]) {
    assert.equal(rows[index].className, '');
    assert.equal(rows[index].oldNumber, '');
    assert.equal(rows[index].newNumber, '');
  }
});

test('history diff numbers plain file contents without interpreting patch syntax', async () => {
  const { parseHistoryDiff } = await import('../src/renderer/js/history-diff.mjs');
  const rows = parseHistoryDiff('++counter;\n--counter;\n\n@@ -1 +1 @@\n', true);
  assert.deepEqual(rows.map((row) => row.newNumber), ['1', '2', '3', '4']);
  assert.ok(rows.every((row) => row.oldNumber === '' && row.className === ''));
  assert.equal(rows[2].line, '');
});

test('large diff indexing exposes numbered rows without allocating every rendered row', async () => {
  const { indexHistoryDiff } = await import('../src/renderer/js/history-diff.mjs');
  const model = indexHistoryDiff(Array.from({ length: 5000 }, (_, index) => `line ${index + 1}`).join('\n'), true);
  assert.equal(model.length, 5000);
  assert.deepEqual(model.row(4999), { line: 'line 5000', className: '', oldNumber: '', newNumber: '5000' });
});

test('diff viewport ranges stay bounded and include first, middle, and last lines', async () => {
  const { diffViewportRange } = await import('../src/renderer/js/history-diff.mjs');
  const first = diffViewportRange(5000, 0, 340);
  assert.equal(first.start, 0);
  assert.equal(first.end, 28);
  const middle = diffViewportRange(5000, 17000, 340);
  assert.equal(middle.start, 992);
  assert.equal(middle.end, 1028);
  assert.equal(middle.offset, 992 * 17);
  const last = diffViewportRange(5000, 5000 * 17 - 340, 340);
  assert.equal(last.end, 5000);
  assert.ok(last.end - last.start <= 36);
  assert.equal(last.totalHeight, 85000);
  assert.deepEqual(diffViewportRange(0, 0, 340), { start: 0, end: 0, offset: 0, totalHeight: 0 });
});
