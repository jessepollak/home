"""Build-time only. Python standard library; never downloads data at runtime.

python3 generate-globe-assets.py /path/to/ne_110m_land.geojson \
  /path/to/ne_10m_admin_0_countries.geojson

Source/version/license and reproducible download URLs: GEOGRAPHY.md.
"""
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
land, countries = (json.loads(Path(p).read_text()) for p in sys.argv[1:])
polygons = []
for feature in land["features"]:
    geometry = feature["geometry"]
    parts = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    for rings in parts:
        outer = rings[0]
        bounds = (min(p[0] for p in outer), min(p[1] for p in outer), max(p[0] for p in outer), max(p[1] for p in outer))
        polygons.append((bounds, rings))


def in_ring(x, y, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        ax, ay = previous
        bx, by = current
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
        previous = current
    return inside


def on_land(x, y):
    for (left, bottom, right, top), rings in polygons:
        if left <= x <= right and bottom <= y <= top and in_ring(x, y, rings[0]):
            if not any(in_ring(x, y, hole) for hole in rings[1:]):
                return True
    return False


# Approximately equal-area rows; longitude count shrinks toward each pole.
# Staggered rows avoid a strong meridian grid. No antimeridian seam/duplicate.
points = []
for row in range(144):
    lat = -89.375 + row * 1.25
    count = max(1, round(288 * math.cos(math.radians(lat))))
    for column in range(count):
        lon = -180 + (column + (0.5 if row % 2 else 0)) * 360 / count
        if on_land(lon, lat):
            points.extend([round(lon, 3), round(lat, 3)])
(ROOT / "globe-land-points.json").write_text(json.dumps(points, separators=(",", ":")) + "\n")

# Natural Earth label points are better than polygon centroids for islands and
# overseas territories. Prefer the main country over dependencies/disputed land.
positions = {}
priority = {"Sovereign country": 0, "Country": 0, "Sovereignty": 0}
for feature in sorted(countries["features"], key=lambda f: priority.get(f["properties"]["TYPE"], 1)):
    p = feature["properties"]
    code = p["ISO_A2_EH"]
    if len(code) == 2 and code not in positions:
        positions[code] = [round(p["LABEL_X"], 5), round(p["LABEL_Y"], 5)]
(ROOT / "globe-country-coordinates.json").write_text(json.dumps(dict(sorted(positions.items())), indent=2) + "\n")

# Same projection/starting orientation as globe-geometry.ts and the renderer.
# The fallback has no supported-country data baked in; live config supplies it.
svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
       '<defs><radialGradient id="s" cx="32%" cy="26%" r="78%"><stop stop-color="#fcfdff"/><stop offset=".48" stop-color="#f1f4f8"/><stop offset=".8" stop-color="#e0e7ef"/><stop offset="1" stop-color="#cbd5e1"/></radialGradient></defs>',
       '<circle cx="50" cy="50" r="44" fill="url(#s)"/>', '<g fill="none" stroke="#8295ad" stroke-width=".38" stroke-linecap="round">']
paths = [[] for _ in range(5)]
for i in range(0, len(points), 2):
    lon, lat = math.radians(points[i] + 28), math.radians(points[i + 1])
    x, y, z = math.cos(lat) * math.sin(lon), math.sin(lat), math.cos(lat) * math.cos(lon)
    tilt = math.radians(12)
    sy, depth = y * math.cos(tilt) - z * math.sin(tilt), y * math.sin(tilt) + z * math.cos(tilt)
    if depth > .025:
        paths[min(4, int(depth * 5))].append(f'M{50 + 44 * x:.2f},{50 - 44 * sy:.2f}h.001')
for index, path in enumerate(paths):
    svg.append(f'<path opacity="{.36 + index * .076:.3f}" d="{"".join(path)}"/>')
svg.extend(['</g>', '</svg>'])
(ROOT / "globe-static.svg").write_text("".join(svg) + "\n")
print(f"Generated {len(points) // 2} land dots and {len(positions)} country coordinates.")
