const DIFF_CLASSES = ['', 'history-diff-hunk', 'history-diff-added', 'history-diff-removed'];

export function indexHistoryDiff(text, plainText = false) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const oldNumbers = new Int32Array(lines.length).fill(-1);
  const newNumbers = new Int32Array(lines.length).fill(-1);
  const types = new Uint8Array(lines.length);
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hunk = !plainText && line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (plainText) {
      newNumbers[index] = ++newLine;
    } else if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
      types[index] = 1;
    } else if (oldRemaining > 0 || newRemaining > 0) {
      // Inside a hunk, +++ and --- are changed content, not file headers.
      if (line.startsWith('+')) {
        types[index] = 2;
        newNumbers[index] = newLine++;
        newRemaining -= 1;
      } else if (line.startsWith('-')) {
        types[index] = 3;
        oldNumbers[index] = oldLine++;
        oldRemaining -= 1;
      } else if (line.startsWith(' ')) {
        oldNumbers[index] = oldLine++;
        newNumbers[index] = newLine++;
        oldRemaining -= 1;
        newRemaining -= 1;
      }
    }
  }
  return {
    lines,
    length: lines.length,
    row(index) {
      return {
        line: lines[index],
        className: DIFF_CLASSES[types[index]],
        oldNumber: oldNumbers[index] < 0 ? '' : String(oldNumbers[index]),
        newNumber: newNumbers[index] < 0 ? '' : String(newNumbers[index]),
      };
    },
  };
}

export function parseHistoryDiff(text, plainText = false) {
  const model = indexHistoryDiff(text, plainText);
  return model.lines.map((_, index) => model.row(index));
}

export function diffViewportRange(count, scrollTop, height, lineHeight = 17, overscan = 8) {
  if (!count) return { start: 0, end: 0, offset: 0, totalHeight: 0 };
  const first = Math.min(count - 1, Math.floor(Math.max(0, scrollTop) / lineHeight));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + Math.max(1, Math.ceil(height / lineHeight)) + overscan);
  return { start, end, offset: start * lineHeight, totalHeight: count * lineHeight };
}
