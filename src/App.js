// ----------------- App (Cesium Globe + Events UI) -----------------
// src/App.js

import { useEffect, useRef, useState } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { placeArticles } from "./geoPlacement";

// ----------------- Format Helpers -----------------

// mm:ss for metric timings
function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Accepts Date | number | ISO-ish string (YYYYMMDDTHHMMSSZ also) → localized string
function formatDateTime(ts) {
  if (ts == null) return "—";
  let d = null;

  if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts === "number") {
    // 10-digit → seconds, 13-digit → ms
    d = new Date(ts < 1e12 ? ts * 1000 : ts);
  } else if (typeof ts === "string") {
    // Convert ISO basic (YYYYMMDDTHHMMSSZ) → extended
    const m = ts.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/);
    let iso = ts;
    if (m) {
      const [, yyyy, MM, dd, hh, mm, ss, ms, tz] = m;
      const tzFmt = tz
        ? tz === "Z"
          ? "Z"
          : tz.includes(":") ? tz : `${tz.slice(0,3)}:${tz.slice(3)}`
        : "Z";
      iso = `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}${ms ? "."+ms : ""}${tzFmt}`;
    }
    d = new Date(iso);
  }

  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ----------------- Config / API Base -----------------

const rawBase =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) ||
  process.env.REACT_APP_API_BASE || "";

const API_BASE = (rawBase || "").replace(/\/+$/, "");

// ----------------- Static Icons / Options -----------------

const colorMap = {
  positive:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Green_dot.svg/1024px-Green_dot.svg.png",
  neutral:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Yellow_dot.svg/1024px-Yellow_dot.svg.png",
  negative:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/RedDot.svg/1024px-RedDot.svg.png",
};

const categories = [
  "",
  "politics",
  "technology",
  "sports",
  "business",
  "entertainment",
  "science",
  "health",
  "crime",
  "weather",
  "environment",
  "travel",
  "viral",
  "general",
];

const LANGUAGE_OPTIONS = [
  { code: "",   label: "All" }, // special: means “no restriction”
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
  { code: "pt", label: "Portuguese" },
  { code: "zh", label: "Chinese" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];
const TRANSLATE_OPTIONS = LANGUAGE_OPTIONS.filter(o => o.code); // no “All” here

const LANG_NAMES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  ar: "Arabic",
  ru: "Russian",
  pt: "Portuguese",
  zh: "Chinese",
  hi: "Hindi",
  ja: "Japanese",
  ko: "Korean",
};

const langName = (code) => {
  if (!code) return "—";
  const c = String(code).toLowerCase();
  // be tolerant of things like "pt-BR" or "zh-Hans"
  const base = c.startsWith("zh") ? "zh" : c.slice(0, 2);
  return LANG_NAMES[base] || code.toUpperCase();
};

const USES_12H = new Intl.DateTimeFormat(undefined, { hour: "numeric" })
  .formatToParts(new Date())
  .some(p => p.type === "dayPeriod");

const TIME_HINT = USES_12H ? "hh:mm AM/PM" : "HH:mm";
const DATE_HINT = "dd/mm/yyyy";


// ----------------- Main Component -----------------

export default function App() {
  // UI toggles/state
  const [showOriginal, setShowOriginal] = useState(false);

  // Data (flat articles list or per-event countries)
  const [articles, setArticles] = useState([]);
  const [pickedArticle, setPickedArticle] = useState(null);

  // Cesium + network state
  const [isBootingCesium, setIsBootingCesium] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const requestRef = useRef(null);
  const initOnce = useRef(false);

  const startRef = useRef(null);
  const endRef = useRef(null);

  // Events and event details
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [countries, setCountries] = useState([]);     // per-country for selected event
  const [pickedCountry, setPickedCountry] = useState(null);

  // Filters
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [doTranslate, setDoTranslate] = useState(false);
  const [translateTo, setTranslateTo] = useState("en");
  const [cacheKey, setCacheKey] = useState("");
  // const [sim, setSim] = useState(0.84); // similarity threshold (unused—kept for future)
  const [minCountries, setMinCountries] = useState(2);
  const [minArticles, setMinArticles] = useState(2);

  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");

  // ----------------- Map Redraw On Camera Stop -----------------
  useEffect(() => {
    const v = window.cesiumViewer;
    if (!v) return;
    // Redraw ONLY after the globe stops moving; skip posting metrics
    const onMoveEnd = () => {
      if (!selectedEvent) {
        if (articles?.length) drawArticlePins(articles, { sendMetric: false });
      } else {
        if (countries?.length) drawPins(countries, { sendMetric: false });
      }
    };
    v.camera.moveEnd.addEventListener(onMoveEnd);
    return () => v.camera.moveEnd.removeEventListener(onMoveEnd);
  }, [articles, countries, selectedEvent]);

  // ----------------- Metrics Helper -----------------
  // Centralized metric poster (easy to disable/debounce later)
  const postMetric = (payload) =>
    fetch(`${API_BASE}/client-metric`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});

  // ----------------- Cesium Boot (one time) -----------------
  useEffect(() => {
    if (initOnce.current) return;
    initOnce.current = true;

    // Cesium boot (serving Cesium from /cesium)
    window.CESIUM_BASE_URL = "/cesium";
    const script = document.createElement("script");
    script.src = "/cesium/Cesium.js";
    script.async = true;
    script.onload = () => {
      window.Cesium.Ion.defaultAccessToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI3YzE1NWViMC0zN2IzLTQ1MGYtOWI4Yi1lZjUyNDkxODZlNjUiLCJpZCI6MzEzNzcxLCJpYXQiOjE3NTAzMzUwOTJ9.fiMSvVr8Am63hldioNrD-M9us3rVTT0NOtn1CDI66uI";
      const viewer = new window.Cesium.Viewer("cesiumContainer", {
        baseLayerPicker: false,
        geocoder: false,
        selectionIndicator: false,
        infoBox: false,
        homeButton: true,
        sceneModePicker: false,
        navigationHelpButton: true,
        navigationInstructionsInitiallyVisible: false,
        fullscreenButton: true,
        animation: false,   // bottom-left play/time speed
        timeline: false,    // bottom time axis
      });

      const nhb = viewer._navigationHelpButton || viewer.navigationHelpButton;
      if (nhb?.viewModel) nhb.viewModel.showInstructions = false;

      // Prevent default double-click “track entity”
      viewer.screenSpaceEventHandler.removeInputAction(
        window.Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
      );

      // Keep camera within a comfy range (avoid “inside globe” zooms)
      const ssc = viewer.scene.screenSpaceCameraController;
      ssc.minimumZoomDistance = 2e5;   // ~200 km
      ssc.maximumZoomDistance = 3e7;   // ~30,000 km

      window.cesiumViewer = viewer;
      setIsBootingCesium(false);

      // Click handler – pick either an article pin or a country pin
      const handler = new window.Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement) => {
        viewer.trackedEntity = undefined; // ensure not tracking anything
        const picked = viewer.scene.pick(movement.position);
        if (picked && picked.id) {
          if (picked.id.articleData) {
            setPickedArticle(picked.id.articleData);
            setPickedCountry(null);
          } else if (picked.id.countryData) {
            setPickedCountry(picked.id.countryData);
            setPickedArticle(null);
          } else {
            setPickedArticle(null);
            setPickedCountry(null);
          }
        } else {
          setPickedArticle(null);
          setPickedCountry(null);
        }
      }, window.Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Initial load
      loadEvents();
    };
    document.body.appendChild(script);

    return () => {
      if (window.cesiumViewer) window.cesiumViewer.destroy();
    };
  }, []);

  // ----------------- Network: Abort Helper -----------------
  const abortInFlight = () => {
    if (requestRef.current) requestRef.current.abort();
    requestRef.current = null;
  };

  // ----------------- Query Builder (shared across endpoints) -----------------
  const buildCommonParams = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (language) params.set("language", language);
  
    // NEW: date range (send UTC ISO strings)
    if (dateStart) params.set("start", new Date(dateStart).toISOString());
    if (dateEnd) params.set("end", new Date(dateEnd).toISOString());
  
    if (doTranslate && translateTo) {
      params.set("translate", "true");
      params.set("target_lang", translateTo);
    }
    params.set("min_countries", String(minCountries));
    params.set("min_articles", String(minArticles));
    return params.toString();
  };
  

  // ----------------- UI: Clear Filters (no fetch) -----------------
  const handleClearFilters = () => {
    setQ("");
    setCategory("");
    setLanguage("");
    setDoTranslate(false);
    setTranslateTo("en");
    setShowOriginal(false);
    setMinCountries(2);
    setMinArticles(2);
    setDateStart("");
    setDateEnd("");
  };

  // ----------------- Fetch: Events (and then articles) -----------------
  const loadEvents = () => {
    abortInFlight();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);

    const qs = buildCommonParams();

    return fetch(`${API_BASE}/events${qs ? `?${qs}&speed=balanced` : `?speed=balanced`}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        setEvents(data.events || []);
        setCacheKey(data.cache_key || "");
        setSelectedEvent(null);
        setCountries([]);
        drawPins([], { sendMetric: false });
        return loadNews(data.cache_key || ""); // fetch news for the same cache
      })
      .catch((err) => {
        if (err.name !== "AbortError") console.error(err);
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null;
        setIsLoading(false);
      });
  };

  // ----------------- Draw: Article Pins -----------------
  const drawArticlePins = (rows, { sendMetric = true } = {}) => {
    const v = window.cesiumViewer;
    if (!v) return;
    v.entities.removeAll();

    const t0 = performance.now();

    // Normalize/relocate all points strictly inside their countries
    const placed = placeArticles(rows);

    placed.forEach((a) => {
      if (!Number.isFinite(a.lon) || !Number.isFinite(a.lat)) return;

      const publishedRaw =
        a.published_at ??
        a.publishedAt ??
        a.pubDate ??
        a.date_published ??
        a.date ??
        (a.published_ts != null ? Number(a.published_ts) : null);

      v.entities.add({
        name: `${a.source}: ${a.title}`,
        position: window.Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 80000),
        billboard: {
          image: colorMap[a.sentiment] || colorMap.neutral,
          width: 24,
          height: 24,
        },
        // Store the raw data on the entity for click handling
        articleData: {
          id: a.id,
          title: a.title,
          // keep originals regardless of backend naming
          origTitle: a.original_title ?? a.orig_title ?? a.title,
          url: a.url,
          source: a.source,
          sentiment: a.sentiment,
          country: a.country,
          lat: a.lat,
          lon: a.lon,
          description: a.description,
          origDescription: a.original_description ?? a.orig_description ?? a.description,
          detectedLang: a.detected_lang,
          translated: !!a.translated,
          translatedFrom: a.translated_from,
          translatedTo: a.translated_to,
          category:
            (a.category && a.category.trim()) ||
            (category && category.trim()) ||
            "",
          published: publishedRaw,
        },
      });
    });

    const durationMs = performance.now() - t0;
    if (sendMetric) {
      postMetric({
        name: "Load all article markers on globe",
        duration_str: formatDuration(durationMs),
        count: placed?.length || 0,
        extra: { entities_drawn: window.cesiumViewer?.entities?.values?.length || 0 },
        ts: Date.now(),
      });
    }
  };

  // ----------------- Fetch: News (flat list for article pins) -----------------
  const loadNews = (overrideKey) => {
    abortInFlight();
    const controller = new AbortController();
    requestRef.current = controller;

    const qs = buildCommonParams();
    const key = overrideKey ?? cacheKey;
    const url = key
      ? `${API_BASE}/news?cache_key=${encodeURIComponent(key)}&${qs}&page_size=200&speed=balanced`
      : `${API_BASE}/news${qs ? `?${qs}&page_size=200&speed=balanced` : `?page_size=200&speed=balanced`}`;

    const tAll = performance.now();
    const t0 = performance.now();

    return fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        const rows = data?.items || [];
        const fetchMs = performance.now() - t0;

        setArticles(rows);
        drawArticlePins(rows);
        const totalMs = performance.now() - tAll;

        postMetric({
          name: "Fetch articles from backend",
          duration_str: formatDuration(fetchMs),
          count: rows.length,
          ts: Date.now(),
        });
        postMetric({
          name: "Full refresh (fetch + draw article markers)",
          duration_str: formatDuration(totalMs),
          count: rows.length,
          ts: Date.now(),
        });

        setPickedArticle(null);
        setPickedCountry(null);
      })
      .catch((err) => {
        if (err.name !== "AbortError") console.error(err);
      });
  };

  // ----------------- Fetch: Event Details (per-country split) -----------------
  const loadEventDetails = (event_id) => {
    abortInFlight();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);

    const qsBase = buildCommonParams();
    const params = new URLSearchParams(qsBase);
    if (cacheKey) params.set("cache_key", cacheKey);
    params.set("max_samples", "0");

    fetch(`${API_BASE}/event/${event_id}?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSelectedEvent(data.event);
        setCountries(data.countries || []);
        setPickedArticle(null);
        setPickedCountry(null);
        drawPins(data.countries || []);
      })
      .catch((err) => {
        if (err.name !== "AbortError") console.error(err);
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null;
        setIsLoading(false);
      });
  };

  // ----------------- Draw: Country Pins (for selected event) -----------------
  const drawPins = (countryRows, { sendMetric = true } = {}) => {
    const viewer = window.cesiumViewer;
    if (!viewer) return;
    viewer.entities.removeAll();

    const t0 = performance.now();

    countryRows.forEach((row) => {
      if (!Number.isFinite(row.lon) || !Number.isFinite(row.lat)) return;

      viewer.entities.add({
        name: `${row.country} (${row.count})`,
        position: window.Cesium.Cartesian3.fromDegrees(row.lon, row.lat, 120000),
        billboard: {
          image: colorMap[row.avg_sentiment] || colorMap.neutral,
          width: 36,
          height: 36,
        },
        countryData: row,
      });
    });

    const durationMs = performance.now() - t0;
    if (sendMetric) {
      postMetric({
        name: "Load event country markers on globe",
        duration_str: formatDuration(durationMs),
        count: countryRows?.length || 0,
        extra: { entities_drawn: window.cesiumViewer?.entities?.values?.length || 0 },
        ts: Date.now(),
      });
    }
  };

  // ----------------- Small Utilities -----------------
  const titleCase = (s) =>
    (s || "")
      .toString()
      .split(/[_\s-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  const showLoader = isBootingCesium || isLoading;

  // ----------------- Render -----------------
  return (
    <>
      {/* Left: Events List */}
      <div className="events-panel">
        <h3 style={{ marginTop: 0 }}>Events</h3>
        <div className="events-list">
          {(events || []).map(ev => (
            <div
              key={ev.event_id}
              className={`event-card ${selectedEvent?.event_id===ev.event_id ? "active":""}`}
              onClick={() => loadEventDetails(ev.event_id)}
            >
              <div className="ev-title">{ev.title}</div>
              <div className="ev-meta">
                <span>{ev.article_count} articles</span>
                <span>{ev.country_count} countries</span>
              </div>
              <div className="ev-tags">
                {(ev.keywords || []).slice(0,4).map(k => <span key={k} className="tag">{k}</span>)}
              </div>
            </div>
          ))}
          {(!events || events.length===0) && (
            <div className="hint">No events yet. Try changing search/language.</div>
          )}
        </div>
      </div>

      {/* Right: Filters */}
      <div className="filter-panel">
        <h3 style={{marginTop:0}}>Filters</h3>
        <label>
          Search
          <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="e.g. Tesla, Ukraine..." />
        </label>
        <label>
          Category
          <select value={category} onChange={(e)=>setCategory(e.target.value)}>
            {categories.map(c => <option key={c} value={c}>{c === "" ? "All" : titleCase(c)}</option>)}
          </select>
        </label>
        <label>
          Language (original)
          <select value={language} onChange={(e)=>setLanguage(e.target.value)}>
            {LANGUAGE_OPTIONS.map(opt => (
              <option key={opt.code || "all"} value={opt.code}>{opt.label}</option>
            ))}
          </select>
        </label>

        <label>
          Start date/time
          <div className="dtl-wrap" data-12h={USES_12H ? "1" : "0"}>
            <input
              ref={startRef}
              type="datetime-local"
              value={dateStart}
              onChange={(e)=>setDateStart(e.target.value)}
            />
            {/* hides native --:-- -- until there’s a value */}
            {!dateStart && <span className="dtl-cover" aria-hidden="true" />}
            {/* separate hover/click zones for tooltips */}
            {!dateStart && (
              <>
                <span
                  className="dtl-hit dtl-date"
                  title={`Date format: ${DATE_HINT}`}
                  onClick={()=>startRef.current?.showPicker?.() || startRef.current?.focus()}
                />
                <span
                  className="dtl-hit dtl-time"
                  title={`Time format: ${TIME_HINT}`}
                  onClick={()=>startRef.current?.showPicker?.() || startRef.current?.focus()}
                />
              </>
            )}
          </div>
        </label>


        <label>
          End date/time
          <div className="dtl-wrap" data-12h={USES_12H ? "1" : "0"}>
            <input
              ref={endRef}
              type="datetime-local"
              value={dateEnd}
              onChange={(e)=>setDateEnd(e.target.value)}
            />
            {!dateEnd && <span className="dtl-cover" aria-hidden="true" />}
            {!dateEnd && (
              <>
                <span
                  className="dtl-hit dtl-date"
                  title={`Date format: ${DATE_HINT}`}
                  onClick={()=>endRef.current?.showPicker?.() || endRef.current?.focus()}
                />
                <span
                  className="dtl-hit dtl-time"
                  title={`Time format: ${TIME_HINT}`}
                  onClick={()=>endRef.current?.showPicker?.() || endRef.current?.focus()}
                />
              </>
            )}
          </div>
        </label>



        <label className="row">
          <input
            type="checkbox"
            checked={doTranslate}
            onChange={(e)=>setDoTranslate(e.target.checked)}
          />
          <span className="label-text">Translate to</span>
          <select
            disabled={!doTranslate}
            value={translateTo}
            onChange={(e)=>setTranslateTo(e.target.value)}
          >
            {TRANSLATE_OPTIONS.map(opt => (
              <option key={opt.code} value={opt.code}>{opt.label}</option>
            ))}
          </select>
        </label>

        <label className="row">
          <input
            type="checkbox"
            checked={showOriginal}
            onChange={(e)=>setShowOriginal(e.target.checked)}
          />
          <span className="label-text">Show original text</span>
        </label>

        {/* Min countries + Min articles as compact dropdowns */}
        <div className="min-row">
          <div className="min-item">
            <span className="mini-label">Min countries</span>
            <select
              className="mini-select"
              value={minCountries}
              onChange={(e)=>setMinCountries(parseInt(e.target.value, 10))}
            >
              {Array.from({ length: 20 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <div className="min-item">
            <span className="mini-label">Min articles</span>
            <select
              className="mini-select"
              value={minArticles}
              onChange={(e)=>setMinArticles(parseInt(e.target.value, 10))}
            >
              {Array.from({ length: 200 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="btn-row">
          <button onClick={loadEvents} disabled={isLoading}>
            Load events & articles
          </button>
          <button className="btn-outline btn-small" onClick={handleClearFilters} disabled={isLoading}>
            Clear
          </button>
        </div>
      </div>

      {/* Bottom details for picked country */}
      {pickedCountry && (
        <div className="details-card">
          <h3 style={{marginTop:0}}>
            {pickedCountry.country} — {pickedCountry.count} articles
          </h3>
          {/* Country meta */}
          <div style={{margin:"10px 0"}}>
            <div style={{marginBottom:4}}>
              <strong>Avg sentiment:</strong> {pickedCountry.avg_sentiment || "—"}
            </div>
            <div style={{marginBottom:0}}>
              <strong>Top sources:</strong>{" "}
              {(pickedCountry.top_sources || []).join(", ") || "—"}
            </div>
          </div>
          <p style={{marginTop:8}}>{pickedCountry.summary}</p>

          <div className="sample-list">
            {(pickedCountry.samples || []).map((s, i) => (
              <div key={i} className="sample-row">
                <span className="sample-meta">
                  [{s.source}{s.detected_lang ? ` · ${s.detected_lang.toUpperCase()}` : ""}]
                </span>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {showOriginal ? (s.orig_title || s.original_title || s.title) : s.title}
                </a>
                {showOriginal && (s.orig_title || s.original_title) && (s.orig_title || s.original_title) !== s.title && (
                  <div className="sample-translated">Translated: {s.title}</div>
                )}
              </div>
            ))}
          </div>

          <div className="btn-row" style={{marginTop:12}}>
            <button className="btn-primary" onClick={()=>setPickedCountry(null)}>Close</button>
            <button
              className="btn-outline"
              onClick={()=>{
                const v = window.cesiumViewer;
                if (!v) return;
                const dest = window.Cesium.Cartesian3.fromDegrees(pickedCountry.lon, pickedCountry.lat, 600000);
                v.camera.flyTo({ destination: dest });
              }}
            >
              Fly to
            </button>
          </div>
        </div>
      )}

      {/* Bottom details for picked article */}
      {pickedArticle && (
        <div className="details-card">
          <h3 style={{marginTop:0}}>
            {showOriginal && pickedArticle.origTitle ? pickedArticle.origTitle : pickedArticle.title}
          </h3>
          {/* Article meta */}
          <div style={{margin:"10px 0"}}>
            <div style={{marginBottom:4}}>
              <strong>Source:</strong> {pickedArticle.source || "—"}
            </div>
            <div style={{marginBottom:4}}>
              <strong>Sentiment:</strong> {pickedArticle.sentiment || "—"}
            </div>
            <div style={{marginBottom:4}}>
              <strong>Language:</strong> {langName(pickedArticle.detectedLang)}
            </div>
            <div style={{marginBottom:4}}>
              <strong>Category:</strong> {titleCase(pickedArticle.category || category || "general")}
            </div>
            <div style={{marginBottom:4}}>
              <strong>Country:</strong> {pickedArticle.country || "—"}
            </div>
            <div style={{marginBottom:0}}>
              <strong>Published:</strong> {formatDateTime(pickedArticle?.published) || "—"}
            </div>
          </div>
          <p style={{marginTop:8}}>
            {showOriginal && pickedArticle.origDescription ? pickedArticle.origDescription : pickedArticle.description}
          </p>
          {/* Optional: show both when comparing */}
          {showOriginal && pickedArticle.translated && (
            <div style={{marginTop:8, paddingTop:8, borderTop:"1px dashed #ddd"}}>
              <div style={{fontSize:12, opacity:0.7, marginBottom:4}}>Translated:</div>
              <div style={{fontWeight:600}}>{pickedArticle.title}</div>
              <div>{pickedArticle.description}</div>
            </div>
          )}
          <div className="btn-row" style={{marginTop:12}}>
            <button className="btn-primary" onClick={()=>window.open(pickedArticle.url, "_blank")}>Open article</button>
            <button
              className="btn-outline"
              onClick={()=>{
                const v = window.cesiumViewer;
                if (!v) return;
                const dest = window.Cesium.Cartesian3.fromDegrees(pickedArticle.lon, pickedArticle.lat, 400000);
                v.camera.flyTo({ destination: dest });
              }}
            >
              Fly to
            </button>
            <button className="btn-outline" onClick={()=>setPickedArticle(null)}>Close</button>
          </div>
        </div>
      )}

      {/* Cesium container */}
      <div
        id="cesiumContainer"
        style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", zIndex:0 }}
      />

      {/* Loader */}
      {showLoader && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div className="loading-text">{isBootingCesium ? "Starting map..." : "Loading..."}</div>
        </div>
      )}

      {/* ----------------- Inline Styles (scoped) ----------------- */}
      <style>{`
        .details-card {
          position: absolute;
          left: 340px; /* to the right of Events panel */
          bottom: 20px;
          z-index: 1000;
          width: 420px;
          background: #ffffffee;
          border-radius: 12px;
          padding: 14px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.25);
          font-family: sans-serif;
        }
        .btn-primary {
          padding:8px 12px;
          border:none;
          background:#007bff;
          color:#fff;
          border-radius:8px;
          cursor:pointer;
        }
        .btn-outline {
          padding:8px 12px;
          border:1px solid #007bff;
          color:#007bff;
          background:#fff;
          border-radius:8px;
          cursor:pointer;
        }
        .events-panel {
          position:absolute;
          top:20px;
          left:20px;
          z-index:1000;
          width:300px;
          background:#ffffffee;
          border-radius:12px;
          padding:14px;
          box-shadow:0 2px 10px rgba(0,0,0,0.15);
          font-family:sans-serif;
          max-height:86vh;
          display:flex;
          flex-direction:column;
        }
        .events-list {
          overflow:auto;
          margin-top:10px;
          padding-right:4px;
        }
        .event-card {
          border:1px solid #e6e6e6;
          border-radius:10px;
          padding:10px;
          margin-bottom:8px;
          cursor:pointer;
        }
        .event-card.active {
          border-color:#007bff;
          box-shadow:0 0 0 2px rgba(0,123,255,0.15);
        }
        .ev-title {
          font-weight:600;
          font-size:14px;
        }
        .ev-meta {
          display:flex;
          gap:10px;
          font-size:12px;
          color:#555;
          margin-top:4px;
        }
        .ev-tags {
          margin-top:6px;
          display:flex;
          gap:6px;
          flex-wrap:wrap;
        }
        .tag {
          font-size:11px;
          padding:2px 6px;
          border-radius:999px;
          background:#f0f3f7;
        }
        .filter-panel {
          position:absolute;
          top:20px;
          right:20px;
          z-index:1000;
          width:260px;
          background:#ffffffee;
          border-radius:12px;
          padding:14px;
          box-shadow:0 2px 10px rgba(0,0,0,0.15);
          font-family:sans-serif;
          max-height:86vh;
          display:flex;
          flex-direction:column;
        }
        .filter-panel label {
          display:block;
          font-size:13px;
          margin:8px 0;
        }
        
        /* Match Search input to selects (leave checkboxes alone) */
        .filter-panel input:not([type="checkbox"]),
        .filter-panel select {
          width: 100%;
          margin-top: 4px;
          height: 38px;         /* same height */
          padding: 0 12px;      /* same inner padding */
          border-radius: 10px;  /* same corners */
          border: 1px solid #ddd;
          box-sizing: border-box;
        }

        /* Normalize text input look across browsers (won’t affect the select arrow) */
        .filter-panel input[type="text"] {
          -webkit-appearance: none;
          appearance: none;
        }   

        .filter-panel .row {
          display:flex;
          align-items:center;
          gap:8px;
        }
        .btn-row {
          display:flex;
          gap:8px;
          margin-top:8px;
        }
        .btn-row button {
          flex:1;
          padding:8px 10px;
          border:none;
          border-radius:8px;
          background:#007bff;
          color:#fff;
          cursor:pointer;
        }
        .loading-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.6);
          z-index: 1200;
        }
        .spinner {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 3px solid #ddd;
          border-top-color: #007bff;
          animation: spin 0.8s linear infinite;
        }

        /* --- Cesium toolbar: bottom-right, single row --- */
        .cesium-viewer .cesium-viewer-toolbar {
          overflow: visible !important;
          position: absolute !important;
          top: auto !important;
          left: auto !important;
          bottom: 20px !important;
          right: 60px !important;   /* leave space for fullscreen at 20px */
          z-index: 1100 !important;
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          flex-wrap: nowrap !important;   /* keep in one straight line */
        }

        /* keep each control same size so the row aligns neatly */
        .cesium-viewer .cesium-toolbar-button,
        .cesium-viewer .cesium-navigationHelpButton-wrapper {
          width: 32px !important;
          height: 32px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        /* --- Fullscreen button pinned to the corner --- */
        .cesium-viewer .cesium-viewer-fullscreenContainer {
          position: absolute !important;
          top: auto !important;
          left: auto !important;
          bottom: 20px !important;
          right: 20px !important;
          z-index: 1100 !important;
        }

        /* force Navigation Help panel ABOVE (handles multiple Cesium versions) */
        .cesium-viewer .cesium-viewer-navigationHelp,
        .cesium-viewer .cesium-navigationHelpButton-wrapper .cesium-navigation-help,
        .cesium-viewer .cesium-navigationHelpButton-wrapper .cesium-navigationHelp {
          position: absolute !important;
          top: auto !important;
          left: auto !important;
          right: 0 !important;                 /* align to the help button */
          bottom: 46px !important;             /* sit above the toolbar row */
          z-index: 1200 !important;
          transform-origin: right bottom !important; /* animate from bottom-right */
        }

        /* fixed-width numerals keeps alignment predictable */
        .filter-panel input[type="datetime-local"]{
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum";
        }

        .dtl-wrap{
          position: relative;
          --pad-x: 12px;     /* must match the input’s horizontal padding */
          --date-ch: 13;     /* width of "dd/mm/yyyy,␠␠" in chars; tweak if needed */
        }


        /* transparent hit areas that provide separate tooltips */
        .dtl-hit{
          position:absolute; top:0; bottom:0;
          background: transparent;
        }
        .dtl-date{
          left: var(--pad-x);
          width: calc(var(--date-ch) * 1ch);
        }
        .dtl-time{
          left: calc(var(--pad-x) + var(--date-ch) * 1ch);
          right: 36px;  /* stop before the calendar icon */
        }



        .btn-row .btn-outline {
          background: #fff;
          color: #007bff;
          border: 1px solid #007bff;
        }
        .btn-row .btn-small {
          flex: 0 0 auto;     /* don’t stretch */
          padding: 6px 10px;  /* a bit shorter/narrower */
          font-size: 12px;
        }
        
        /* Keep the two rows inline and stop the select from stretching */
        .filter-panel .row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: nowrap;
        }
        .filter-panel .row .label-text { white-space: nowrap; }
        .filter-panel .row select { width: auto; flex: 1; min-width: 90px; }
        .filter-panel .row input[type="checkbox"] { width: auto; }

        /* Inline, compact controls for the two mins */
        .filter-panel .min-row{
          display:flex;
          align-items:center;
          gap:12px;
          margin:8px 0;
          white-space:nowrap;
        }

        .filter-panel .min-item{
          display:flex;
          align-items:center;
          gap:6px;
        }

        .filter-panel .mini-label{
          font-size:12px;
          line-height:1;
        }

        /* Small “checkbox-ish” selects */
        .filter-panel .mini-select{
          width:44px;
          height:22px;
          padding:0 2px;
          border:1px solid #ddd;
          border-radius:4px;
          text-align-last:center;
        }

        /* scrollable list inside the country details card */
        .sample-list{
          margin-top:10px;
          max-height: 240px;   /* keeps the card compact */
          overflow-y: auto;
          padding-right: 6px;  /* room for scrollbar */
        }
        .sample-row{ margin-bottom:6px; }
        .sample-meta{ font-size:12px; opacity:0.8; margin-right:4px; }
        .sample-translated{ font-size:12px; opacity:0.75; }

        /* nice, slim scrollbar (webkit) */
        .sample-list::-webkit-scrollbar { width: 8px; }
        .sample-list::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; }
        .sample-list::-webkit-scrollbar-track { background: transparent; }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }`
      }</style>
    </>
  );
}
