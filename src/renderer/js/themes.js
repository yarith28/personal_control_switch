import { state } from './state.js';
import { persist } from './persist.js';

export const THEMES = [
  {
    id: 'aurora', label: 'Aurora', swatch: '#c4b5fd',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #fce7f3 0%, #ede9fe 50%, #dbeafe 100%)',
      '--blob1': '#f9a8d4', '--blob2': '#c4b5fd', '--blob3': '#93c5fd',
      '--title-gradient': 'linear-gradient(135deg, #a855f7, #ec4899, #f59e0b)',
      '--text-primary': '#1e1b4b', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.55)', '--glass-bg-hover': 'rgba(255,255,255,0.7)',
      '--glass-border': 'rgba(255,255,255,0.7)', '--glass-highlight': 'rgba(255,255,255,0.8)',
      '--glass-shadow': 'rgba(0,0,0,0.07)', '--surface': 'rgba(255,255,255,0.6)',
      '--branch-bg': 'rgba(168,85,247,0.12)', '--branch-color': '#7c3aed',
      '--output-bg': 'rgba(20,16,56,0.78)', '--output-text': '#f3e8ff',
      '--output-placeholder': '#a78bfa',
      '--dropdown-bg': 'rgba(245,242,255,0.97)',
    },
  },
  {
    id: 'midnight', label: 'Midnight', swatch: '#4f46e5',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
      '--blob1': '#312e81', '--blob2': '#1e3a5f', '--blob3': '#4c1d95',
      '--title-gradient': 'linear-gradient(135deg, #818cf8, #a78bfa, #c4b5fd)',
      '--text-primary': '#e2e8f0', '--text-muted': '#94a3b8', '--text-faint': '#64748b',
      '--glass-bg': 'rgba(255,255,255,0.08)', '--glass-bg-hover': 'rgba(255,255,255,0.14)',
      '--glass-border': 'rgba(255,255,255,0.15)', '--glass-highlight': 'rgba(255,255,255,0.14)',
      '--glass-shadow': 'rgba(0,0,0,0.4)', '--surface': 'rgba(255,255,255,0.09)',
      '--branch-bg': 'rgba(129,140,248,0.15)', '--branch-color': '#818cf8',
      '--output-bg': 'rgba(0,0,0,0.55)', '--output-text': '#c7d2fe',
      '--output-placeholder': '#6366f1',
      '--dropdown-bg': 'rgba(18,16,48,0.97)',
    },
  },
  {
    id: 'forest', label: 'Forest', swatch: '#10b981',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 40%, #bfdbfe 100%)',
      '--blob1': '#6ee7b7', '--blob2': '#34d399', '--blob3': '#93c5fd',
      '--title-gradient': 'linear-gradient(135deg, #059669, #0d9488, #06b6d4)',
      '--text-primary': '#064e3b', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.55)', '--glass-bg-hover': 'rgba(255,255,255,0.7)',
      '--glass-border': 'rgba(255,255,255,0.7)', '--glass-highlight': 'rgba(255,255,255,0.8)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.6)',
      '--branch-bg': 'rgba(16,185,129,0.12)', '--branch-color': '#059669',
      '--output-bg': 'rgba(4,50,38,0.8)', '--output-text': '#d1fae5',
      '--output-placeholder': '#34d399',
      '--dropdown-bg': 'rgba(236,253,245,0.97)',
    },
  },
  {
    id: 'sunset', label: 'Sunset', swatch: '#f97316',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 40%, #fecdd3 100%)',
      '--blob1': '#fdba74', '--blob2': '#fb923c', '--blob3': '#fda4af',
      '--title-gradient': 'linear-gradient(135deg, #f97316, #ef4444, #ec4899)',
      '--text-primary': '#431407', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.58)', '--glass-bg-hover': 'rgba(255,255,255,0.72)',
      '--glass-border': 'rgba(255,255,255,0.72)', '--glass-highlight': 'rgba(255,255,255,0.82)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.62)',
      '--branch-bg': 'rgba(249,115,22,0.12)', '--branch-color': '#ea580c',
      '--output-bg': 'rgba(50,15,5,0.8)', '--output-text': '#ffedd5',
      '--output-placeholder': '#fb923c',
      '--dropdown-bg': 'rgba(255,247,237,0.97)',
    },
  },
  {
    id: 'ocean', label: 'Ocean', swatch: '#0ea5e9',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 40%, #a5f3fc 100%)',
      '--blob1': '#7dd3fc', '--blob2': '#38bdf8', '--blob3': '#67e8f9',
      '--title-gradient': 'linear-gradient(135deg, #0ea5e9, #06b6d4, #10b981)',
      '--text-primary': '#0c4a6e', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.58)', '--glass-bg-hover': 'rgba(255,255,255,0.72)',
      '--glass-border': 'rgba(255,255,255,0.72)', '--glass-highlight': 'rgba(255,255,255,0.82)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.62)',
      '--branch-bg': 'rgba(14,165,233,0.12)', '--branch-color': '#0284c7',
      '--output-bg': 'rgba(8,50,75,0.8)', '--output-text': '#e0f2fe',
      '--output-placeholder': '#38bdf8',
      '--dropdown-bg': 'rgba(240,249,255,0.97)',
    },
  },
];

export function applyTheme(theme) {
  const root = document.documentElement;
  for (const [p, v] of Object.entries(theme.vars)) root.style.setProperty(p, v);
  state.currentTheme = theme;
  document.querySelectorAll('.swatch').forEach((el) =>
    el.classList.toggle('active', el.dataset.id === theme.id)
  );
}

export function buildSwatches() {
  const container = document.getElementById('theme-swatches');
  container.innerHTML = '';
  for (const theme of THEMES) {
    const dot = document.createElement('button');
    dot.className = 'swatch' + (theme.id === state.currentTheme.id ? ' active' : '');
    dot.style.background = theme.swatch;
    dot.dataset.id = theme.id;
    dot.title = theme.label;
    dot.addEventListener('click', async (e) => {
      e.stopPropagation();
      applyTheme(theme);
      await persist();
    });
    container.appendChild(dot);
  }
}
