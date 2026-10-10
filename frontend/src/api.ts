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
export interface ReplayStep { time: string; rain_mm: number; statuses: Record<string, Status> }
export interface Replay {
  storm: StormSummary & { station: string; note: string; sources: string[] };
  steps: ReplayStep[];
  validation: { reported: number; flagged: number; spots: { spot: string; source: string; first_no_go: string | null }[] };
}
export interface DepthReport {
  usable: boolean; depth_inches: number; confidence: string;
  reference_object: string; explanation: string; time: string;
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8787";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  config: () => call<{ bot_username: string }>("/config"),
  spots: () => call<{ spots: Spot[]; statuses: Record<string, Status> }>("/spots"),
  storms: () => call<StormSummary[]>("/storms"),
  replay: (id: string) => call<Replay>(`/replay/${id}`),
  replayNotify: (id: string, step: number) =>
    call<{ worsened: string[]; sent: number }>(`/replay/${id}/notify`, { method: "POST", body: JSON.stringify({ step }) }),
  report: (spot: string, image: string, media_type: string) =>
    call<{ report: DepthReport; status: Status }>("/reports", { method: "POST", body: JSON.stringify({ spot, image, media_type }) }),
};

/** Shrink a photo to at most 1280px on the long side and return base64 JPEG. */
export async function resizeImage(file: File, max = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}
