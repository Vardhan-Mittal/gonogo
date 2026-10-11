import { BookOpenCheck, CloudRain, Database, Gauge, ShieldCheck, TriangleAlert } from "lucide-react";

import type { Spot, ValidationSummary } from "./api";
import { STRINGS } from "./i18n";
import type { Lang } from "./i18n";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Big-number evidence strip shown right under the hero. */
export function ProofBand({ lang, v, spotCount }: { lang: Lang; v: ValidationSummary | null; spotCount: number }) {
  const t = STRINGS[lang].proof;
  const stats: [string, string][] = [
    [v ? `${v.flagged}/${v.reported}` : "…", t.flagged],
    [v ? `${v.max_hours_before_peak} h` : "…", t.lead],
    [v ? String(v.storms) : "…", t.storms],
    [spotCount ? String(spotCount) : "19", t.spots],
  ];
  return (
    <section className="border-y border-white/5 bg-[#07070f]">
      <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4">
        {stats.map(([big, label], i) => (
          <div key={label} className={cn("px-4 py-8 md:px-6", i > 0 && "md:border-l md:border-white/10", i % 2 === 1 && "border-l border-white/10 md:border-l")}>
            <div className="text-4xl font-extrabold tracking-tight tabular-nums md:text-5xl">{big}</div>
            <div className="mt-2 text-xs leading-snug tracking-wide text-muted-foreground uppercase">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** "How we know it works": the rule, the score, the data, the test, the limits. */
export function Methodology({ lang, v, spots }: { lang: Lang; v: ValidationSummary | null; spots: Spot[] }) {
  const t = STRINGS[lang].method;
  const name = (id: string) => {
    const s = spots.find((x) => x.id === id);
    return s ? (lang === "hi" ? s.name_hi : s.name) : id;
  };
  const lead = STRINGS[lang].lead;

  return (
    <section id="method" className="mx-auto max-w-6xl scroll-mt-16 px-4 pb-20">
      <p className="mb-3 text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">{t.eyebrow}</p>
      <h2 className="max-w-3xl text-3xl leading-tight font-bold tracking-tight md:text-4xl">{t.title}</h2>
      <p className="mt-3 max-w-2xl text-muted-foreground">{t.lede}</p>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gauge className="size-4 text-sky-400" /> {t.ruleTitle}</CardTitle>
            <CardDescription className="leading-relaxed">{t.ruleBody}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline" className="rounded-full border-risky/40 text-risky">6 in → {STRINGS[lang].level.RISKY}</Badge>
            <Badge variant="outline" className="rounded-full border-nogo/40 text-nogo">8 in → {STRINGS[lang].level.NO_GO}</Badge>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="size-4 text-sky-400" /> {t.dataTitle}</CardTitle>
            <CardDescription className="leading-relaxed">{t.dataBody}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-end gap-3">
            {[["Open-Meteo", 24], ["IMD", 228]].map(([label, mm]) => (
              <div key={label} className="flex flex-1 flex-col gap-1">
                <div className="h-24 rounded-md bg-muted/50 flex items-end overflow-hidden">
                  <div className={cn("w-full rounded-md", label === "IMD" ? "bg-sky-400" : "bg-white/30")} style={{ height: `${(Number(mm) / 228) * 100}%` }} />
                </div>
                <div className="text-xs text-muted-foreground"><b className="text-foreground tabular-nums">{mm} mm</b> · {label}, 28 Jun 2024</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="gap-3 md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CloudRain className="size-4 text-sky-400" /> {t.scoreTitle}</CardTitle>
            <CardDescription className="leading-relaxed">{t.scoreBody}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1fr_1.2fr] md:items-center">
            <code className="rounded-lg border bg-background/50 p-4 font-mono text-sm leading-relaxed">
              score = max(<br />
              &nbsp;&nbsp;rain<sub>1h</sub> / limit<sub>1h</sub>,<br />
              &nbsp;&nbsp;rain<sub>3h</sub> / limit<sub>3h</sub>,<br />
              &nbsp;&nbsp;forecast<sub>1h</sub> / limit<sub>1h</sub>)<br />
              <span className="text-risky">≥ 0.5 → {STRINGS[lang].level.RISKY}</span> · <span className="text-nogo">≥ 1 → {STRINGS[lang].level.NO_GO}</span>
            </code>
            <div className="overflow-x-auto">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t.limits}</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>{t.limitHead.map((h) => <th key={h} className="pb-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {t.limitRows.map((r) => (
                    <tr key={r[0]} className="border-t">
                      <td className="py-2 pr-3">{r[0]}</td>
                      <td className="py-2 tabular-nums">{r[1]}</td>
                      <td className="py-2 tabular-nums">{r[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-3 md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-safe" /> {t.testTitle}</CardTitle>
            <CardDescription className="leading-relaxed">{t.testBody}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>{t.testHead.map((h) => <th key={h} className="pb-2 pr-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {v?.rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-3 pr-3 font-medium">{lang === "hi" ? r.title_hi : r.title}</td>
                    <td className="py-3 pr-3 tabular-nums">{r.reported}</td>
                    <td className="py-3 pr-3 tabular-nums text-safe">{r.flagged}/{r.reported}</td>
                    <td className="py-3 pr-3 tabular-nums">{r.flagged_gauge_only}/{r.reported}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {r.spots.map((s) => (
                          <a key={s.spot} href={s.source} target="_blank" rel="noreferrer">
                            <Badge variant="outline" className={cn("rounded-full", (s.hours_before_peak ?? 0) > 0 ? "border-safe/30 text-safe" : "text-muted-foreground")}>
                              {name(s.spot)} · {s.hours_before_peak != null ? lead(s.hours_before_peak) : "—"}
                            </Badge>
                          </a>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {v && (
                  <tr className="border-t font-semibold">
                    <td className="py-3 pr-3">Σ {v.storms}</td>
                    <td className="py-3 pr-3 tabular-nums">{v.reported}</td>
                    <td className="py-3 pr-3 tabular-nums text-safe">{v.flagged}/{v.reported}</td>
                    <td className="py-3 pr-3 tabular-nums">{v.flagged_gauge_only}/{v.reported}</td>
                    <td className="py-3 text-sm font-normal text-muted-foreground">{v.flagged_before_peak}/{v.flagged} {STRINGS[lang].proof.lead}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="gap-3 md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TriangleAlert className="size-4 text-risky" /> {t.honestTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
              {t.honest.map((h) => <li key={h} className="flex gap-2"><BookOpenCheck className="mt-0.5 size-4 shrink-0" />{h}</li>)}
            </ul>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
