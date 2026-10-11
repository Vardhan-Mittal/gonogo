import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  ArrowRight, Bell, Camera, Mail, CloudRain, GitBranch, History, Loader2, MapPin, Pause, Play, Radio, Send, ShieldCheck,
} from "lucide-react";

import { api, OFFLINE, resizeImage } from "./api";
import type { DepthReport, Level, Replay, Spot, Status, StormSummary, ValidationSummary } from "./api";
import { Methodology, ProofBand } from "./Methodology";
import { Alerts } from "./Alerts";
import { STRINGS } from "./i18n";
import type { Lang } from "./i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const COLOR: Record<Level, string> = { SAFE: "#22c55e", RISKY: "#f59e0b", NO_GO: "#ef4444" };
const RANK: Record<Level, number> = { NO_GO: 0, RISKY: 1, SAFE: 2 };
const LEVEL_TEXT: Record<Level, string> = { SAFE: "text-safe", RISKY: "text-risky", NO_GO: "text-nogo" };
const LEVEL_BG: Record<Level, string> = { SAFE: "bg-safe", RISKY: "bg-risky", NO_GO: "bg-nogo" };
const REPO = "https://github.com/Vardhan-Mittal/gonogo";

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
  // Shareable replay links: ?replay=2024-06-28&step=5&focus=map
  const linkParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const linkApplied = useRef(false);
  const [mode, setMode] = useState<"live" | "replay">(linkParams.get("replay") || OFFLINE ? "replay" : "live");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [live, setLive] = useState<Record<string, Status>>({});
  const [storms, setStorms] = useState<StormSummary[]>([]);
  const [stormId, setStormId] = useState(linkParams.get("replay") || "2024-06-28");
  const [replay, setReplay] = useState<Replay | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sendAlerts, setSendAlerts] = useState(false);
  const [useForecast, setUseForecast] = useState(true);
  const [route, setRoute] = useState<string[]>(() => load("gonogo.route", []));
  const [bot, setBot] = useState("");
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [reportSpot, setReportSpot] = useState<Spot | null>(null);
  const [error, setError] = useState("");
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = heroRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => el.classList.toggle("paused", !e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
    api.validation().then(setValidation).catch(() => {});
    api.config().then((c) => setBot(c.bot_username)).catch(() => {});
    if (OFFLINE) return;
    const id = setInterval(refreshLive, 60_000);
    return () => clearInterval(id);
  }, [refreshLive]);

  useEffect(() => {
    if (mode !== "replay") return;
    setPlaying(false);
    setStep(0);
    api.replay(stormId).then((r) => {
      setReplay(r);
      if (linkApplied.current) return;
      linkApplied.current = true;
      const linkStep = Number(linkParams.get("step"));
      if (linkStep > 0) setStep(Math.min(linkStep, r.steps.length - 1));
      const focus = linkParams.get("focus");
      if (focus) setTimeout(() => document.getElementById(focus)?.scrollIntoView({ behavior: "instant" }), 600);
    }).catch((e) => setError(String(e.message || e)));
  }, [mode, stormId]);

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
    mode === "live" ? live : (useForecast ? replayStep?.statuses : replayStep?.statuses_gauge_only) ?? {};

  const sorted = useMemo(() => [...spots].sort((a, b) => {
    const la = statuses[a.id]?.level ?? "SAFE", lb = statuses[b.id]?.level ?? "SAFE";
    return RANK[la] - RANK[lb] || Number(route.includes(b.id)) - Number(route.includes(a.id));
  }), [spots, statuses, route]);

  const counts = useMemo(() => {
    const c: Record<Level, number> = { SAFE: 0, RISKY: 0, NO_GO: 0 };
    spots.forEach((s) => { c[statuses[s.id]?.level ?? "SAFE"] += 1; });
    return c;
  }, [spots, statuses]);
  const liveCounts = useMemo(() => {
    const c: Record<Level, number> = { SAFE: 0, RISKY: 0, NO_GO: 0 };
    spots.forEach((s) => { c[live[s.id]?.level ?? "SAFE"] += 1; });
    return c;
  }, [spots, live]);

  const worst: Level = counts.NO_GO ? "NO_GO" : counts.RISKY ? "RISKY" : "SAFE";
  const liveWorst: Level = liveCounts.NO_GO ? "NO_GO" : liveCounts.RISKY ? "RISKY" : "SAFE";

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
  const stormTitle = (s: StormSummary) => (lang === "hi" ? s.title_hi : s.title);
  const maxRain = replay ? Math.max(...replay.steps.map((s) => s.rain_mm), 1) : 1;

  const openReplay = () => {
    setStormId("2024-06-28");
    setMode("replay");
    document.getElementById("map")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-svh">
      {/* ---------- Nav ---------- */}
      <header className="fixed inset-x-0 top-0 z-[900] border-b border-white/5 bg-[#07070f]/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <a href="#top" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex flex-col gap-[3px] rounded-md bg-white/5 p-1.5 ring-1 ring-white/10" aria-hidden>
              <span className="size-1.5 rounded-full bg-nogo" /><span className="size-1.5 rounded-full bg-risky" /><span className="size-1.5 rounded-full bg-safe" />
            </span>
            GoNoGo
          </a>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#map" className="hover:text-foreground">{t.navMap}</a>
            <a href="#alerts" className="hover:text-foreground">{t.navAlerts}</a>
            <a href="#method" className="hover:text-foreground">{t.navMethod}</a>
            <a href="#how" className="hover:text-foreground">{t.navHow}</a>
            <a href="#aws" className="hover:text-foreground">{t.navAws}</a>
          </nav>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full bg-white/5 p-0.5 ring-1 ring-white/10" role="group" aria-label="Language">
              {(["en", "hi"] as Lang[]).map((l) => (
                <button key={l} onClick={() => setLang(l)}
                  className={cn("rounded-full px-3 py-1 text-xs font-medium transition", lang === l ? "bg-white text-black" : "text-muted-foreground hover:text-foreground")}>
                  {l === "en" ? "EN" : "हिं"}
                </button>
              ))}
            </div>
            <Button asChild size="sm" className="hidden rounded-full sm:inline-flex">
              <a href="#alerts"><Bell /> {t.navGetAlerts}</a>
            </Button>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section id="top" ref={heroRef} className="night-sky rain relative flex min-h-svh items-center justify-center overflow-hidden px-4 pt-24 pb-16">
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <div className="drop" />
        </div>
        <span className="glow left-[22%] top-[68%] size-6 bg-fuchsia-400/70" aria-hidden />
        <span className="glow right-[30%] bottom-[14%] size-5 bg-sky-400/70 [animation-delay:2s]" aria-hidden />

        <div className="relative z-10 flex max-w-4xl flex-col items-center text-center">
          <Badge variant="outline" className="mb-8 gap-2 rounded-full border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium tracking-[0.2em] text-white/75 uppercase backdrop-blur">
            <span className="size-1.5 rounded-full bg-sky-400 shadow-[0_0_10px] shadow-sky-400" />{t.heroEyebrow}
          </Badge>
          <h1 className="hero-title text-[clamp(3rem,11vw,8.5rem)] leading-[0.88] font-extrabold tracking-[-0.045em] uppercase">
            {t.heroTitle[0]}<br />{t.heroTitle[1]}
          </h1>
          <p className="mt-8 max-w-xl text-balance text-lg text-white/65 md:text-xl">{t.heroSub}</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-12 rounded-full bg-white/85 px-7 text-[15px] text-black hover:bg-white">
              <a href="#map">{t.ctaLive} <ArrowRight /></a>
            </Button>
            <Button variant="outline" size="lg" onClick={openReplay}
              className="h-12 rounded-full border-white/15 bg-white/5 px-7 text-[15px] backdrop-blur hover:bg-white/10">
              <Play /> {t.ctaReplay}
            </Button>
          </div>
          {spots.length > 0 && !OFFLINE && (
            <a href="#map" className="mt-12 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80 backdrop-blur hover:text-white">
              <span className={cn("size-2 animate-pulse rounded-full", LEVEL_BG[liveWorst])} />
              {t.rightNow}: {t.headline(liveCounts.NO_GO, liveCounts.RISKY, spots.length)}
            </a>
          )}
        </div>

      </section>

      <ProofBand lang={lang} v={validation} spotCount={spots.length} />

      {/* ---------- Map + spots ---------- */}
      <section id="map" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t.spotsTitle}</h2>
            <p className="mt-2 text-muted-foreground">{t.spotsSub}</p>
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "live" | "replay")}>
            <TabsList className="h-10 rounded-full p-1">
              <TabsTrigger value="live" className="rounded-full px-4"><Radio /> {t.live}</TabsTrigger>
              <TabsTrigger value="replay" className="rounded-full px-4"><History /> {t.replay}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {error && !(OFFLINE && mode === "live") && (
          <p className="mb-4 rounded-lg border border-nogo/30 bg-nogo/10 px-4 py-2 text-sm text-nogo">{error}</p>
        )}

        {/* Status banner */}
        <Card className="mb-4 gap-0 overflow-hidden py-0">
          <div className={cn("h-1 w-full", OFFLINE && mode === "live" ? "bg-muted" : LEVEL_BG[worst])} />
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {mode === "live" ? t.rightNow : `${t.replaying} · ${replayStep?.time.slice(0, 10) ?? ""} ${replayStep?.time.slice(11, 16) ?? ""}`}
              </p>
              <p className={cn("mt-1 text-2xl font-bold tracking-tight", !(OFFLINE && mode === "live") && LEVEL_TEXT[worst])}>
                {OFFLINE && mode === "live" ? t.offline : spots.length ? t.headline(counts.NO_GO, counts.RISKY, spots.length) : "…"}
              </p>
              {!(OFFLINE && mode === "live") && <p className="text-sm text-muted-foreground">{t.levelHint[worst]}</p>}
            </div>
            <div className="flex gap-2">
              {(["NO_GO", "RISKY", "SAFE"] as Level[]).map((l) => (
                <div key={l} className="min-w-24 rounded-lg border bg-background/40 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={cn("size-2 rounded-full", LEVEL_BG[l])} />{t.level[l]}
                  </div>
                  <div className="text-2xl font-bold tabular-nums">{counts[l]}</div>
                </div>
              ))}
            </div>
          </div>
          {mode === "live" && worst === "SAFE" && (
            <button onClick={openReplay} className="flex items-center gap-2 border-t px-5 py-3 text-left text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground">
              <CloudRain className="size-4" /> {t.seeReplay}
            </button>
          )}
        </Card>

        {/* Replay controls */}
        {mode === "replay" && (
          <Card className="mb-4 gap-4 py-5">
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <select value={stormId} onChange={(e) => setStormId(e.target.value)} aria-label={t.storm}
                  className="h-10 min-w-0 flex-1 rounded-md border bg-background/40 px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  {storms.map((s) => <option key={s.id} value={s.id} className="bg-card">{stormTitle(s)}</option>)}
                </select>
                {replay && (
                  <Button className="h-10 rounded-md px-5" onClick={() => {
                    if (!playing && step >= replay.steps.length - 1) setStep(0);
                    setPlaying((p) => !p);
                  }}>
                    {playing ? <><Pause /> {t.pause}</> : <><Play /> {t.play}</>}
                  </Button>
                )}
              </div>
              {replay && replayStep && (
                <>
                  <div className="flex h-28 items-end gap-1" role="slider" aria-label="Replay time" tabIndex={0}
                    aria-valuemin={0} aria-valuemax={replay.steps.length - 1} aria-valuenow={step}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, replay.steps.length - 1));
                      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
                    }}>
                    {replay.steps.map((s, i) => (
                      <button key={s.time} onClick={() => { setPlaying(false); setStep(i); }}
                        title={`${s.time.slice(11, 16)} · ${s.rain_mm} mm`}
                        className="group flex h-full min-w-0 flex-1 flex-col justify-end">
                        <span className={cn("block rounded-t-sm transition-colors",
                          i === step ? "bg-sky-400 shadow-[0_0_18px] shadow-sky-400/50" : i < step ? "bg-sky-400/45" : "bg-white/15 group-hover:bg-white/25")}
                          style={{ height: `${Math.max(4, (s.rain_mm / maxRain) * 100)}%` }} />
                        <span className={cn("mt-1 text-center text-[10px] tabular-nums", i === step ? "font-bold text-foreground" : "text-muted-foreground")}>
                          {s.time.slice(11, 13)}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{t.hourlyRain}</span>
                    <span className="flex items-center gap-1.5"><CloudRain className="size-4 text-sky-400" /><b className="text-lg tabular-nums">{replayStep.rain_mm}</b> {t.rainThisHour}</span>
                  </div>
                  <label className="flex items-center gap-3 text-sm">
                    <Switch checked={useForecast} onCheckedChange={setUseForecast} />
                    <span>{t.useForecast} <span className="text-muted-foreground">· {t.useForecastHint}</span></span>
                  </label>
                  <div className="rounded-lg border border-safe/20 bg-safe/5 p-4 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <ShieldCheck className="size-4 text-safe" />
                      {t.validation(useForecast ? replay.validation.flagged : replay.validation.flagged_gauge_only, replay.validation.reported)}
                      <span className="font-normal text-muted-foreground">· {t.peak} {replay.validation.peak_time.slice(11, 16)}</span>
                    </p>
                    <ul className="mt-2 grid gap-1.5">
                      {replay.validation.spots.map((v) => {
                        const sp = spots.find((s) => s.id === v.spot);
                        const time = useForecast ? v.first_no_go : v.first_no_go_gauge_only;
                        const lead = useForecast ? v.hours_before_peak : v.hours_before_peak_gauge_only;
                        return (
                          <li key={v.spot} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                            <span className="text-foreground">{sp ? name(sp) : v.spot}</span>
                            <span>{t.firstNoGo} <b className="text-foreground tabular-nums">{time?.slice(11, 16) ?? "-"}</b></span>
                            {lead != null && <Badge variant="outline" className={lead > 0 ? "border-safe/30 text-safe" : ""}>{t.lead(lead)}</Badge>}
                            <a href={v.source} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2 hover:text-foreground">source</a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  {!OFFLINE && (
                    <label className="flex items-center gap-3 text-sm">
                      <Switch checked={sendAlerts} onCheckedChange={setSendAlerts} />
                      <span>{t.sendReplayAlerts}</span>
                    </label>
                  )}
                  <p className="text-xs leading-relaxed text-muted-foreground">{replay.storm.note}</p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Map + list */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card id="map-card" className="h-[62vh] min-h-[420px] scroll-mt-20 overflow-hidden py-0 lg:sticky lg:top-20 lg:h-[72vh]">
            <MapContainer center={[28.64, 77.2]} zoom={11} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='Tiles &copy; Esri · Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" maxZoom={16} />
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}" maxZoom={16} />
              {spots.map((s) => {
                const lvl = statuses[s.id]?.level ?? "SAFE";
                const mine = route.includes(s.id);
                return (
                  <CircleMarker key={`${s.id}-${lvl}`} center={[s.lat, s.lon]}
                    radius={mine ? 12 : lvl === "SAFE" ? 7 : 10}
                    pathOptions={{
                      color: mine ? "#e0e7ff" : COLOR[lvl], weight: mine ? 3 : 2,
                      fillColor: COLOR[lvl], fillOpacity: 0.9, className: lvl === "NO_GO" ? "pulse" : "",
                    }}
                    eventHandlers={{ click: () => document.getElementById(`spot-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }) }}>
                    <Tooltip direction="top" offset={[0, -8]}><b>{name(s)}</b><br />{t.level[lvl]}</Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </Card>

          <div className="flex flex-col gap-3 lg:max-h-[72vh] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [&>*]:shrink-0">
            <Card id="route" className="scroll-mt-20 gap-4 py-5">
              <CardHeader className="gap-1">
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="size-4" /> {t.myRoute}
                  {route.length > 0 && <Badge variant="secondary" className="rounded-full">{route.length}</Badge>}
                </CardTitle>
                <CardDescription>{t.pickHint}</CardDescription>
              </CardHeader>
              <CardContent>
                {telegramLink ? (
                  <Button asChild className="w-full rounded-full bg-[#229ed9] text-white hover:bg-[#229ed9]/90">
                    <a href={telegramLink} target="_blank" rel="noreferrer"><Send /> {t.getAlerts}</a>
                  </Button>
                ) : (
                  <Button disabled className="w-full rounded-full"><Send /> {t.getAlerts}</Button>
                )}
                <a href="#alerts" className="mt-3 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                  <Mail className="size-4" /> {t.preferEmail} ↓
                </a>
              </CardContent>
            </Card>

            {sorted.map((s) => {
              const st = statuses[s.id];
              const lvl = st?.level ?? "SAFE";
              return (
                <Card key={s.id} id={`spot-${s.id}`} className={cn("relative gap-3 overflow-hidden py-4", lvl === "NO_GO" && "border-nogo/30 bg-nogo/[0.06]")}>
                  <span className={cn("absolute inset-y-0 left-0 w-1", LEVEL_BG[lvl])} />
                  <div className="flex items-start justify-between gap-3 px-5">
                    <label className="flex min-w-0 cursor-pointer items-start gap-3">
                      <Checkbox className="mt-0.5" checked={route.includes(s.id)} onCheckedChange={() => toggleRoute(s.id)}
                        aria-label={`${t.myRoute}: ${name(s)}`} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{name(s)}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.type[s.type] ?? s.type}{s.perennial && <> · <span className="text-risky">{t.perennial}</span></>}
                        </span>
                      </span>
                    </label>
                    <Badge className={cn("shrink-0 rounded-full text-black", LEVEL_BG[lvl])}>{t.level[lvl]}</Badge>
                  </div>
                  {st && (
                    <div className="grid grid-cols-3 gap-2 px-5">
                      {[[st.rain_1h_mm, t.stat1h], [st.rain_3h_mm, t.stat3h], [st.forecast_1h_mm, t.statNext]].map(([v, label]) => (
                        <div key={String(label)} className="rounded-md bg-muted/60 px-2.5 py-1.5">
                          <div className="font-semibold tabular-nums">{v}<span className="ml-0.5 text-xs font-normal text-muted-foreground">mm</span></div>
                          <div className="text-[11px] text-muted-foreground">{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(s.incidents.length > 0 || (mode === "live" && !OFFLINE) || st?.report_depth_in != null) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-5">
                      {s.incidents.length > 0 ? (
                        <details className="min-w-0 flex-1 text-xs text-muted-foreground">
                          <summary className="cursor-pointer hover:text-foreground">{t.incidents} ({s.incidents.length})</summary>
                          {s.incidents.map((i) => (
                            <p key={i.date} className="mt-1.5">
                              <b className="text-foreground">{i.date}</b> {i.text}{" "}
                              <a href={i.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">source</a>
                            </p>
                          ))}
                        </details>
                      ) : <span />}
                      {st?.report_depth_in != null && <Badge variant="outline"><Camera /> ~{st.report_depth_in} {t.inches}</Badge>}
                      {mode === "live" && !OFFLINE && (
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setReportSpot(s)}>
                          <Camera /> {t.report}
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
            <p className="px-1 text-xs text-muted-foreground">⚠ {t.never}</p>
          </div>
        </div>
      </section>

      <Alerts lang={lang} spots={spots} route={route} telegramLink={telegramLink} />

      {/* ---------- How it works ---------- */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-4 pb-20">
        <h2 className="mb-6 text-3xl font-bold tracking-tight">{t.navHow}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {t.steps.map(([title, body], i) => (
            <Card key={title} className="gap-3 py-6">
              <CardHeader>
                <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold">{i + 1}</span>
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <Methodology lang={lang} v={validation} spots={spots} />

      {/* ---------- Built on AWS ---------- */}
      <section id="aws" className="mx-auto max-w-6xl scroll-mt-16 px-4 pb-20">
        <Card className="gap-6 bg-gradient-to-br from-card to-[oklch(0.2_0.05_280)] py-8">
          <CardHeader>
            <CardTitle className="text-2xl tracking-tight">{t.awsTitle}</CardTitle>
            <CardDescription>{t.awsSub}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {["AWS Lambda", "Amazon API Gateway", "Amazon EventBridge Scheduler", "Amazon DynamoDB", "Amazon S3",
              "Amazon Bedrock · Nova Pro", "Amazon CloudWatch", "AWS SAM"].map((s) => (
              <Badge key={s} variant="outline" className="rounded-full border-white/15 bg-white/5 px-3 py-1 text-sm">{s}</Badge>
            ))}
          </CardContent>
        </Card>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>{t.footer}</p>
          <a href={REPO} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-foreground"><GitBranch className="size-4" /> GitHub</a>
        </div>
      </footer>

      <ReportDialog spot={reportSpot} lang={lang} onClose={() => setReportSpot(null)}
        onDone={(id, st) => setLive((l) => ({ ...l, [id]: st }))} />
    </div>
  );
}

function ReportDialog({ spot, lang, onClose, onDone }: {
  spot: Spot | null; lang: Lang; onClose: () => void; onDone: (id: string, s: Status) => void;
}) {
  const t = STRINGS[lang];
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<DepthReport | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setBusy(false); setPreview(""); setResult(null); setStatus(null); setErr("");
  }, [spot]);

  const onFile = async (file?: File) => {
    if (!file || !spot) return;
    setErr(""); setResult(null); setBusy(true);
    try {
      const b64 = await resizeImage(file);
      setPreview(`data:image/jpeg;base64,${b64}`);
      const r = await api.report(spot.id, b64, "image/jpeg");
      setResult(r.report); setStatus(r.status); onDone(spot.id, r.status);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={spot !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.reportTitle}</DialogTitle>
          <DialogDescription>{spot && (lang === "hi" ? spot.name_hi : spot.name)} · {t.reportHelp}</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.03] px-4 py-8 text-sm font-medium hover:bg-white/[0.06]">
          <Camera className="size-6 text-muted-foreground" />
          {t.choosePhoto}
          <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {preview && <img src={preview} alt="" className="w-full rounded-lg" />}
        {busy && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> {t.checking}</p>}
        {err && <p className="rounded-md border border-nogo/30 bg-nogo/10 px-3 py-2 text-sm text-nogo">{err}</p>}
        {result && status && (
          <div className="grid gap-2 rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <b className="text-base">{t.depth}: ~{result.depth_inches} {t.inches}</b>
              <Badge className={cn("rounded-full text-black", LEVEL_BG[status.level])}>{t.level[status.level]}</Badge>
            </div>
            <p className="text-muted-foreground">{result.explanation} ({t.confidence}: {result.confidence})</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
