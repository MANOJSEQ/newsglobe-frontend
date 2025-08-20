export default async function handler(req, res) {
    const HF_BASE = "https://manojseq-newsglobe-backend.hf.space"; // your Space
    const qs = new URLSearchParams(req.query).toString();
    const url = `${HF_BASE}/events${qs ? `?${qs}` : ""}`;
  
    const r = await fetch(url, { headers: { "User-Agent": "NewsGlobe/Proxy" } });
    const body = await r.text();
  
    // Cache at Vercel edge: 60s fresh, allow stale for 5m while revalidating
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(r.status).send(body);
  }
  