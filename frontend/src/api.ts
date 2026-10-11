export type Level = "SAFE" | "RISKY" | "NO_GO";

export interface Incident { date: string; text: string; url: string }
export interface Spot {
  id: string; name: string; name_hi: string; type: string;
  lat: number; lon: number; perennial: boolean; incidents: Incident[];
}
export interface Status {
  level: Level; score: number; driver: string;
  rain_1h_mm: number; rain_3h_mm: number; forecast_1h_mm: number;
  report_depth_in: number | null; updated?: number;
}
export interface StormSummary { id: string; title: string; title_hi: string; start: string }
export interface ReplayStep {
  time: string; rain_mm: number;
  statuses: Record<string, Status>;
  statuses_gauge_only: Record<string, Status>;
}
export interface ValidationSpot {
  spot: string; source: string;
  first_no_go: string | null; first_no_go_gauge_only: string | null;
  hours_before_peak: number | null; hours_before_peak_gauge_only: number | null;
}
export interface Replay {
  storm: StormSummary & { station: string; note: string; sources: string[]; stations_source: string | null };
  spot_rain_factor: Record<string, number>;
  steps: ReplayStep[];
  validation: {
    reported: number; flagged: number; flagged_gauge_only: number;
    peak_time: string; no_go_at_peak: number; total_spots: number;
    spots: ValidationSpot[];
  };
}
export interface ValidationRow {
  id: string; title: string; title_hi: string;
  reported: number; flagged: number; flagged_gauge_only: number; peak_time: string;
  spots: ValidationSpot[];
}
export interface ValidationSummary {
  storms: number; reported: number; flagged: number; flagged_gauge_only: number;
  flagged_before_peak: number; max_hours_before_peak: number; rows: ValidationRow[];
}
export interface DepthReport {
  usable: boolean; depth_inches: number; confidence: string;
  reference_object: string; explanation: string; time: string;
}
interface ReportJob {
  id: string; state: "pending" | "done" | "error"; error?: string;
  report?: DepthReport; status?: Status;
}

const CONFIGURED = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
const BASE = CONFIGURED || (import.meta.env.DEV ? "http://localhost:8787" : "");

/** No backend configured: serve spots and replays from bundled JSON (see backend/export_static.py). */
export const OFFLINE = !BASE;

async function staticJson<T>(file: string): Promise<T> {
  const res = await fetch(`/static-data/${file}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const offlineError = () => Promise.reject(new Error("The live service is not connected yet. Storm replay still works."));

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

const online = {
  config: () => call<{ bot_username: string }>("/config"),
  spots: () => call<{ spots: Spot[]; statuses: Record<string, Status> }>("/spots"),
  storms: () => call<StormSummary[]>("/storms"),
  validation: () => call<ValidationSummary>("/validation"),
  replay: (id: string) => call<Replay>(`/replay/${id}`),
  replayNotify: (id: string, step: number) =>
    call<{ worsened: string[]; sent: number }>(`/replay/${id}/notify`, { method: "POST", body: JSON.stringify({ step }) }),
  /** Submit a photo, then poll until the worker has estimated the depth. */
  report: async (spot: string, image: string, media_type: string) => {
    let job = await call<ReportJob>("/reports", { method: "POST", body: JSON.stringify({ spot, image, media_type }) });
    const deadline = Date.now() + 150_000;
    while (job.state === "pending" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      job = await call<ReportJob>(`/reports/${job.id}`);
    }
    if (job.state === "error") throw new Error(job.error || "Could not check this photo.");
    if (job.state !== "done" || !job.report || !job.status) throw new Error("Still checking. Please look again in a minute.");
    return { report: job.report, status: job.status };
  },
};

const offline: typeof online = {
  config: () => Promise.resolve({ bot_username: "" }),
  spots: () => staticJson("spots.json"),
  storms: () => staticJson("storms.json"),
  validation: () => staticJson("validation.json"),
  replay: (id) => staticJson(`replay-${id}.json`),
  replayNotify: offlineError,
  report: offlineError,
};

export const api = OFFLINE ? offline : online;

/** Shrink a photo to at most 1280px on the long side and return base64 JPEG. */
export async function resizeImage(file: File, max = 1280): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This photo format can't be read here. Please use a JPEG or PNG photo.");
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}
