import { useState, useEffect, useRef } from "react";

// ⬇️ After deploying your backend, paste its URL here
const DEFAULT_BACKEND = "https://backend-ltv2-production.up.railway.app";

function predictRaceTime(avgPaceSecPerKm, refDistKm, targetDistanceKm) {
  const t1 = avgPaceSecPerKm * refDistKm;
  return t1 * Math.pow(targetDistanceKm / refDistKm, 1.06);
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(secPerKm) {
  if (!secPerKm || isNaN(secPerKm)) return "--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.floor(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

function ctlPaceModifier(ctl) {
  if (!ctl || ctl <= 0) return 1.0;
  const bonus = Math.min(0.03, (ctl - 40) * 0.0005);
  return 1 - Math.max(0, bonus);
}

function getConfidence(runCount, weeks, hasHR) {
  let score = 0;
  if (runCount >= 20) score += 3; else if (runCount >= 10) score += 2; else if (runCount >= 5) score += 1;
  if (weeks >= 8) score += 2; else if (weeks >= 4) score += 1;
  if (hasHR) score += 1;
  if (score >= 5) return { label: "High", color: "#c8f542", pct: 90 };
  if (score >= 3) return { label: "Medium", color: "#facc15", pct: 65 };
  return { label: "Low", color: "#f87171", pct: 40 };
}

export default function App() {
  const [step, setStep] = useState("connect"); // connect | results
  const [athleteId, setAthleteId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND);
  const [weeks, setWeeks] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function analyse() {
    setLoading(true);
    setError(null);
    try {
      const oldest = new Date();
      oldest.setDate(oldest.getDate() - weeks * 7);
      const oldestStr = oldest.toISOString().split("T")[0];
      const newestStr = new Date().toISOString().split("T")[0];

      const base = backendUrl.replace(/\/$/, "");
      const url = `${base}/activities?athleteId=${encodeURIComponent(athleteId)}&apiKey=${encodeURIComponent(apiKey)}&oldest=${oldestStr}&newest=${newestStr}`;

      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const activities = await res.json();
      const runs = activities.filter(a => a.type === "Run" && a.distance > 1000 && a.moving_time > 60);

      if (runs.length === 0) throw new Error("No runs found in this period. Try a longer window.");

      const totalKm = runs.reduce((s, r) => s + r.distance, 0) / 1000;
      const totalSec = runs.reduce((s, r) => s + r.moving_time, 0);
      const avgPace = totalSec / totalKm;

      // Group by week
      const weekMap = {};
      runs.forEach(r => {
        const d = new Date(r.start_date_local || Date.now());
        const yr = d.getFullYear();
        const wk = Math.ceil((d - new Date(yr, 0, 1)) / 604800000);
        const key = `${yr}-W${wk}`;
        if (!weekMap[key]) weekMap[key] = { label: key, km: 0, count: 0 };
        weekMap[key].km += r.distance / 1000;
        weekMap[key].count++;
      });
      const weeklyData = Object.values(weekMap).slice(-weeks);
      const avgWeeklyKm = totalKm / Math.max(weeklyData.length, 1);

      const latestCTL = runs[0]?.icu_ctl || 0;
      const modifier = ctlPaceModifier(latestCTL);
      const effPace = avgPace * modifier;
      const refDist = Math.max(totalKm / runs.length, 5);

      const hasHR = runs.some(r => r.average_heartrate);
      const confidence = getConfidence(runs.length, weeklyData.length, hasHR);

      const predictions = [
        { label: "5K",       dist: 5,        icon: "⚡" },
        { label: "10K",      dist: 10,       icon: "🏃" },
        { label: "Half",     dist: 21.0975,  icon: "🎯" },
        { label: "Marathon", dist: 42.195,   icon: "🏆" },
      ].map(r => ({ ...r, time: predictRaceTime(effPace, refDist, r.dist) }));

      setResults({ runs, predictions, avgPace, totalKm, avgWeeklyKm, latestCTL, weeklyData, confidence, runCount: runs.length });
      setStep("results");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.root}>
      <div style={s.bg} />

      <header style={s.header}>
        <span style={s.logo}>▲</span>
        <h1 style={s.title}>STRIDEIQ</h1>
        <p style={s.sub}>Race Prediction Engine · intervals.icu</p>
      </header>

      {step === "connect" && (
        <div style={s.card}>
          <div style={s.cardTag}>CONNECT</div>

          <div style={s.row}>
            <Field label="Athlete ID" ref={inputRef}>
              <input style={s.input} value={athleteId} onChange={e => setAthleteId(e.target.value)} placeholder="e.g. i12345" />
            </Field>
            <Field label="API Key">
              <input style={s.input} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Settings → Developer" />
            </Field>
          </div>

          <div style={s.row}>
            <Field label="Backend URL" hint="Your deployed server URL">
              <input style={s.input} value={backendUrl} onChange={e => setBackendUrl(e.target.value)} placeholder="https://your-app.railway.app" />
            </Field>
            <Field label="Analysis window">
              <select style={s.input} value={weeks} onChange={e => setWeeks(Number(e.target.value))}>
                <option value={4}>4 weeks</option>
                <option value={8}>8 weeks</option>
                <option value={12}>12 weeks</option>
                <option value={16}>16 weeks</option>
              </select>
            </Field>
          </div>

          <button style={{ ...s.btn, opacity: (loading || !athleteId || !apiKey) ? 0.4 : 1 }}
            onClick={analyse} disabled={loading || !athleteId || !apiKey}>
            {loading ? "ANALYSING…" : "ANALYSE MY TRAINING →"}
          </button>

          {error && <div style={s.err}>{error}</div>}

          <div style={s.steps}>
            <p style={s.stepsTitle}>SETUP STEPS</p>
            <Step n="1" text="Deploy the backend server (see README in the zip)" />
            <Step n="2" text="Paste your backend URL above" />
            <Step n="3" text="Get Athlete ID + API Key from intervals.icu → Settings → Developer Settings" />
            <Step n="4" text="Hit Analyse" />
          </div>
        </div>
      )}

      {step === "results" && results && (
        <>
          <button style={s.back} onClick={() => setStep("connect")}>← Back</button>

          <div style={s.predGrid}>
            {results.predictions.map(p => (
              <div key={p.label} style={s.predCard}>
                <div style={s.predIcon}>{p.icon}</div>
                <div style={s.predLabel}>{p.label}</div>
                <div style={s.predTime}>{formatTime(p.time)}</div>
                <div style={s.predPace}>{formatPace(p.time / p.dist)}</div>
              </div>
            ))}
          </div>

          <div style={s.twoCol}>
            <div style={s.card}>
              <div style={s.cardTag}>TRAINING STATS</div>
              {[
                ["Runs analysed", results.runCount],
                ["Total distance", `${results.totalKm.toFixed(0)} km`],
                ["Avg weekly volume", `${results.avgWeeklyKm.toFixed(1)} km`],
                ["Avg pace", formatPace(results.avgPace)],
                ["Current CTL", results.latestCTL?.toFixed(1) || "N/A"],
              ].map(([l, v]) => (
                <div key={l} style={s.statRow}>
                  <span style={s.statL}>{l}</span>
                  <span style={s.statV}>{v}</span>
                </div>
              ))}
            </div>

            <div style={s.card}>
              <div style={s.cardTag}>CONFIDENCE</div>
              <div style={s.confWrap}>
                <svg width="130" height="130" viewBox="0 0 130 130">
                  <circle cx="65" cy="65" r="50" fill="none" stroke="#1a1a1a" strokeWidth="10" />
                  <circle cx="65" cy="65" r="50" fill="none"
                    stroke={results.confidence.color} strokeWidth="10"
                    strokeDasharray={`${(results.confidence.pct / 100) * 314} 314`}
                    strokeLinecap="round" transform="rotate(-90 65 65)" />
                  <text x="65" y="60" textAnchor="middle" fill={results.confidence.color} fontSize="24" fontWeight="700" fontFamily="monospace">{results.confidence.pct}%</text>
                  <text x="65" y="78" textAnchor="middle" fill="#666" fontSize="10" fontFamily="monospace">{results.confidence.label.toUpperCase()}</text>
                </svg>
                <div style={s.confNote}>
                  {results.runCount < 10 && <p style={s.tip}>↑ Log more runs for better accuracy</p>}
                  {results.latestCTL < 50 && <p style={s.tip}>↑ Build CTL above 50</p>}
                  {results.runCount >= 10 && results.latestCTL >= 50 && <p style={s.tip}>✓ Strong training base detected</p>}
                  <p style={s.tip}>CTL {results.latestCTL?.toFixed(0)} · {results.runCount} runs analysed</p>
                </div>
              </div>
            </div>
          </div>

          <div style={s.card}>
            <div style={s.cardTag}>WEEKLY VOLUME</div>
            <WeekChart data={results.weeklyData} />
          </div>
        </>
      )}

      <footer style={s.footer}>Riegel formula + CTL fitness modifier · predictions assume race-day conditions</footer>
    </div>
  );
}

const Field = ({ label, hint, children }) => (
  <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 5 }}>
    <label style={{ fontSize: 10, letterSpacing: "0.1em", color: "#555", textTransform: "uppercase" }}>
      {label}{hint && <span style={{ color: "#333", marginLeft: 6 }}>— {hint}</span>}
    </label>
    {children}
  </div>
);

const Step = ({ n, text }) => (
  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #191919" }}>
    <span style={{ background: "#c8f542", color: "#0a0a0a", borderRadius: 2, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{n}</span>
    <span style={{ fontSize: 12, color: "#666", lineHeight: 1.5 }}>{text}</span>
  </div>
);

function WeekChart({ data }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.km), 1);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 100, overflowX: "auto" }}>
      {data.map((w, i) => (
        <div key={i} style={{ flex: "1 0 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%" }}>
          <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
            <div style={{ width: "100%", height: `${(w.km / max) * 100}%`, background: "linear-gradient(to top, #c8f542, #8ab52a)", borderRadius: "2px 2px 0 0", minHeight: 3 }} />
          </div>
          <span style={{ fontSize: 9, color: "#444" }}>{w.km.toFixed(0)}</span>
        </div>
      ))}
    </div>
  );
}

const s = {
  root: { minHeight: "100vh", background: "#080808", color: "#e0e0d8", fontFamily: "'DM Mono', 'Courier New', monospace", padding: "28px 20px 60px", maxWidth: 860, margin: "0 auto", position: "relative" },
  bg: { position: "fixed", inset: 0, background: "radial-gradient(ellipse at 20% 20%, #0f1a04 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, #001a08 0%, transparent 60%)", pointerEvents: "none", zIndex: 0 },
  header: { textAlign: "center", marginBottom: 36, position: "relative", zIndex: 1 },
  logo: { fontSize: 24, color: "#c8f542", display: "block", marginBottom: 6 },
  title: { fontSize: "clamp(32px, 7vw, 58px)", fontWeight: 700, letterSpacing: "0.2em", margin: 0, color: "#eeeee6" },
  sub: { color: "#444", fontSize: 11, letterSpacing: "0.15em", marginTop: 6, textTransform: "uppercase" },
  card: { background: "#0f0f0f", border: "1px solid #1c1c1c", borderRadius: 4, padding: "24px", marginBottom: 14, position: "relative", zIndex: 1 },
  cardTag: { fontSize: 9, letterSpacing: "0.2em", color: "#c8f542", marginBottom: 18, textTransform: "uppercase", fontWeight: 600 },
  row: { display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 },
  input: { background: "#080808", border: "1px solid #242424", borderRadius: 3, color: "#e0e0d8", padding: "9px 12px", fontFamily: "inherit", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" },
  btn: { background: "#c8f542", color: "#080808", border: "none", borderRadius: 3, padding: "13px 28px", fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", cursor: "pointer", fontFamily: "inherit", width: "100%", marginTop: 6 },
  err: { background: "#1a0808", border: "1px solid #4a1010", color: "#f87171", borderRadius: 3, padding: "10px 14px", fontSize: 12, marginTop: 12 },
  steps: { marginTop: 20 },
  stepsTitle: { fontSize: 9, letterSpacing: "0.2em", color: "#333", textTransform: "uppercase", marginBottom: 8 },
  back: { background: "none", border: "1px solid #222", color: "#666", borderRadius: 3, padding: "7px 16px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", marginBottom: 14, display: "block" },
  predGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14, position: "relative", zIndex: 1 },
  predCard: { background: "#0f0f0f", border: "1px solid #1c1c1c", borderRadius: 4, padding: "18px 12px", textAlign: "center" },
  predIcon: { fontSize: 20, marginBottom: 6 },
  predLabel: { fontSize: 10, letterSpacing: "0.15em", color: "#555", textTransform: "uppercase", marginBottom: 8 },
  predTime: { fontSize: "clamp(16px, 2.5vw, 24px)", fontWeight: 700, color: "#c8f542", letterSpacing: "0.05em", marginBottom: 4 },
  predPace: { fontSize: 9, color: "#444" },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 },
  statRow: { display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #161616" },
  statL: { fontSize: 11, color: "#555" },
  statV: { fontSize: 12, fontWeight: 600, color: "#e0e0d8" },
  confWrap: { display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" },
  confNote: { flex: 1, display: "flex", flexDirection: "column", gap: 8 },
  tip: { fontSize: 11, color: "#666", margin: 0, lineHeight: 1.5 },
  footer: { textAlign: "center", color: "#2a2a2a", fontSize: 10, letterSpacing: "0.08em", marginTop: 28, position: "relative", zIndex: 1 },
};
