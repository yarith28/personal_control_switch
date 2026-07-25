const DEFAULT_EDGE_SIZE = 72;
const DEFAULT_MIN_SPEED = 3;
const DEFAULT_MAX_SPEED = 18;

export function edgeScrollSpeed(
  pointerY,
  top,
  bottom,
  {
    edgeSize = DEFAULT_EDGE_SIZE,
    minSpeed = DEFAULT_MIN_SPEED,
    maxSpeed = DEFAULT_MAX_SPEED,
  } = {},
) {
  const height = bottom - top;
  if (height <= 0 || pointerY < top || pointerY > bottom) return 0;

  const edge = Math.min(edgeSize, height / 2);
  if (pointerY < top + edge) {
    const proximity = 1 - ((pointerY - top) / edge);
    return -Math.ceil(minSpeed + ((maxSpeed - minSpeed) * proximity));
  }

  if (pointerY > bottom - edge) {
    const proximity = 1 - ((bottom - pointerY) / edge);
    return Math.ceil(minSpeed + ((maxSpeed - minSpeed) * proximity));
  }

  return 0;
}
