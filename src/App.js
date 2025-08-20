// src/App.js
import { useEffect, useRef, useState } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { placeArticles } from "./geoPlacement";

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

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



// const API_BASE = "http://127.0.0.1:8000";

// const rawBase =
//   (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) ||
//   process.env.REACT_APP_API_BASE ||
//   "http://127.0.0.1:8000";

// // remove any trailing slashes to avoid //events
// const API_BASE = (rawBase || "").replace(/\/+$/, "");

const rawBase =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) ||
  process.env.REACT_APP_API_BASE || "";

const API_BASE = (rawBase || "").replace(/\/+$/, "");


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

  { code: "",   label: "All" }, // ← special: means “no restriction”
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



export default function App() {
  const [showOriginal, setShowOriginal] = useState(false);
  const [articles, setArticles] = useState([]);
  const [pickedArticle, setPickedArticle] = useState(null);
  const [isBootingCesium, setIsBootingCesium] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null); // event payload
  const [countries, setCountries] = useState([]); // per-country data for selected event
  const [pickedCountry, setPickedCountry] = useState(null); // UI card

  // filters
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [doTranslate, setDoTranslate] = useState(false);
  const [translateTo, setTranslateTo] = useState("en");
  const requestRef = useRef(null);
  const [cacheKey, setCacheKey] = useState("");
  // const [sim, setSim] = useState(0.84); // similarity threshold
  const [minCountries, setMinCountries] = useState(2);
  const [minArticles, setMinArticles] = useState(2);
  const initOnce = useRef(false);
  
  useEffect(() => {
    const v = window.cesiumViewer;
    if (!v) return;
    // redraw ONLY after the user stops moving the globe; don't post metrics
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
  
  // centralised metric poster (easy to disable/debounce later)
  const postMetric = (payload) =>
    fetch(`${API_BASE}/client-metric`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});

  useEffect(() => {
    if (initOnce.current) return;
    initOnce.current = true;

    // Cesium boot
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
        // add these to remove the top-right icons and bottom bars
        homeButton: true,
        sceneModePicker: true,
        navigationHelpButton: true,
        navigationInstructionsInitiallyVisible: true,
        fullscreenButton: true,
        animation: false,   // bottom-left play/time speed
        timeline: false,    // bottom time axis
      });

      // NEW: kill default double-click “track entity”
      viewer.screenSpaceEventHandler.removeInputAction(
        window.Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
      );

      // (optional) keep camera in a comfy range to avoid “inside the globe” zooms
      const ssc = viewer.scene.screenSpaceCameraController;
      ssc.minimumZoomDistance = 2e5;   // ~200 km
      ssc.maximumZoomDistance = 3e7;   // ~30,000 km

      window.cesiumViewer = viewer;
      setIsBootingCesium(false);

      // click handler – pick a country pin
      const handler = new window.Cesium.ScreenSpaceEventHandler(viewer.scene.canvas); // ← add this
      handler.setInputAction((movement) => {
        // ensure we’re not in tracking mode
        viewer.trackedEntity = undefined;

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

      // initial: load events
      loadEvents();
    };
    document.body.appendChild(script);

    return () => {
      if (window.cesiumViewer) window.cesiumViewer.destroy();
    };
  }, []);

  const abortInFlight = () => {
    if (requestRef.current) requestRef.current.abort();
    requestRef.current = null;
  };

  const buildCommonParams = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (language) params.set("language", language);
    if (doTranslate && translateTo) {
      params.set("translate", "true");
      params.set("target_lang", translateTo);
    }
    // NEW:
    params.set("min_countries", String(minCountries));
    params.set("min_articles", String(minArticles));
    return params.toString();
  };
  
  const handleClearFilters = () => {
    // just reset the filter inputs — no fetches, no map changes
    setQ("");
    setCategory("");
    setLanguage("");
    setDoTranslate(false);
    setTranslateTo("en");
    setShowOriginal(false);
    setMinCountries(2);
    setMinArticles(2);
  };
  

  const loadEvents = () => {
    abortInFlight();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);

    const qs = buildCommonParams();

    return fetch(`${API_BASE}/events${qs ? `?${qs}&speed=balanced` : `?speed=balanced`}`, { // ← add speed=max
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        setEvents(data.events || []);
        setCacheKey(data.cache_key || "");
        setSelectedEvent(null);
        setCountries([]);
        drawPins([], { sendMetric: false });
        return loadNews(data.cache_key || "");
      })
      .catch((err) => {
        if (err.name !== "AbortError") console.error(err);
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null;
        setIsLoading(false);
      });
  };

  // Replace your entire drawArticlePins with this:
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



  // add this helper
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
        const rows = data?.items || [];            // ✅ extract items
        const fetchMs = performance.now() - t0;
  
        setArticles(rows);                          // ✅ store rows
        drawArticlePins(rows);                      // ✅ draw rows
        const totalMs = performance.now() - tAll;
  
        postMetric({
          name: "Fetch articles from backend",
          duration_str: formatDuration(fetchMs),
          count: rows.length,                       // ✅ rows is defined
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
  
  

  const loadEventDetails = (event_id) => {
    abortInFlight();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);

    const qsBase = buildCommonParams();
    const params = new URLSearchParams(qsBase);
    if (cacheKey) params.set("cache_key", cacheKey);

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

  // 3) Clean drawPins (no stray n/spiral unless you want to scatter countries too)
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

  const titleCase = (s) =>
    (s || "")
      .toString()
      .split(/[_\s-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  const showLoader = isBootingCesium || isLoading;

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

        {/* Min countries + Min articles as small dropdowns */}
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
          {/* Country meta (one per line) */}
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
          <div style={{marginTop:10}}>
            {(pickedCountry.samples || []).map((s, i) => (
              <div key={i} style={{marginBottom:6}}>
                <span style={{fontSize:12, opacity:0.8}}>
                  [{s.source}{s.detected_lang ? ` · ${s.detected_lang.toUpperCase()}` : ""}]{" "}
                </span>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {showOriginal ? (s.orig_title || s.original_title || s.title) : s.title}
                </a>
                {showOriginal && (s.orig_title || s.original_title) && (s.orig_title || s.original_title) !== s.title && (
                  <div style={{fontSize:12, opacity:0.75}}>Translated: {s.title}</div>
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

      {pickedArticle && (
        <div className="details-card">
          <h3 style={{marginTop:0}}>
            {showOriginal && pickedArticle.origTitle ? pickedArticle.origTitle : pickedArticle.title}
          </h3>
          {/* Article meta (one per line) */}
          <div style={{margin:"10px 0"}}>
            <div style={{marginBottom:4}}>
              <strong>Source:</strong> {pickedArticle.source || "—"}
            </div>
            <div style={{marginBottom:4}}>
              <strong>Sentiment:</strong> {pickedArticle.sentiment || "—"}
            </div>
            <div style={{marginBottom:4}}>
              <strong>Language:</strong> {pickedArticle.detectedLang ? pickedArticle.detectedLang.toUpperCase() : "—"}
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
        .filter-panel input,
        .filter-panel select {
          width:100%;
          margin-top:4px;
          padding:6px;
          border-radius:6px;
          border:1px solid #ddd;
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
        /* Move Cesium's toolbar to bottom-right, beside the fullscreen button */
        .cesium-viewer .cesium-viewer-toolbar {
          position: absolute !important;
          top: auto !important;
          left: auto !important;
          bottom: 20px !important;
          right: 60px !important; /* leave space for the fullscreen button at right:20px */
          z-index: 1100;          /* above the globe */
          display: flex;
          gap: 6px;
        }

        /* Make sure the fullscreen button itself sits in the corner */
        .cesium-viewer .cesium-viewer-fullscreenContainer {
          bottom: 20px !important;
          right: 20px !important;
        }

        /* (Optional) If you keep help instructions visible, move that popup too */
        .cesium-viewer .cesium-viewer-navigationHelp {
          position: absolute !important;
          top: auto !important;
          left: auto !important;
          bottom: 60px !important;
          right: 20px !important;
          z-index: 1100;
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
          gap:12px;           /* space between the two items */
          margin:8px 0;
          white-space:nowrap; /* keep them on one line */
        }

        .filter-panel .min-item{
          display:flex;
          align-items:center;
          gap:6px;            /* label ↔ select spacing */
        }

        .filter-panel .mini-label{
          font-size:12px;
          line-height:1;
        }

        /* Small “checkbox-ish” selects */
        .filter-panel .mini-select{
          width:44px;         /* small but readable */
          height:22px;        /* close to checkbox height */
          padding:0 2px;
          border:1px solid #ddd;
          border-radius:4px;
          text-align-last:center;   /* center selected value (most browsers) */
        }

        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }`
      }</style>
    </>
  );
}
