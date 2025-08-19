// src/geoPlacement.js
// Rectangle/patch-based, country-safe placement (no polygons).

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.39996

// -------- Helpers: tiny PRNG + units ----------
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function metersToDegrees(lat, dxMeters, dyMeters) {
  const dLat = dyMeters / 111111;
  const dLon = dxMeters / (111111 * Math.cos(lat * Math.PI / 180) || 1e-6);
  return { dLat, dLon };
}

// ---------- Rect utilities ----------
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const insideRect = (lat, lon, rect) =>
  lat >= rect.lat[0] && lat <= rect.lat[1] && lon >= rect.lon[0] && lon <= rect.lon[1];

function insetRect(rect, pct = 0.05) {
  const latSpan = rect.lat[1] - rect.lat[0];
  const lonSpan = rect.lon[1] - rect.lon[0];
  const padLat = latSpan * pct;
  const padLon = lonSpan * pct;
  return {
    lat: [rect.lat[0] + padLat, rect.lat[1] - padLat],
    lon: [rect.lon[0] + padLon, rect.lon[1] - padLon],
  };
}
function clampToRect(lat, lon, rect) {
  return {
    lat: clamp(lat, rect.lat[0], rect.lat[1]),
    lon: clamp(lon, rect.lon[0], rect.lon[1]),
  };
}
function rectDist2(lat, lon, rect) {
  // 0 if inside; else squared distance to the rectangle (deg^2 – fine for ranking)
  let dy = 0, dx = 0;
  if (lat < rect.lat[0]) dy = rect.lat[0] - lat;
  else if (lat > rect.lat[1]) dy = lat - rect.lat[1];
  if (lon < rect.lon[0]) dx = rect.lon[0] - lon;
  else if (lon > rect.lon[1]) dx = lon - rect.lon[1];
  return dx*dx + dy*dy;
}
function insideAny(lat, lon, rects) {
  for (const r of rects) if (insideRect(lat, lon, r)) return true;
  return false;
}
function clampToBestRect(lat, lon, rects) {
  let best = rects[0], bestD = Infinity;
  for (const r of rects) {
    const d = rectDist2(lat, lon, r);
    if (d < bestD) { bestD = d; best = r; }
  }
  return clampToRect(lat, lon, best);
}

// Spiral within a specific rect (keeps point inside)
function spiralWithinRect(centerLat, centerLon, rect, n, base = 380, step = 240) {
  let r = base + n * step;
  let theta = n * GOLDEN_ANGLE;
  for (let tries = 0; tries < 12; tries++) {
    const dx = Math.cos(theta) * r;
    const dy = Math.sin(theta) * r;
    const { dLat, dLon } = metersToDegrees(centerLat, dx, dy);
    const lat = centerLat + dLat;
    const lon = centerLon + dLon;
    if (insideRect(lat, lon, rect)) return { lat, lon };
    r *= 0.62;
    theta += GOLDEN_ANGLE * 1.15;
  }
  return clampToRect(centerLat, centerLon, rect);
}

// Choose a stable point from a country’s patch list
function pickCountryPatchPoint(country, seedStr) {
  const def = countryBounds[country];
  if (!def) return null;

  const patches = (def.patches && def.patches.length) ? def.patches : [ { lat:def.lat, lon:def.lon } ];
  // Slightly inset each patch to avoid coastlines
  const zones = patches.map(p => insetRect(p, p.insetPct ?? def.insetPct ?? 0.04));

  const rnd = mulberry32(hash32(String(seedStr || country)));
  const idx = zones.length > 1 ? Math.floor(rnd() * zones.length) : 0;
  const z = zones[idx];

  const lat = z.lat[0] + rnd() * (z.lat[1] - z.lat[0]);
  const lon = z.lon[0] + rnd() * (z.lon[1] - z.lon[0]);
  return clampToRect(lat, lon, z);
}

// ---------- MAIN API ----------
/**
 * Place all article points using *patch unions* per country.
 * If a country has patches, we consider the union of those patches as the only safe zones.
 * Otherwise we fall back to the big country rect (inset).
 */
export function placeArticles(items) {
  if (!Array.isArray(items) || items.length === 0) return items || [];

  // Pre-group by same coord per-country for duplicate spreading
  const buckets = new Map(); // key -> indices[]
  const keyFor = (a) =>
    `${a.country || "?"}|${Number(a.lat).toFixed(3)},${Number(a.lon).toFixed(3)}`;
  items.forEach((a, idx) => {
    if (!a || !a.country) return;
    const k = keyFor(a);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(idx);
  });

  const COUNTRY_DUP_THRESHOLD = 3;

  return items.map((a, idx) => {
    if (!a || !a.country || !(a.country in countryBounds)) return { ...a };

    const def = countryBounds[a.country];

    // Build safe zones: prefer patches if present
    let zones = (def.patches && def.patches.length)
      ? def.patches.map(p => insetRect(p, p.insetPct ?? def.insetPct ?? 0.04))
      : [ insetRect({ lat:def.lat, lon:def.lon }, def.insetPct ?? 0.04) ];

    const missing =
      !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || (a.lat === 0 && a.lon === 0);

    const bucket = buckets.get(keyFor(a)) || [];
    const localIndex = bucket.indexOf(idx);
    const groupSize = bucket.length;
    const seed = a.id || a.url || a.title || `${idx}`;

    let lat = a.lat, lon = a.lon;

    // (1) Missing coords OR far outside any safe zone OR heavy duplicate cluster:
    if (missing || !insideAny(lat, lon, zones) || groupSize >= COUNTRY_DUP_THRESHOLD) {
      const pt = pickCountryPatchPoint(a.country, `${seed}#${localIndex}`);
      if (pt) ({ lat, lon } = pt);
      return { ...a, lat, lon };
    }

    // (2) If inside country but *not* inside any patch (can happen when no patches):
    if (!insideAny(lat, lon, zones)) {
      ({ lat, lon } = clampToBestRect(lat, lon, zones));
      return { ...a, lat, lon };
    }

    // (3) Modest duplicates: spiral *within the closest zone*
    if (groupSize > 1 && localIndex >= 0) {
      // Pick the best (closest) zone to the point
      let best = zones[0], bestD = Infinity;
      for (const z of zones) {
        const d = rectDist2(lat, lon, z);
        if (d < bestD) { bestD = d; best = z; }
      }
      const center = clampToRect(lat, lon, best);
      const pt = spiralWithinRect(center.lat, center.lon, best, localIndex);
      return { ...a, lat: pt.lat, lon: pt.lon };
    }

    // (4) Single item inside: keep but clamp to the nearest zone (stays in land band)
    ({ lat, lon } = clampToBestRect(lat, lon, zones));
    return { ...a, lat, lon };
  });
}

// -------- Country “safe rectangles” (coast-aware patches) --------
// NOTE: These are *approximate* but tuned to avoid open water.
// Add/adjust patches for countries you care most about.
// Tip: smaller, multiple patches > one big rectangle for coastal nations.
const countryBounds = {
  // ---- South Asia ----
  India: {
    lat: [6, 35], lon: [68, 97],
    insetPct: 0.04,
    patches: [
      { lat:[8, 21],  lon:[73, 78] },   // west peninsular
      { lat:[10, 20], lon:[78, 84] },   // central peninsular
      { lat:[15, 22], lon:[72, 76] },   // MH/GJ/GOA belt
      { lat:[22, 28], lon:[73, 84] },   // MP/UP/Bihar belt
      { lat:[26, 32], lon:[74, 79] },   // north-west plains
      { lat:[11, 13.5], lon:[76, 80] }, // TN
      { lat:[17, 19.5], lon:[81, 85] }, // AP/OD
      { lat:[23, 27], lon:[88, 92] },   // NE hills (coarsely)
    ],
  },
  Pakistan: {
    lat:[23.7,37.1], lon:[60.9,77.0],
    patches: [
      { lat:[24.5,28.0], lon:[66,70] },     // Sindh inland
      { lat:[28.0,33.0], lon:[69,73] },     // Punjab
      { lat:[31.0,35.5], lon:[71,74.5] },   // KP/upper Punjab
      { lat:[26.0,30.0], lon:[62.8,67.5] }, // Balochistan inland
    ],
  },
  Bangladesh: {
    lat:[20.6,26.7], lon:[88.0,92.7],
    patches: [
      { lat:[22.2,24.5], lon:[89.0,91.0] },
      { lat:[24.0,26.2], lon:[90.0,92.3] },
    ],
  },
  "Sri Lanka": {
    lat:[5.7,10.0], lon:[79.5,82.1],
    patches: [
      { lat:[6.2,9.4], lon:[79.9,81.9] },
    ],
  },
  Nepal: {
    lat:[26.3,30.5], lon:[80.0,88.5],
    patches: [
      { lat:[27.0,29.3], lon:[81.0,86.5] },
    ],
  },
  Bhutan: {
    lat:[26.6,28.4], lon:[88.7,92.2],
    patches: [
      { lat:[26.8,28.2], lon:[89.0,91.8] },
    ],
  },

  // ---- East Asia ----
  China: {
    lat:[18.1,53.6], lon:[73.5,134.8],
    patches: [
      { lat:[22, 27], lon:[110,116] },      // South coast belt
      { lat:[28, 36], lon:[105,118] },      // Central/East
      { lat:[36, 45], lon:[110,126] },      // North/Northeast
      { lat:[30, 33], lon:[120,123] },      // Shanghai/Jiangsu-Zhejiang
    ],
  },
  Japan: {
    lat:[24.0,45.7], lon:[122.9,145.9],
    patches: [
      { lat:[34.0,36.5], lon:[135.0,139.5] }, // Kansai-Tokai
      { lat:[35.2,36.2], lon:[139.2,140.8] }, // Tokyo-Kanto
      { lat:[34.3,35.6], lon:[132.0,135.0] }, // Chugoku
      { lat:[33.0,34.8], lon:[129.0,131.0] }, // Kyushu N
      { lat:[43.0,44.7], lon:[141.0,143.0] }, // Hokkaido S
      { lat:[34.1,34.6], lon:[134.0,134.7] }, // Shikoku
    ],
  },
  "South Korea": {
    lat:[33.0,38.6], lon:[124.6,131.9],
    patches: [
      { lat:[35.0,37.8], lon:[126.8,129.5] }, // Mainland belt
      { lat:[33.1,33.6], lon:[126.1,126.9] }, // Jeju
    ],
  },
  Taiwan: {
    lat:[21.7,25.4], lon:[119.9,122.2],
    patches: [
      { lat:[22.5,25.1], lon:[120.1,122.0] },
    ],
  },

  // ---- SE Asia ----
  Indonesia: {
    lat:[-11.2,6.4], lon:[95.0,141.0],
    patches: [
      { lat:[-8.2,-6.0], lon:[107.0,113.0] }, // Java W-C
      { lat:[-7.8,-6.8], lon:[112.0,114.9] }, // Java E
      { lat:[-3.5, 0.5], lon:[102.0,106.0] }, // Sumatra S
      { lat:[-2.0, 1.5], lon:[106.0,112.0] }, // Sumatra C
      { lat:[-2.0, 1.5], lon:[112.0,115.0] }, // Kalimantan S
      { lat:[-5.5,-1.5], lon:[119.0,121.8] }, // Sulawesi S
      { lat:[-8.9,-7.8], lon:[114.5,116.0] }, // Bali-Lombok
    ],
  },
  Philippines: {
    lat:[4.4,21.3], lon:[116.9,126.6],
    patches: [
      { lat:[14.4,16.0], lon:[120.6,122.0] }, // Luzon S
      { lat:[10.0,11.9], lon:[122.3,124.2] }, // Visayas
      { lat:[6.5, 8.5], lon:[124.0,126.2] },  // Mindanao N-E
    ],
  },
  Vietnam: {
    lat:[8.3,23.4], lon:[102.1,109.6],
    patches: [
      { lat:[10.3,11.5], lon:[106.2,107.5] }, // HCMC area
      { lat:[16.0,17.6], lon:[107.5,109.0] }, // Central coast
      { lat:[20.4,21.7], lon:[105.4,106.8] }, // Hanoi/Red River
    ],
  },
  Thailand: {
    lat:[5.5,20.5], lon:[97.3,105.7],
    patches: [
      { lat:[13.0,15.5], lon:[100.2,101.5] }, // BKK/Central
      { lat:[16.0,18.2], lon:[100.2,102.0] }, // North
      { lat:[7.0, 9.0],  lon:[98.8,100.4] },  // South isthmus
    ],
  },
  Malaysia: {
    lat:[0.8,7.5], lon:[99.6,104.7], // (Peninsular only here)
    patches: [
      { lat:[2.5,4.8], lon:[101.5,103.5] },  // KL/central
      { lat:[5.1,6.8], lon:[100.2,102.0] },  // North
    ],
  },
  Singapore: {
    lat:[1.16,1.49], lon:[103.57,103.99],
    insetPct: 0.0,
    patches: [
      { lat:[1.24,1.45], lon:[103.65,103.95] },
    ],
  },

  // ---- Middle East / North Africa ----
  Turkey: {
    lat:[35.8,42.3], lon:[25.7,44.8],
    patches: [
      { lat:[38.0,41.5], lon:[26.5,30.5] }, // Marmara/Aegean inland
      { lat:[37.5,39.0], lon:[32.5,36.5] }, // Central
      { lat:[36.5,38.2], lon:[39.0,42.5] }, // East
    ],
  },
  Iran: {
    lat:[24.7,39.8], lon:[44.0,63.3],
    patches: [
      { lat:[29.5,33.8], lon:[49.0,55.0] }, // Central
      { lat:[35.4,37.7], lon:[50.0,53.6] }, // Tehran belt
      { lat:[27.5,29.7], lon:[56.8,59.5] }, // East
    ],
  },
  Iraq: {
    lat:[29.0,37.4], lon:[38.8,48.6],
    patches: [
      { lat:[33.0,35.6], lon:[43.0,45.8] },
      { lat:[30.7,32.8], lon:[46.0,48.2] },
    ],
  },
  Israel: {
    lat:[29.4,33.4], lon:[34.2,35.9],
    patches: [
      { lat:[31.1,32.7], lon:[34.7,35.3] }, // Coastal
      { lat:[32.0,33.2], lon:[35.0,35.6] }, // North
    ],
  },
  Jordan: {
    lat:[29.2,33.4], lon:[34.9,39.3],
    patches: [
      { lat:[31.1,32.3], lon:[35.6,36.2] },
      { lat:[30.2,31.1], lon:[35.0,36.0] },
    ],
  },
  Egypt: {
    lat:[22.0,31.7], lon:[24.7,36.9],
    patches: [
      { lat:[25, 30], lon:[29, 33] },    // Nile corridor
      { lat:[27, 31], lon:[32.3,34.2] }, // Sinai inland
    ],
  },
  Morocco: {
    lat:[21.3,35.9], lon:[-17.2,-1.0],
    patches: [
      { lat:[30.0,34.0], lon:[-9.6,-5.5] }, // Atlas/North
      { lat:[28.5,31.2], lon:[-8.0,-6.0] }, // Central
    ],
  },
  Algeria: {
    lat:[18.9,37.1], lon:[-8.7,11.9],
    patches: [
      { lat:[35.0,36.9], lon:[-5.8,8.8] },  // North band
      { lat:[31.0,33.5], lon:[2.0,7.0] },   // Sahara towns
    ],
  },
  Tunisia: {
    lat:[30.2,37.6], lon:[7.5,11.6],
    patches: [
      { lat:[33.5,36.9], lon:[8.5,10.8] },
    ],
  },

  // ---- Sub-Saharan Africa ----
  Nigeria: {
    lat:[4.2,13.9], lon:[2.7,14.7],
    patches: [
      { lat:[6.0,8.4], lon:[3.0,9.0] },   // SW
      { lat:[7.0,9.6], lon:[8.5,12.5] },  // Central
      { lat:[9.5,12.8], lon:[9.0,13.8] }, // North
    ],
  },
  Ghana: {
    lat:[4.5,11.2], lon:[-3.3,1.2],
    patches: [
      { lat:[5.0,7.0], lon:[-2.0,0.8] },
      { lat:[7.2,9.8], lon:[-2.5,0.4] },
    ],
  },
  Kenya: {
    lat:[-4.8,5.3], lon:[33.9,41.9],
    patches: [
      { lat:[-1.3,1.5], lon:[36.3,38.0] }, // Nairobi/Central
      { lat:[-0.6,3.0], lon:[34.5,36.5] }, // West
      { lat:[-4.0,-2.0], lon:[38.3,40.5] }, // Coast (inland)
    ],
  },
  "South Africa": {
    lat:[-34.9,-22.1], lon:[16.5,32.9],
    patches: [
      { lat:[-34.0,-32.2], lon:[18.0,20.0] }, // WCape inland
      { lat:[-26.5,-24.0], lon:[27.0,30.0] }, // Gauteng
      { lat:[-29.5,-28.0], lon:[30.0,31.8] }, // KZN
    ],
  },
  Ethiopia: {
    lat:[3.4,14.9], lon:[32.9,48.0],
    patches: [
      { lat:[7.8,10.5], lon:[37.5,40.5] },
      { lat:[11.0,12.7], lon:[37.0,39.5] },
    ],
  },
  "Sierra Leone": {
    lat:[6.9,10.0], lon:[-13.3,-10.3],
    patches: [
      { lat:[7.4,9.6], lon:[-12.7,-11.0] },
    ],
  },

  // ---- Europe ----
  "United Kingdom": {
    lat:[49.9,60.9], lon:[-8.6,1.8],
    patches: [
      { lat:[50.2,55.8], lon:[-6.0,-1.0] },  // Great Britain core
      { lat:[54.0,55.4], lon:[-8.2,-5.3] },  // Northern Ireland
      { lat:[56.0,58.5], lon:[-5.8,-2.8] },  // Highlands belt
    ],
  },
  Ireland: {
    lat:[51.4,55.4], lon:[-10.5,-5.3],
    patches: [
      { lat:[52.3,54.2], lon:[-8.8,-6.2] },
    ],
  },
  France: {
    lat:[41.1,51.3], lon:[-5.5,9.7],
    patches: [
      { lat:[44.5,48.8], lon:[-1.5,3.5] },  // W-C
      { lat:[43.2,45.2], lon:[5.0,7.5] },   // SE (inland)
      { lat:[48.3,50.0], lon:[1.5,3.2] },   // North
    ],
  },
  Spain: {
    lat:[36.0,43.8], lon:[-9.9,4.4],
    patches: [
      { lat:[39.5,41.8], lon:[-4.5,0.5] },
      { lat:[37.5,39.0], lon:[-4.0,-1.5] },
      { lat:[41.2,42.6], lon:[-3.5,0.5] },
    ],
  },
  Portugal: {
    lat:[36.8,42.2], lon:[-9.6,-6.1],
    patches: [
      { lat:[38.5,41.7], lon:[-8.6,-7.1] },
    ],
  },
  Germany: {
    lat:[47.2,55.1], lon:[5.9,15.1],
    patches: [
      { lat:[48.8,50.5], lon:[8.2,11.5] },
      { lat:[50.7,53.2], lon:[7.0,11.0] },
    ],
  },
  Italy: {
    lat:[36.6,47.1], lon:[6.6,18.8],
    patches: [
      { lat:[41.5,43.9], lon:[12.0,14.5] }, // Center
      { lat:[44.0,45.7], lon:[9.0,11.8] },  // North
      { lat:[37.0,38.4], lon:[13.2,15.6] }, // Sicily (inland)
    ],
  },
  Netherlands: {
    lat:[50.7,53.7], lon:[3.2,7.3],
    patches: [
      { lat:[51.6,53.3], lon:[4.5,6.8] },
    ],
  },
  Belgium: {
    lat:[49.5,51.6], lon:[2.5,6.4],
    patches: [
      { lat:[50.6,51.2], lon:[3.6,5.5] },
    ],
  },
  Switzerland: {
    lat:[45.8,47.8], lon:[5.9,10.5],
    patches: [
      { lat:[46.0,47.5], lon:[6.5,9.5] },
    ],
  },
  Austria: {
    lat:[46.4,49.0], lon:[9.5,17.0],
    patches: [
      { lat:[47.2,48.6], lon:[13.0,16.2] },
    ],
  },
  Poland: {
    lat:[49.0,54.9], lon:[14.1,24.2],
    patches: [
      { lat:[50.8,52.7], lon:[17.0,21.5] },
      { lat:[52.2,53.9], lon:[19.0,22.8] },
    ],
  },
  Czechia: {
    lat:[48.5,51.1], lon:[12.1,18.9],
    patches: [
      { lat:[49.2,50.5], lon:[13.0,16.9] },
    ],
  },
  Sweden: {
    lat:[55.2,69.1], lon:[11.1,24.2],
    patches: [
      { lat:[57.5,60.5], lon:[12.0,18.7] },
      { lat:[60.2,63.5], lon:[16.0,21.0] },
    ],
  },
  Norway: {
    lat:[57.9,71.3], lon:[4.6,31.1],
    patches: [
      { lat:[59.8,63.0], lon:[6.0,11.5] },
      { lat:[63.0,65.3], lon:[10.0,15.5] },
    ],
  },
  Denmark: {
    lat:[54.5,57.8], lon:[8.0,12.7],
    patches: [
      { lat:[55.2,56.7], lon:[9.0,11.5] },
    ],
  },
  Finland: {
    lat:[59.8,70.1], lon:[20.5,31.6],
    patches: [
      { lat:[60.8,63.0], lon:[23.0,27.8] },
      { lat:[63.2,65.8], lon:[24.0,28.6] },
    ],
  },
  Ukraine: {
    lat:[44.3,52.4], lon:[22.1,40.2],
    patches: [
      { lat:[48.5,50.7], lon:[24.0,32.0] },
      { lat:[46.6,48.3], lon:[30.2,36.2] },
    ],
  },

  // ---- Americas ----
  "United States": {
    lat:[24.5,49.5], lon:[-125,-66.5], // CONUS
    patches: [
      { lat:[26, 36], lon:[-119,-96] },     // West/Central
      { lat:[32, 41], lon:[-110,-85] },     // Rockies/Plains
      { lat:[35, 48], lon:[-100,-74] },     // Midwest/Northeast
      { lat:[28, 35], lon:[-90, -80] },     // Southeast
    ],
  },
  Canada: {
    lat:[43,62], lon:[-140,-52],
    patches: [
      { lat:[43, 50], lon:[-124,-114] },    // BC/AB band
      { lat:[44, 50], lon:[-113,-90] },     // Prairies
      { lat:[44, 51], lon:[-89, -66] },     // ON/QC corridor
    ],
  },
  Mexico: {
    lat:[14.3,32.7], lon:[-118.5,-86.5],
    patches: [
      { lat:[19.0,21.0], lon:[-104.0,-99.5] }, // Jalisco/GDL–CDMX corridor (inland)
      { lat:[25.0,27.5], lon:[-101.5,-98.0] }, // NE
      { lat:[16.5,18.8], lon:[-99.5,-96.0] },  // South inland
    ],
  },
  Brazil: {
    lat:[-33.8,5.3], lon:[-73.9,-34.8],
    patches: [
      { lat:[-24.5,-21.5], lon:[-49.0,-43.5] }, // South/Southeast inland
      { lat:[-23.0,-19.0], lon:[-47.5,-42.0] }, // SP/RJ/MG inland
      { lat:[-16.5,-12.5], lon:[-49.0,-43.0] }, // Central
    ],
  },
  Argentina: {
    lat:[-55.1,-21.8], lon:[-73.7,-53.6],
    patches: [
      { lat:[-34.8,-32.5], lon:[-60.5,-57.0] }, // Pampas
      { lat:[-33.6,-31.0], lon:[-69.5,-66.2] }, // Cuyo
    ],
  },
  Chile: {
    lat:[-55.9,-17.5], lon:[-75.7,-66.3],
    patches: [
      { lat:[-37.5,-33.5], lon:[-73.5,-70.0] }, // Center
      { lat:[-41.0,-38.5], lon:[-73.5,-71.0] }, // South
    ],
  },
  Colombia: {
    lat:[-4.3,13.4], lon:[-79.1,-66.8],
    patches: [
      { lat:[4.0,7.0], lon:[-76.0,-73.0] },  // Andean W
      { lat:[6.0,7.5], lon:[-74.0,-72.0] },  // Antioquia
    ],
  },
  Peru: {
    lat:[-18.4,-0.0], lon:[-81.4,-68.6],
    patches: [
      { lat:[-13.5,-11.0], lon:[-76.0,-73.0] },
      { lat:[-12.5,-9.0], lon:[-75.0,-72.0] },
    ],
  },

  // ---- Oceania ----
  Australia: {
    lat:[-43.7,-10.7], lon:[113.3,153.6],
    patches: [
      { lat:[-38,-27], lon:[144,153] },     // SE coast (inland band)
      { lat:[-35,-30], lon:[138,147] },     // SA/NSW inland
      { lat:[-33,-16], lon:[115,123] },     // WA populated strip
    ],
  },
  "New Zealand": {
    lat:[-47.3,-34.4], lon:[166.4,178.6],
    patches: [
      { lat:[-46,-41], lon:[167.5,174.5] }, // South Island
      { lat:[-40,-36], lon:[173.5,176.5] }, // North Island
    ],
  },
};
