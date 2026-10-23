"""Independent exact rational line-parameter oracle for bounded simple rings."""
import json
import sys
from fractions import Fraction as F


def simple(raw):
    p = [tuple(F.from_float(float(v)) for v in point) for point in raw]
    n = len(p)
    if len(set(p)) != n or not 3 <= n <= 64:
        return False
    cross = lambda a, b: a[0] * b[1] - a[1] * b[0]
    sub = lambda a, b: (a[0] - b[0], a[1] - b[1])
    if sum(cross(sub(p[i], p[0]), sub(p[i + 1], p[0])) for i in range(1, n - 1)) == 0:
        return False
    for i in range(n):
        a, b = p[i], p[(i + 1) % n]
        r = sub(b, a)
        for j in range(i + 1, n):
            c, d = p[j], p[(j + 1) % n]
            s, q = sub(d, c), sub(c, a)
            den = cross(r, s)
            adjacent = j == i + 1 or (i == 0 and j == n - 1)
            if den:
                t, u = cross(q, s) / den, cross(q, r) / den
                if 0 <= t <= 1 and 0 <= u <= 1 and not adjacent:
                    return False
            elif cross(q, r) == 0:
                axis = 0 if r[0] else 1
                t, u = (c[axis] - a[axis]) / r[axis], (d[axis] - a[axis]) / r[axis]
                low, high = max(F(0), min(t, u)), min(F(1), max(t, u))
                if low < high or (low == high and not adjacent):
                    return False
    return True

print(json.dumps([simple(p) for p in json.load(sys.stdin)]))
