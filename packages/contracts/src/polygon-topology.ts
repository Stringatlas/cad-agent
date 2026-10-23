/** Exact topology of binary64 coordinates on the integer lattice 2^-1074.
 * No tolerance, division, coordinate snapping or floating determinant is involved.
 * With <=64 bounded vertices, <=2,016 edge pairs and <=1,100-bit coordinate differences (<=2,200-bit products) are bounded.
 */
export class PolygonTopologyError extends TypeError {}
type ExactPoint = readonly [bigint, bigint];
function integerCoordinate(value: number): bigint {
  const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value);
  const bits = bytes.getBigUint64(0), exponent = Number(bits >> 52n & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  const magnitude = exponent === 0 ? fraction : ((1n << 52n) | fraction) << BigInt(exponent - 1);
  return bits >> 63n ? -magnitude : magnitude;
}
function turn(a: ExactPoint, b: ExactPoint, c: ExactPoint): bigint {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function between(a: ExactPoint, b: ExactPoint, p: ExactPoint): boolean {
  return (p[0] - a[0]) * (p[0] - b[0]) <= 0n && (p[1] - a[1]) * (p[1] - b[1]) <= 0n;
}
function intersects(a: ExactPoint, b: ExactPoint, c: ExactPoint, d: ExactPoint): boolean {
  const abC = turn(a, b, c), abD = turn(a, b, d), cdA = turn(c, d, a), cdB = turn(c, d, b);
  if (abC === 0n && between(a, b, c) || abD === 0n && between(a, b, d) || cdA === 0n && between(c, d, a) || cdB === 0n && between(c, d, b)) return true;
  return (abC < 0n && abD > 0n || abC > 0n && abD < 0n) && (cdA < 0n && cdB > 0n || cdA > 0n && cdB < 0n);
}
/** Caller validates finite/range/count first. Collinear forward edges are valid. */
export function assertSimplePolygon(vertices: readonly (readonly [number, number])[]): void {
  const points = vertices.map(([x, y]) => [integerCoordinate(x), integerCoordinate(y)] as const), n = points.length;
  let area = 0n;
  for (let i = 0; i < n; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!, c = points[(i + 2) % n]!;
    for (let j = i + 1; j < n; j++) if (a[0] === points[j]![0] && a[1] === points[j]![1]) throw new PolygonTopologyError('Repeated polygon vertex');
    area += a[0] * b[1] - a[1] * b[0];
    if (turn(a, b, c) === 0n && !between(a, c, b)) throw new PolygonTopologyError('Overlapping adjacent polygon edges');
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (intersects(a, b, points[j]!, points[(j + 1) % n]!)) throw new PolygonTopologyError('Intersecting polygon edges');
    }
  }
  if (area === 0n) throw new PolygonTopologyError('Zero area polygon');
}
