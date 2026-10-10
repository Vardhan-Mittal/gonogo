import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { api, resizeImage } from "./api";
import type { DepthReport, Level, Replay, Spot, Status, StormSummary } from "./api";
import { STRINGS } from "./i18n";
import type { Lang } from "./i18n";

const COLOR: Record<Level, string> = { SAFE: "#1a9e55", RISKY: "#e8a317", NO_GO: "#d93025" };
const RANK: Record<Level, number> = { NO_GO: 0, RISKY: 1, SAFE: 2 };

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => load("gonogo.lang", "en"));
  const t = STRINGS[lang];
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [live, setLive] = useState<Record<string, Status>>({});
  const [storms, setStorms] = useState<StormSummary[]>([]);
  const [stormId, setStormId] = useState("2024-06-28");
  const [replay, setReplay] = useState<Replay | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sendAlerts, setSendAlerts] = useState(false);
  const [route, setRoute] = useState<string[]>(() => load("gonogo.route", []));
  const [bot, setBot] = useState("");
  const [reportSpot, setReportSpot] = useState<Spot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => save("gonogo.lang", lang), [lang]);
  useEffect(() => save("gonogo.route", route), [route]);

  const refreshLive = useCallback(() => {
    api.spots().then((r) => { setSpots(r.spots); setLive(r.statuses); setError(""); })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    refreshLive();
    api.storms().then(setStorms).catch(() => {});
    api.config().then((c) => setBot(c.bot_username)).catch(() => {});
    const id = setInterval(refreshLive, 60_000);
    return () => clearInterval(id);
  }, [refreshLive]);

  useEffect(() => {
    if (mode !== "replay") return;
    setPlaying(false);
    setStep(0);
    api.replay(stormId).then(setReplay).catch((e) => setError(String(e.message || e)));
  }, [mode, stormId]);

  // Advance the replay clock while playing.
  useEffect(() => {
    if (!playing || !replay) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s + 1 >= replay.steps.length) { setPlaying(false); return s; }
        return s + 1;
      });
    }, 1600);
    return () => clearInterval(id);
  }, [playing, replay]);

  // Fire the real alert pipeline for each replayed hour, if asked to.
  const lastNotified = useRef<string>("");
  useEffect(() => {
    if (mode !== "replay" || !sendAlerts || !replay) return;
    const key = `${stormId}:${step}`;
    if (lastNotified.current === key) return;
    lastNotified.current = key;
    api.replayNotify(stormId, step).catch(() => {});
  }, [mode, sendAlerts, replay, stormId, step]);

  const statuses: Record<string, Status> =
    mode === "live" ? live : replay?.steps[step]?.statuses ?? {};

  const sorted = useMemo(() => [...spots].sort((a, b) => {
    const la = statuses[a.id]?.level ?? "SAFE", lb = statuses[b.id]?.level ?? "SAFE";
    return RANK[la] - RANK[lb] || Number(route.includes(b.id)) - Number(route.includes(a.id));
  }), [spots, statuses, route]);

  const counts = useMemo(() => {
    const c: Record<Level, number> = { SAFE: 0, RISKY: 0, NO_GO: 0 };
    spots.forEach((s) => { c[statuses[s.id]?.level ?? "SAFE"] += 1; });
    return c;
  }, [spots, statuses]);

  const toggleRoute = (id: string) =>
    setRoute((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  const telegramLink = useMemo(() => {
    if (!bot || route.length === 0) return "";
    let payload = lang;
    for (const id of route) {
      if ((payload + "-" + id).length > 64) break;
      payload += "-" + id;
    }
    return `https://t.me/${bot}?start=${payload}`;
  }, [bot, route, lang]);

  const name = (s: Spot) => (lang === "hi" ? s.name_hi : s.name);
  const cur = replay?.steps[step];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>⛔</span>
          <div>
            <h1>GoNoGo</h1>
            <p className="tagline">{t.tagline}</p>
          </div>
        </div>
        <div className="lang" role="group" aria-label="Language">
          <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          <button className={lang === "hi" ? "on" : ""} onClick={() => setLang("hi")}>हिं</button>
        </div>
      </header>

      <nav className="tabs">
        <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>● {t.live}</button>
        <button className={mode === "replay" ? "on" : ""} onClick={() => setMode("replay")}>⏪ {t.replay}</button>
      </nav>

      {error && <div className="error">⚠ {error}</div>}

      {mode === "replay" && (
        <section className="replay card">
          <label className="row">
            <span>{t.storm}</span>
            <select value={stormId} onChange={(e) => setStormId(e.target.value)}>
              {storms.map((s) => <option key={s.id} value={s.id}>{lang === "hi" ? s.title_hi : s.title}</option>)}
            </select>
          </label>
          {replay && cur && (
            <>
              <div className="clock">
                <button className="play" onClick={() => {
                  if (!playing && step >= replay.steps.length - 1) setStep(0);
                  setPlaying((p) => !p);
                }}>
                  {playing ? `❚❚ ${t.pause}` : `▶ ${t.play}`}
                </button>
                <div className="time">
                  <strong>{cur.time.slice(11, 16)}</strong>
                  <span>{cur.time.slice(0, 10)}</span>
                </div>
                <div className="rainbar" title={`${cur.rain_mm} ${t.rainThisHour}`}>
                  <div style={{ width: `${Math.min(100, (cur.rain_mm / 60) * 100)}%` }} />
                  <span>🌧 {cur.rain_mm} {t.rainThisHour}</span>
                </div>
              </div>
              <input type="range" min={0} max={replay.steps.length - 1} value={step}
                onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }} aria-label="Replay time" />
              <label className="check">
                <input type="checkbox" checked={sendAlerts} onChange={(e) => setSendAlerts(e.target.checked)} />
                {t.sendReplayAlerts}
              </label>
              <div className="validation">
                ✅ {t.validation(replay.validation.flagged, replay.validation.reported)}
                {replay.validation.spots.map((v) => {
                  const sp = spots.find((s) => s.id === v.spot);
                  return (
                    <div key={v.spot} className="vrow">
                      {sp ? name(sp) : v.spot}: {t.firstNoGo} <b>{v.first_no_go?.slice(11, 16) ?? "-"}</b>{" "}
                      <a href={v.source} target="_blank" rel="noreferrer">↗</a>
                    </div>
                  );
                })}
              </div>
              <p className="note">{replay.storm.note}</p>
            </>
          )}
        </section>
      )}

      <div className="summary">
        {(["NO_GO", "RISKY", "SAFE"] as Level[]).map((l) => (
          <div key={l} className="pill" style={{ borderColor: COLOR[l] }}>
            <span className="dot" style={{ background: COLOR[l] }} />
            <b>{counts[l]}</b> {t.level[l]}
          </div>
        ))}
      </div>

      <main className="layout">
        <div className="map card">
          <MapContainer center={[28.64, 77.2]} zoom={11} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {spots.map((s) => {
              const lvl = statuses[s.id]?.level ?? "SAFE";
              return (
                <CircleMarker key={s.id} center={[s.lat, s.lon]}
                  radius={route.includes(s.id) ? 13 : 9}
                  pathOptions={{ color: route.includes(s.id) ? "#1d3557" : "#fff", weight: route.includes(s.id) ? 3 : 2, fillColor: COLOR[lvl], fillOpacity: 0.95 }}
                  eventHandlers={{ click: () => document.getElementById(`spot-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }) }}>
                  <Tooltip>{name(s)}: {t.level[lvl]}</Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        <aside className="list">
          <div className="card routebox">
            <h2>{t.myRoute}</h2>
            <p>{t.pickHint}</p>
            {telegramLink ? (
              <a className="tg" href={telegramLink} target="_blank" rel="noreferrer">✈ {t.getAlerts} ({route.length})</a>
            ) : (
              <button className="tg" disabled>✈ {t.getAlerts}</button>
            )}
          </div>

          {sorted.map((s) => {
            const st = statuses[s.id];
            const lvl = st?.level ?? "SAFE";
            return (
              <article key={s.id} id={`spot-${s.id}`} className="spot card" style={{ borderLeftColor: COLOR[lvl] }}>
                <div className="spothead">
                  <label className="check">
                    <input type="checkbox" checked={route.includes(s.id)} onChange={() => toggleRoute(s.id)} aria-label={`${t.myRoute}: ${name(s)}`} />
                    <h3>{name(s)}</h3>
                  </label>
                  <span className="badge" style={{ background: COLOR[lvl] }}>{t.level[lvl]}</span>
                </div>
                {st ? (
                  <p className="meta">
                    {t.levelHint[lvl]} · 🌧 {st.rain_1h_mm} {t.rainLastHour} · {st.forecast_1h_mm} {t.rainNextHour}
                    {st.report_depth_in != null && <> · 📷 ~{st.report_depth_in} {t.inches}</>}
                  </p>
                ) : (
                  <p className="meta">{t.noData}</p>
                )}
                {s.incidents.length > 0 && (
                  <details>
                    <summary>{t.incidents} ({s.incidents.length})</summary>
                    {s.incidents.map((i) => (
                      <p key={i.date} className="incident">
                        <b>{i.date}</b>: {i.text} <a href={i.url} target="_blank" rel="noreferrer">↗</a>
                      </p>
                    ))}
                  </details>
                )}
                {mode === "live" && (
                  <button className="report" onClick={() => setReportSpot(s)}>📷 {t.report}</button>
                )}
              </article>
            );
          })}
          <p className="note">{t.never}</p>
          <p className="note">{t.dataNote}</p>
        </aside>
      </main>

      {reportSpot && (
        <ReportDialog spot={reportSpot} lang={lang} onClose={() => setReportSpot(null)}
          onDone={(st) => setLive((l) => ({ ...l, [reportSpot.id]: st }))} />
      )}
    </div>
  );
}

function ReportDialog({ spot, lang, onClose, onDone }: {
  spot: Spot; lang: Lang; onClose: () => void; onDone: (s: Status) => void;
}) {
  const t = STRINGS[lang];
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<DepthReport | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState("");

  const onFile = async (file?: File) => {
    if (!file) return;
    setErr(""); setResult(null); setBusy(true);
    try {
      const b64 = await resizeImage(file);
      setPreview(`data:image/jpeg;base64,${b64}`);
      const r = await api.report(spot.id, b64, "image/jpeg");
      setResult(r.report); setStatus(r.status); onDone(r.status);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{t.reportTitle}</h2>
        <p className="spotname">{lang === "hi" ? spot.name_hi : spot.name}</p>
        <p className="note">{t.reportHelp}</p>
        <label className="upload">
          {t.choosePhoto}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
        </label>
        {preview && <img src={preview} alt="" className="preview" />}
        {busy && <p className="busy">⏳ {t.checking}</p>}
        {err && <p className="error">⚠ {err}</p>}
        {result && status && (
          <div className="result" style={{ borderColor: COLOR[status.level] }}>
            <p><b>{t.depth}: ~{result.depth_inches} {t.inches}</b> ({t.confidence}: {result.confidence})</p>
            <p>{result.explanation}</p>
            <span className="badge" style={{ background: COLOR[status.level] }}>{t.level[status.level]}</span>
          </div>
        )}
        <button className="close" onClick={onClose}>{t.close}</button>
      </div>
    </div>
  );
}
