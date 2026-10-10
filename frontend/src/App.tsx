import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { api, OFFLINE, resizeImage } from "./api";
import type { DepthReport, Level, Replay, Spot, Status, StormSummary } from "./api";
import { STRINGS } from "./i18n";
import type { Lang } from "./i18n";

const COLOR: Record<Level, string> = { SAFE: "#16a34a", RISKY: "#f59e0b", NO_GO: "#dc2626" };
const RANK: Record<Level, number> = { NO_GO: 0, RISKY: 1, SAFE: 2 };
const ICON: Record<string, string> = { underpass: "🚇", tunnel: "🚇", road: "🛣️", junction: "🚦", basements: "🏢", street: "🏘️" };

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

function useDarkMode() {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => load("gonogo.lang", "en"));
  const t = STRINGS[lang];
  const dark = useDarkMode();
  const [mode, setMode] = useState<"live" | "replay">(OFFLINE ? "replay" : "live");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [live, setLive] = useState<Record<string, Status>>({});
  const [storms, setStorms] = useState<StormSummary[]>([]);
  const [stormId, setStormId] = useState("2024-06-28");
  const [replay, setReplay] = useState<Replay | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sendAlerts, setSendAlerts] = useState(false);
  const [useForecast, setUseForecast] = useState(true);
  const [route, setRoute] = useState<string[]>(() => load("gonogo.route", []));
  const [bot, setBot] = useState("");
  const [reportSpot, setReportSpot] = useState<Spot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => save("gonogo.lang", lang), [lang]);
  useEffect(() => save("gonogo.route", route), [route]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const refreshLive = useCallback(() => {
    api.spots().then((r) => { setSpots(r.spots); setLive(r.statuses); setError(""); })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    refreshLive();
    api.storms().then(setStorms).catch(() => {});
    api.config().then((c) => setBot(c.bot_username)).catch(() => {});
    if (OFFLINE) return;
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

  const replayStep = replay?.steps[step];
  const statuses: Record<string, Status> =
    mode === "live" ? live
      : (useForecast ? replayStep?.statuses : replayStep?.statuses_gauge_only) ?? {};

  const sorted = useMemo(() => [...spots].sort((a, b) => {
    const la = statuses[a.id]?.level ?? "SAFE", lb = statuses[b.id]?.level ?? "SAFE";
    return RANK[la] - RANK[lb] || Number(route.includes(b.id)) - Number(route.includes(a.id));
  }), [spots, statuses, route]);

  const counts = useMemo(() => {
    const c: Record<Level, number> = { SAFE: 0, RISKY: 0, NO_GO: 0 };
    spots.forEach((s) => { c[statuses[s.id]?.level ?? "SAFE"] += 1; });
    return c;
  }, [spots, statuses]);

  const worst: Level = counts.NO_GO ? "NO_GO" : counts.RISKY ? "RISKY" : "SAFE";

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
  const stormTitle = (s: StormSummary) => (lang === "hi" ? s.title_hi : s.title);
  const maxRain = replay ? Math.max(...replay.steps.map((s) => s.rain_mm), 1) : 1;
  const showOffline = OFFLINE && mode === "live";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="lights" aria-hidden>
            <span style={{ background: COLOR.NO_GO }} /><span style={{ background: COLOR.RISKY }} /><span style={{ background: COLOR.SAFE }} />
          </div>
          <div>
            <h1>Go<span>/</span>NoGo</h1>
            <p className="tagline">{t.tagline}</p>
          </div>
        </div>
        <div className="seg" role="group" aria-label="Language">
          <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          <button className={lang === "hi" ? "on" : ""} onClick={() => setLang("hi")}>हिं</button>
        </div>
      </header>

      <section className={`hero hero-${showOffline ? "OFF" : worst}`}>
        <div className="hero-text">
          <p className="eyebrow">
            {mode === "live" ? `● ${t.rightNow}` : `⏪ ${t.replaying} · ${cur?.time.slice(0, 10) ?? ""} ${cur?.time.slice(11, 16) ?? ""}`}
          </p>
          <h2>{showOffline ? t.offline : spots.length ? t.headline(counts.NO_GO, counts.RISKY, spots.length) : "…"}</h2>
          {!showOffline && <p className="hero-hint">{t.levelHint[worst]}</p>}
          {mode === "live" && (showOffline || worst === "SAFE") && (
            <button className="hero-link" onClick={() => { setStormId("2024-06-28"); setMode("replay"); }}>{t.seeReplay}</button>
          )}
        </div>
        <div className="seg big" role="tablist">
          <button role="tab" aria-selected={mode === "live"} className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>{t.live}</button>
          <button role="tab" aria-selected={mode === "replay"} className={mode === "replay" ? "on" : ""} onClick={() => setMode("replay")}>{t.replay}</button>
        </div>
      </section>

      {error && !showOffline && <div className="error">⚠ {error}</div>}

      {mode === "live" && (
        <ol className="how">
          {t.steps.map(([title, body], i) => (
            <li key={title} className="card"><span className="num">{i + 1}</span><div><b>{title}</b><p>{body}</p></div></li>
          ))}
        </ol>
      )}

      {mode === "replay" && (
        <section className="replay card">
          <div className="replay-head">
            <select value={stormId} onChange={(e) => setStormId(e.target.value)} aria-label={t.storm}>
              {storms.map((s) => <option key={s.id} value={s.id}>{stormTitle(s)}</option>)}
            </select>
            {replay && (
              <button className="play" onClick={() => {
                if (!playing && step >= replay.steps.length - 1) setStep(0);
                setPlaying((p) => !p);
              }}>
                {playing ? `❚❚ ${t.pause}` : `▶ ${t.play}`}
              </button>
            )}
          </div>
          {replay && cur && (
            <>
              <div className="bars" role="slider" aria-label="Replay time" aria-valuemin={0}
                aria-valuemax={replay.steps.length - 1} aria-valuenow={step} tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, replay.steps.length - 1));
                  if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
                }}>
                {replay.steps.map((s, i) => (
                  <button key={s.time} className={`bar ${i === step ? "now" : ""} ${i < step ? "past" : ""}`}
                    onClick={() => { setPlaying(false); setStep(i); }} title={`${s.time.slice(11, 16)} · ${s.rain_mm} mm`}>
                    <span className="fill" style={{ height: `${Math.max(4, (s.rain_mm / maxRain) * 100)}%` }} />
                    <span className="lbl">{s.time.slice(11, 13)}</span>
                  </button>
                ))}
              </div>
              <div className="replay-foot">
                <span className="muted">{t.hourlyRain}</span>
                <span className="rainnow">🌧 <b>{cur.rain_mm}</b> {t.rainThisHour}</span>
              </div>
              <label className="check forecast">
                <input type="checkbox" checked={useForecast} onChange={(e) => setUseForecast(e.target.checked)} />
                <span>{t.useForecast}<small>{t.useForecastHint}</small></span>
              </label>
              <div className="validation">
                <b>✅ {t.validation(useForecast ? replay.validation.flagged : replay.validation.flagged_gauge_only, replay.validation.reported)}</b>
                <span className="muted"> · {t.peak} {replay.validation.peak_time.slice(11, 16)}</span>
                {replay.validation.spots.map((v) => {
                  const sp = spots.find((s) => s.id === v.spot);
                  const time = useForecast ? v.first_no_go : v.first_no_go_gauge_only;
                  const lead = useForecast ? v.hours_before_peak : v.hours_before_peak_gauge_only;
                  return (
                    <div key={v.spot} className="vrow">
                      {sp ? name(sp) : v.spot}: {t.firstNoGo} <b>{time?.slice(11, 16) ?? "-"}</b>
                      {lead != null && <span className={lead > 0 ? "lead good" : "lead"}>{t.lead(lead)}</span>}{" "}
                      <a href={v.source} target="_blank" rel="noreferrer">source ↗</a>
                    </div>
                  );
                })}
              </div>
              {!OFFLINE && (
                <label className="check">
                  <input type="checkbox" checked={sendAlerts} onChange={(e) => setSendAlerts(e.target.checked)} />
                  {t.sendReplayAlerts}
                </label>
              )}
              <p className="note">{replay.storm.note}</p>
            </>
          )}
        </section>
      )}

      <div className="legend">
        {(["NO_GO", "RISKY", "SAFE"] as Level[]).map((l) => (
          <div key={l} className="pill">
            <span className="dot" style={{ background: COLOR[l] }} />
            <b>{counts[l]}</b>
            <span>{t.level[l]}</span>
            <small>{t.levelHint[l]}</small>
          </div>
        ))}
      </div>

      <main className="layout">
        <div className="map card">
          <MapContainer center={[28.64, 77.2]} zoom={11} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
            <TileLayer className={dark ? "tiles-dark" : "tiles-light"}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {spots.map((s) => {
              const lvl = statuses[s.id]?.level ?? "SAFE";
              const mine = route.includes(s.id);
              return (
                <CircleMarker key={`${s.id}-${lvl}`} center={[s.lat, s.lon]}
                  radius={mine ? 13 : lvl === "SAFE" ? 8 : 11}
                  pathOptions={{
                    color: mine ? "#2563eb" : "#ffffff", weight: mine ? 4 : 2,
                    fillColor: COLOR[lvl], fillOpacity: 0.95, className: lvl === "NO_GO" ? "pulse" : "",
                  }}
                  eventHandlers={{ click: () => document.getElementById(`spot-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }) }}>
                  <Tooltip direction="top" offset={[0, -8]}><b>{name(s)}</b><br />{t.level[lvl]}</Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        <aside className="list">
          <div className="card routebox">
            <div>
              <h3>{t.myRoute} {route.length > 0 && <span className="count">{route.length}</span>}</h3>
              <p>{t.pickHint}</p>
            </div>
            {telegramLink ? (
              <a className="tg" href={telegramLink} target="_blank" rel="noreferrer">✈ {t.getAlerts}</a>
            ) : (
              <button className="tg" disabled>✈ {t.getAlerts}</button>
            )}
          </div>

          {sorted.map((s) => {
            const st = statuses[s.id];
            const lvl = st?.level ?? "SAFE";
            return (
              <article key={s.id} id={`spot-${s.id}`} className={`spot card lvl-${lvl}`}>
                <div className="spothead">
                  <label className="check">
                    <input type="checkbox" checked={route.includes(s.id)} onChange={() => toggleRoute(s.id)} aria-label={`${t.myRoute}: ${name(s)}`} />
                    <span>
                      <span className="spotname">{name(s)}</span>
                      <span className="sub">{ICON[s.type] ?? "📍"} {t.type[s.type] ?? s.type}{s.perennial && <> · <em>{t.perennial}</em></>}</span>
                    </span>
                  </label>
                  <span className="badge" style={{ background: COLOR[lvl] }}>{t.level[lvl]}</span>
                </div>
                {st && (
                  <div className="stats">
                    <div><b>{st.rain_1h_mm}</b><span>mm · {t.stat1h}</span></div>
                    <div><b>{st.rain_3h_mm}</b><span>mm · {t.stat3h}</span></div>
                    <div><b>{st.forecast_1h_mm}</b><span>mm · {t.statNext}</span></div>
                    {st.report_depth_in != null && <div><b>~{st.report_depth_in}″</b><span>📷 {t.photo}</span></div>}
                  </div>
                )}
                <div className="actions">
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
                  {mode === "live" && !OFFLINE && (
                    <button className="report" onClick={() => setReportSpot(s)}>📷 {t.report}</button>
                  )}
                </div>
              </article>
            );
          })}
          <p className="note">⚠ {t.never}</p>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className="modal" role="dialog" aria-modal="true" aria-label={t.reportTitle} onClick={onClose}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{t.reportTitle}</h2>
        <p className="spotname">{lang === "hi" ? spot.name_hi : spot.name}</p>
        <p className="note">{t.reportHelp}</p>
        <label className="upload">
          📷 {t.choosePhoto}
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
