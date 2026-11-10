const test = require('node:test');
const assert = require('node:assert/strict');

function rgb(value) {
  return value.startsWith('#')
    ? [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
    : value.match(/[\d.]+/g).slice(0, 3).map(Number);
}

function luminance(color) {
  const linear = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(rgb(first)), luminance(rgb(second))].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('every theme has complete, distinct light and dark palettes without mutating the originals', async () => {
  const { THEMES, themeVariables } = await import('../src/renderer/js/theme-palettes.mjs');
  const before = JSON.stringify(THEMES);
  const darkGradients = new Set();
  for (const theme of THEMES) {
    const light = themeVariables(theme, false);
    const dark = themeVariables(theme, true);
    assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort(), theme.id);
    assert.ok(Object.values(dark).every((value) => typeof value === 'string' && value.length), theme.id);
    assert.notEqual(light['--bg-gradient'], dark['--bg-gradient'], theme.id);
    assert.notEqual(light['--dropdown-bg'], dark['--dropdown-bg'], theme.id);
    assert.notEqual(light['--branch-color'], dark['--branch-color'], theme.id);
    assert.ok(luminance(rgb(light['--text-primary'])) < 0.1, `${theme.id} light text`);
    assert.ok(luminance(rgb(dark['--text-primary'])) > 0.7, `${theme.id} dark text`);
    if (theme.id !== 'midnight') assert.equal(light['--bg-gradient'], theme.vars['--bg-gradient']);
    darkGradients.add(dark['--bg-gradient']);
  }
  assert.equal(darkGradients.size, THEMES.length);
  assert.equal(JSON.stringify(THEMES), before);
});

test('dark palettes keep text, accents, errors, and diff colors readable on their panel backgrounds', async () => {
  const { THEMES, themeVariables } = await import('../src/renderer/js/theme-palettes.mjs');
  for (const theme of THEMES) {
    const vars = themeVariables(theme, true);
    for (const token of [
      '--text-primary', '--text-muted', '--text-faint', '--branch-color', '--remote-color',
      '--danger-color', '--warning-color', '--success-color', '--diff-removed-color', '--untracked-color',
    ]) {
      assert.ok(contrast(vars[token], vars['--dropdown-bg']) >= 4.5, `${theme.id} ${token}`);
    }
  }
});

test('saved mode overrides theme defaults while legacy Midnight configurations stay dark', async () => {
  const { THEMES, savedDarkMode } = await import('../src/renderer/js/theme-palettes.mjs');
  for (const theme of THEMES) {
    assert.equal(savedDarkMode(theme, true), true);
    assert.equal(savedDarkMode(theme, false), false);
    assert.equal(savedDarkMode(theme), theme.id === 'midnight');
    assert.equal(savedDarkMode(theme, null), theme.id === 'midnight');
  }
});
