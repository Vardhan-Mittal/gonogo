import { useState } from "react";
import { BellRing, CheckCircle2, Loader2, Mail, MapPin, Send } from "lucide-react";

import { api, OFFLINE } from "./api";
import type { Spot } from "./api";
import { STRINGS } from "./i18n";
import type { Lang } from "./i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

/** Sign up for alerts (Telegram or email via Amazon SNS) + a preview of the message. */
export function Alerts({ lang, spots, route, telegramLink }: {
  lang: Lang; spots: Spot[]; route: string[]; telegramLink: string;
}) {
  const t = STRINGS[lang].alerts;
  const [email, setEmail] = useState("");
  const [replay, setReplay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const picked = spots.filter((s) => route.includes(s.id));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await api.subscribeEmail(email.trim(), route, lang, replay);
      setDone(true);
    } catch (ex) {
      setErr(String((ex as Error).message || ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="alerts" className="mx-auto max-w-6xl scroll-mt-16 px-4 pb-20">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] [&>*]:min-w-0">
        <div>
          <p className="mb-3 text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">{t.eyebrow}</p>
          <h2 className="text-3xl leading-tight font-bold tracking-tight md:text-4xl">{t.title}</h2>
          <p className="mt-3 max-w-xl text-muted-foreground">{t.lede}</p>

          <div className="mt-6 rounded-xl border bg-card/60 p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><MapPin className="size-4" /> {t.yourRoute}</p>
            {picked.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {picked.map((s) => <Badge key={s.id} variant="secondary" className="rounded-full">{lang === "hi" ? s.name_hi : s.name}</Badge>)}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t.noRoute} <a href="#map" className="underline underline-offset-2">{t.pickOnMap} ↑</a></p>
            )}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card className="gap-3 py-5">
              <CardContent className="grid gap-3">
                <p className="flex items-center gap-2 font-semibold"><Send className="size-4 text-[#229ed9]" /> {t.telegramTitle}</p>
                <p className="text-sm text-muted-foreground">{t.telegramHint}</p>
                {telegramLink ? (
                  <Button asChild className="mt-auto rounded-full bg-[#229ed9] text-white hover:bg-[#229ed9]/90">
                    <a href={telegramLink} target="_blank" rel="noreferrer"><Send /> {STRINGS[lang].getAlerts}</a>
                  </Button>
                ) : (
                  <Button disabled className="mt-auto rounded-full"><Send /> {STRINGS[lang].getAlerts}</Button>
                )}
              </CardContent>
            </Card>

            <Card className="gap-3 py-5">
              <CardContent>
                <p className="flex items-center gap-2 font-semibold"><Mail className="size-4 text-sky-400" /> {t.emailTitle}</p>
                <p className="mt-3 text-sm text-muted-foreground">{t.emailHint}</p>
                {done ? (
                  <p className="mt-3 flex gap-2 rounded-lg border border-safe/30 bg-safe/10 p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-safe" />{t.done}</p>
                ) : (
                  <form onSubmit={submit} className="mt-3 grid gap-2.5">
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder={t.emailPlaceholder} aria-label={t.emailTitle} disabled={OFFLINE}
                      className="h-10 w-full rounded-md border bg-background/50 px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={replay} onCheckedChange={(v) => setReplay(v === true)} /> {t.replayOptIn}
                    </label>
                    <Button type="submit" variant="outline" className="rounded-full" disabled={busy || OFFLINE || route.length === 0}>
                      {busy ? <Loader2 className="animate-spin" /> : <BellRing />} {t.subscribe}
                    </Button>
                    {err && <p className="text-xs text-nogo">{err}</p>}
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Phone preview of a real alert */}
        <div className="flex flex-col items-center">
          <p className="mb-3 self-start text-sm font-medium text-muted-foreground lg:self-center">{t.previewTitle}</p>
          <div className="w-full max-w-[340px] rounded-[2.4rem] border-[10px] border-[#1b1b24] bg-[#0e1621] p-3 shadow-[0_30px_80px_-20px_rgba(80,60,200,.45)]">
            <div className="mx-auto mb-3 h-1.5 w-20 rounded-full bg-white/15" />
            <div className="flex items-center gap-2 rounded-xl bg-[#17212b] px-3 py-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#229ed9] text-sm">🚦</span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">GoNoGo</p>
                <p className="text-[11px] text-muted-foreground">{t.sampleChat}</p>
              </div>
            </div>
            <div className="mt-4 min-h-[220px] space-y-3">
              <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-[#182533] px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-line">
                {t.sample}
              </div>
              <div className="ml-auto w-fit rounded-2xl rounded-tr-sm bg-[#2b5278] px-3 py-1.5 text-[13px]">/status</div>
            </div>
          </div>
          <div className="mt-4 w-full max-w-[340px] rounded-xl border bg-card/60 p-3 text-xs">
            <p className="flex items-center gap-1.5 text-muted-foreground"><Mail className="size-3.5" /> AWS Notifications</p>
            <p className="mt-1 font-medium">{t.sampleSubject}</p>
          </div>
          <p className="mt-3 max-w-[340px] text-center text-xs text-muted-foreground">{t.previewNote}</p>
        </div>
      </div>
    </section>
  );
}
