export const THEMES = [
  {
    id: 'aurora', label: 'Aurora', swatch: '#c4b5fd',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #fce7f3 0%, #ede9fe 50%, #dbeafe 100%)',
      '--blob1': '#f9a8d4', '--blob2': '#c4b5fd', '--blob3': '#d8d0f5',
      '--title-gradient': 'linear-gradient(135deg, #a855f7, #ec4899, #f59e0b)',
      '--text-primary': '#1e1b4b', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.55)', '--glass-bg-hover': 'rgba(255,255,255,0.7)',
      '--glass-border': 'rgba(255,255,255,0.7)', '--glass-highlight': 'rgba(255,255,255,0.8)',
      '--glass-shadow': 'rgba(0,0,0,0.07)', '--surface': 'rgba(255,255,255,0.6)',
      '--branch-bg': 'rgba(168,85,247,0.12)', '--branch-color': '#7c3aed',
      '--remote-bg': 'rgba(13,148,136,0.12)', '--remote-color': '#0f766e',
      '--output-bg': 'rgba(20,16,56,0.78)', '--output-text': '#f3e8ff',
      '--output-placeholder': '#a78bfa',
      '--dropdown-bg': 'rgba(245,242,255,0.97)',
    },
  },
  {
    id: 'midnight', label: 'Midnight', swatch: '#4f46e5',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
      '--blob1': '#312e81', '--blob2': '#1e3a5f', '--blob3': '#302b5e',
      '--title-gradient': 'linear-gradient(135deg, #818cf8, #a78bfa, #c4b5fd)',
      '--text-primary': '#e2e8f0', '--text-muted': '#94a3b8', '--text-faint': '#a0abc0',
      '--glass-bg': 'rgba(255,255,255,0.08)', '--glass-bg-hover': 'rgba(255,255,255,0.14)',
      '--glass-border': 'rgba(255,255,255,0.15)', '--glass-highlight': 'rgba(255,255,255,0.14)',
      '--glass-shadow': 'rgba(0,0,0,0.4)', '--surface': 'rgba(255,255,255,0.09)',
      '--branch-bg': 'rgba(129,140,248,0.15)', '--branch-color': '#818cf8',
      '--remote-bg': 'rgba(45,212,191,0.14)', '--remote-color': '#5eead4',
      '--output-bg': 'rgba(0,0,0,0.55)', '--output-text': '#c7d2fe',
      '--output-placeholder': '#6366f1',
      '--dropdown-bg': 'rgba(18,16,48,0.97)',
    },
  },
  {
    id: 'forest', label: 'Forest', swatch: '#10b981',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 40%, #bfdbfe 100%)',
      '--blob1': '#6ee7b7', '--blob2': '#34d399', '--blob3': '#9fdcc0',
      '--title-gradient': 'linear-gradient(135deg, #059669, #0d9488, #06b6d4)',
      '--text-primary': '#064e3b', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.55)', '--glass-bg-hover': 'rgba(255,255,255,0.7)',
      '--glass-border': 'rgba(255,255,255,0.7)', '--glass-highlight': 'rgba(255,255,255,0.8)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.6)',
      '--branch-bg': 'rgba(16,185,129,0.12)', '--branch-color': '#059669',
      '--remote-bg': 'rgba(124,58,237,0.12)', '--remote-color': '#6d28d9',
      '--output-bg': 'rgba(4,50,38,0.8)', '--output-text': '#d1fae5',
      '--output-placeholder': '#34d399',
      '--dropdown-bg': 'rgba(236,253,245,0.97)',
    },
  },
  {
    id: 'sunset', label: 'Sunset', swatch: '#f97316',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 40%, #fecdd3 100%)',
      '--blob1': '#fdba74', '--blob2': '#fb923c', '--blob3': '#f6c39b',
      '--title-gradient': 'linear-gradient(135deg, #f97316, #ef4444, #ec4899)',
      '--text-primary': '#431407', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.58)', '--glass-bg-hover': 'rgba(255,255,255,0.72)',
      '--glass-border': 'rgba(255,255,255,0.72)', '--glass-highlight': 'rgba(255,255,255,0.82)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.62)',
      '--branch-bg': 'rgba(249,115,22,0.12)', '--branch-color': '#ea580c',
      '--remote-bg': 'rgba(37,99,235,0.12)', '--remote-color': '#2563eb',
      '--output-bg': 'rgba(50,15,5,0.8)', '--output-text': '#ffedd5',
      '--output-placeholder': '#fb923c',
      '--dropdown-bg': 'rgba(255,247,237,0.97)',
    },
  },
  {
    id: 'ocean', label: 'Ocean', swatch: '#0ea5e9',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 40%, #a5f3fc 100%)',
      '--blob1': '#7dd3fc', '--blob2': '#38bdf8', '--blob3': '#9bd4ed',
      '--title-gradient': 'linear-gradient(135deg, #0ea5e9, #06b6d4, #10b981)',
      '--text-primary': '#0c4a6e', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.58)', '--glass-bg-hover': 'rgba(255,255,255,0.72)',
      '--glass-border': 'rgba(255,255,255,0.72)', '--glass-highlight': 'rgba(255,255,255,0.82)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.62)',
      '--branch-bg': 'rgba(14,165,233,0.12)', '--branch-color': '#0284c7',
      '--remote-bg': 'rgba(190,24,93,0.11)', '--remote-color': '#be185d',
      '--output-bg': 'rgba(8,50,75,0.8)', '--output-text': '#e0f2fe',
      '--output-placeholder': '#38bdf8',
      '--dropdown-bg': 'rgba(240,249,255,0.97)',
    },
  },
];

const DARK_SURFACES = {
  '--text-primary': '#edf2fa', '--text-muted': '#bbc7d8', '--text-faint': '#9eabc0',
  '--glass-bg': 'rgba(255,255,255,0.05)', '--glass-bg-hover': 'rgba(255,255,255,0.1)',
  '--glass-border': 'rgba(255,255,255,0.14)', '--glass-highlight': 'rgba(255,255,255,0.1)',
  '--glass-shadow': 'rgba(0,0,0,0.45)', '--surface': 'rgba(255,255,255,0.04)',
  '--output-bg': 'rgba(0,0,0,0.55)', '--output-text': '#e2e8f0', '--output-placeholder': '#9eabc0',
};

const DARK_ACCENTS = {
  aurora: {
    '--bg-gradient': 'linear-gradient(135deg, #1e1028 0%, #1a1635 50%, #0e2035 100%)',
    '--blob1': '#5b2148', '--blob2': '#3b236d', '--blob3': '#2c254a',
    '--title-gradient': 'linear-gradient(135deg, #c4b5fd, #f9a8d4, #fcd34d)',
    '--branch-bg': 'rgba(196,181,253,0.15)', '--branch-color': '#c4b5fd',
    '--remote-bg': 'rgba(94,234,212,0.13)', '--remote-color': '#5eead4',
    '--dropdown-bg': 'rgba(25,20,41,0.98)',
  },
  midnight: {
    '--bg-gradient': 'linear-gradient(135deg, #0f0c29 0%, #25204f 50%, #18182d 100%)',
    '--blob1': '#312e81', '--blob2': '#1e3a5f', '--blob3': '#302b5e',
    '--title-gradient': 'linear-gradient(135deg, #a5b4fc, #c4b5fd, #ddd6fe)',
    '--branch-bg': 'rgba(165,180,252,0.15)', '--branch-color': '#a5b4fc',
    '--remote-bg': 'rgba(94,234,212,0.13)', '--remote-color': '#5eead4',
    '--dropdown-bg': 'rgba(18,16,48,0.98)',
  },
  forest: {
    '--bg-gradient': 'linear-gradient(135deg, #071e19 0%, #0d2b24 45%, #10263b 100%)',
    '--blob1': '#0e4936', '--blob2': '#0c5145', '--blob3': '#174034',
    '--title-gradient': 'linear-gradient(135deg, #6ee7b7, #5eead4, #67e8f9)',
    '--branch-bg': 'rgba(110,231,183,0.14)', '--branch-color': '#6ee7b7',
    '--remote-bg': 'rgba(196,181,253,0.14)', '--remote-color': '#c4b5fd',
    '--dropdown-bg': 'rgba(10,29,25,0.98)',
  },
  sunset: {
    '--bg-gradient': 'linear-gradient(135deg, #27150d 0%, #321c20 45%, #26162e 100%)',
    '--blob1': '#68341d', '--blob2': '#632a2b', '--blob3': '#4a2a20',
    '--title-gradient': 'linear-gradient(135deg, #fdba74, #fca5a5, #f9a8d4)',
    '--branch-bg': 'rgba(253,186,116,0.15)', '--branch-color': '#fdba74',
    '--remote-bg': 'rgba(147,197,253,0.14)', '--remote-color': '#93c5fd',
    '--dropdown-bg': 'rgba(36,22,23,0.98)',
  },
  ocean: {
    '--bg-gradient': 'linear-gradient(135deg, #071a2b 0%, #0b293b 45%, #092d32 100%)',
    '--blob1': '#0b3d60', '--blob2': '#105366', '--blob3': '#153e50',
    '--title-gradient': 'linear-gradient(135deg, #7dd3fc, #67e8f9, #6ee7b7)',
    '--branch-bg': 'rgba(125,211,252,0.14)', '--branch-color': '#7dd3fc',
    '--remote-bg': 'rgba(253,164,175,0.14)', '--remote-color': '#fda4af',
    '--dropdown-bg': 'rgba(10,25,37,0.98)',
  },
};

const MIDNIGHT_LIGHT = {
  '--bg-gradient': 'linear-gradient(135deg, #e0e7ff 0%, #ddd6fe 50%, #dbeafe 100%)',
  '--blob1': '#a5b4fc', '--blob2': '#93c5fd', '--blob3': '#c3c9ed',
  '--title-gradient': 'linear-gradient(135deg, #4f46e5, #7c3aed, #6366f1)',
  '--text-primary': '#1e1b4b', '--text-muted': '#626d82', '--text-faint': '#7c879b',
  '--glass-bg': 'rgba(255,255,255,0.55)', '--glass-bg-hover': 'rgba(255,255,255,0.7)',
  '--glass-border': 'rgba(255,255,255,0.7)', '--glass-highlight': 'rgba(255,255,255,0.8)',
  '--glass-shadow': 'rgba(0,0,0,0.07)', '--surface': 'rgba(255,255,255,0.6)',
  '--branch-bg': 'rgba(79,70,229,0.12)', '--branch-color': '#4f46e5',
  '--remote-bg': 'rgba(13,148,136,0.12)', '--remote-color': '#0f766e',
  '--output-bg': 'rgba(18,16,48,0.8)', '--output-text': '#c7d2fe',
  '--output-placeholder': '#a5b4fc', '--dropdown-bg': 'rgba(238,242,255,0.97)',
};

export function savedDarkMode(theme, value) {
  return typeof value === 'boolean' ? value : theme.id === 'midnight';
}

export function themeVariables(theme, darkMode = false) {
  return {
    ...theme.vars,
    ...(!darkMode && theme.id === 'midnight' ? MIDNIGHT_LIGHT : {}),
    ...(darkMode ? { ...DARK_SURFACES, ...DARK_ACCENTS[theme.id] } : {}),
    '--danger-color': darkMode ? '#fca5a5' : '#dc2626',
    '--warning-color': darkMode ? '#fcd34d' : '#b45309',
    '--success-color': darkMode ? '#86efac' : '#15803d',
    '--diff-removed-color': darkMode ? '#fca5a5' : '#b91c1c',
    '--diff-added-bg': darkMode ? 'rgba(34,197,94,0.13)' : 'rgba(34,197,94,0.09)',
    '--diff-removed-bg': darkMode ? 'rgba(248,113,113,0.13)' : 'rgba(239,68,68,0.09)',
    '--untracked-color': darkMode ? '#c4b5fd' : '#7c3aed',
    '--toggle-bg': darkMode ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
    '--tab-inactive-opacity': darkMode ? '0.78' : '0.4',
    '--tab-hover-opacity': darkMode ? '0.95' : '0.7',
    '--graph-teal': darkMode ? '#2dd4bf' : '#0d9488',
    '--graph-blue': darkMode ? '#93c5fd' : '#3b82f6',
    '--graph-amber': darkMode ? '#fbbf24' : '#d97706',
    '--graph-pink': darkMode ? '#f9a8d4' : '#db2777',
    '--graph-slate': darkMode ? '#94a3b8' : '#64748b',
  };
}
