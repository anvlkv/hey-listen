/**
 * Edge geometry for the graph editor's drop-to-insert gesture.
 *
 * solid-flow draws its default edges as cubic beziers between the source (right) and
 * target (left) handles. These helpers reproduce that path and measure how close a
 * point is to it, so a dropped node can be spliced into the nearest connector.
 */

/** A point in flow coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** `@xyflow/system`'s control-point offset for its default (0.25 curvature) bezier. */
function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance);
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Sample the source→target bezier (Right → Left) into `samples + 1` points. */
export function bezierPoints(source: Point, target: Point, samples = 24): Point[] {
  const dx = target.x - source.x;
  const offset = controlOffset(dx);
  const control1 = { x: source.x + offset, y: source.y };
  const control2 = { x: target.x - offset, y: target.y };
  const points: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    points.push(cubicAt(source, control1, control2, target, i / samples));
  }
  return points;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** The shortest distance from `point` to the polyline `points`. */
export function distanceToPolyline(point: Point, points: Point[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    min = Math.min(min, distanceToSegment(point, points[i], points[i + 1]));
  }
  return min;
}
