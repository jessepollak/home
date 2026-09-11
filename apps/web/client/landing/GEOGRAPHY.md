# Globe geography and license notice

**Made with Natural Earth.** Natural Earth map data is **public domain**: all
versions may be used, modified and redistributed for any purpose. No user images,
photographs, account data, financial figures, avatars, or logo artwork are used.

- Terms: https://www.naturalearthdata.com/about/terms-of-use/
- Source release: **Natural Earth v5.1.2**, maintained at
  https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2
- Land: `geojson/ne_110m_land.geojson` (1:110 million).
- Country label coordinates: `geojson/ne_10m_admin_0_countries.geojson`
  (1:10 million), properties `ISO_A2_EH`, `LABEL_X`, `LABEL_Y`, `TYPE`.

## Derived assets

`globe-land-points.json` contains 7,623 longitude/latitude samples inside the
sourced land polygons, respecting polygon holes. Rows are staggered and spaced
approximately equally on the sphere; fewer samples are taken near the poles.
Longitude wraps continuously. This is an intentionally simplified land silhouette,
not a political boundary map. Small islands may not have land dots at this scale.

`globe-static.svg` projects the same samples into the initial orthographic view
(center longitude −28°, latitude 12°). It contains **no baked-in support markers**;
the React component overlays current profile markers in both static and WebGL modes.

`globe-country-coordinates.json` contains 239 Natural Earth alpha-2 label points.
Main countries take precedence over dependencies sharing a code (notably mainland
France, Brazil, Australia, and Kazakhstan). These are cartographic label positions,
not capitals, funding locations, or service coverage centroids. They avoid common
polygon-centroid mistakes with overseas territories and island groups. The table
also preserves Natural Earth's user-assigned `XK` code; it is not an official ISO
assignment. This table is geographic reference data, **not a support list**.

All current configured profiles must have a sourced position; the retained test
asserts that invariant and automatically follows `regionIds`/`presentationRegions`.
It separately checks the 21 euro-area members including Bulgaria (2026), Malta,
Cyprus and Luxembourg. New profiles outside this source table need a sourced
coordinate addition before integration. Unknown explicit codes are never given
fabricated locations.

## Rebuild (development only)

Python 3 standard library only. Run from the repository root:

```sh
mkdir -p /tmp/home-globe-geography
curl -fL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson \
  -o /tmp/home-globe-geography/land.geojson
curl -fL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson \
  -o /tmp/home-globe-geography/countries.geojson
python3 apps/web/client/landing/generate-globe-assets.py \
  /tmp/home-globe-geography/land.geojson /tmp/home-globe-geography/countries.geojson
```

Source SHA-256 checksums:

- Land: `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`
- Countries: `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255`

The 13 MB upstream country geometry is build-time source material only and is not
vendored or shipped. All rendered assets are local and cacheable; there are no
external runtime asset requests or geographic service calls.
