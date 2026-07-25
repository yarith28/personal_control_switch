import { projectsEl } from './dom.js';
import { edgeScrollSpeed } from './drag-scroll-speed.mjs';

let internalDragActive = false;
let pointerY = null;
let animationFrame = null;

function stopAnimation() {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  pointerY = null;
}

function animate() {
  animationFrame = null;
  if (!internalDragActive || pointerY === null) return;

  const { top, bottom } = projectsEl.getBoundingClientRect();
  const speed = edgeScrollSpeed(pointerY, top, bottom);
  if (speed === 0) return;

  const maxScrollTop = Math.max(0, projectsEl.scrollHeight - projectsEl.clientHeight);
  projectsEl.scrollTop = Math.max(0, Math.min(maxScrollTop, projectsEl.scrollTop + speed));
  animationFrame = requestAnimationFrame(animate);
}

function updatePointer(clientY) {
  pointerY = clientY;
  if (animationFrame === null) animationFrame = requestAnimationFrame(animate);
}

export function startDragAutoScroll() {
  internalDragActive = true;
}

export function stopDragAutoScroll() {
  internalDragActive = false;
  stopAnimation();
}

export function setupDragAutoScroll() {
  projectsEl.addEventListener('dragover', (event) => {
    if (!internalDragActive) return;
    updatePointer(event.clientY);
  });

  document.addEventListener('dragover', (event) => {
    if (!internalDragActive || projectsEl.contains(event.target)) return;
    stopAnimation();
  }, true);

  document.addEventListener('drop', stopDragAutoScroll, true);
  document.addEventListener('dragend', stopDragAutoScroll, true);
  window.addEventListener('blur', stopDragAutoScroll);
}
