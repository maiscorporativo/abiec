// Status de voo em tempo real via Apify (actor apt_marble/flight-status-tracker).
// Só roda no servidor: usa APIFY_TOKEN e grava o resultado no próprio Flight
// (liveStatus / liveData / liveCheckedAt), que funciona como cache.

import type { Flight } from "@prisma/client";
import { db } from "./db";
import type { FlightLive, LivePhase } from "./flight-live-types";

const ACTOR = "apt_marble~flight-status-tracker";
const RUN_TIMEOUT_S = 90;

export function liveStatusEnabled() {
  return !!process.env.APIFY_TOKEN;
}

/** Campos crus que usamos da linha devolvida pelo actor. */
type ApifyRow = Record<string, unknown> & { requestedFlight?: string };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);

function phaseOf(r: ApifyRow): LivePhase {
  if (r.resultUnknown || r.recordType === "none") return "SEM_DADOS";
  if (r.isCancelled) return "CANCELADO";
  if (r.isDiverted) return "DESVIADO";
  if (r.hasLanded || r.actualArrival || r.actualLanding) return "POUSOU";
  if (r.isAirborne || r.actualTakeoff) return "EM_VOO";
  if (r.actualDeparture) return "EMBARQUE_ENCERRADO";
  if ((num(r.departureDelayMinutes) ?? 0) >= 15) return "ATRASADO";
  return "PROGRAMADO";
}

function normalize(r: ApifyRow): FlightLive {
  return {
    phase: phaseOf(r),
    sourceStatus: str(r.flightStatus),
    flightName: str(r.flightName),
    operatingFlight: str(r.flightIdentifier),
    origin: {
      iata: str(r.originIata),
      airport: str(r.originAirport),
      city: str(r.originCity),
      terminal: str(r.originTerminal),
      gate: str(r.originGate),
      timeZone: str(r.originTimeZone),
      scheduled: str(r.scheduledDeparture),
      estimated: str(r.estimatedDeparture),
      actual: str(r.actualDeparture),
      delayMinutes: num(r.departureDelayMinutes),
    },
    destination: {
      iata: str(r.destinationIata),
      airport: str(r.destinationAirport),
      city: str(r.destinationCity),
      terminal: str(r.destinationTerminal),
      gate: str(r.destinationGate),
      timeZone: str(r.destinationTimeZone),
      scheduled: str(r.scheduledArrival),
      estimated: str(r.estimatedArrival),
      actual: str(r.actualArrival),
      delayMinutes: num(r.arrivalDelayMinutes),
    },
    aircraft: str(r.aircraftTypeName) ?? str(r.aircraftType),
    registration: str(r.registration),
    altitudeFeet: num(r.altitudeFeet),
    groundspeedKmh: num(r.groundspeedKmh),
    distanceRemainingKm: num(r.distanceRemainingKm),
    distanceTotalKm: num(r.distanceTotalKm),
    notes: [
      ...((r.originDelayNotes as string[] | undefined) ?? []),
      ...((r.destinationDelayNotes as string[] | undefined) ?? []),
    ].filter((n) => typeof n === "string" && n),
    collectedAt: str(r.collectedAt) ?? new Date().toISOString(),
  };
}

/**
 * Data da operação a pedir. As datas do cadastro são "horário local gravado
 * como UTC" (ver parseDateTimeInput), então a data UTC é a data local de
 * partida. A fonte só publica ~10 dias para trás e ~2 para frente; fora disso
 * pedimos a operação atual/próxima daquele número de voo.
 */
function operationDate(f: Pick<Flight, "depDateTime">): string {
  if (!f.depDateTime) return "";
  const diffDays = (f.depDateTime.getTime() - Date.now()) / 86_400_000;
  if (diffDays < -9 || diffDays > 2) return "";
  return f.depDateTime.toISOString().slice(0, 10);
}

/** Tempo de cache conforme a fase: perto da partida ou em voo, atualiza mais. */
function ttlMs(f: Flight): number {
  const live = parseLive(f.liveData);
  if (!live) return 0;
  if (live.phase === "POUSOU" || live.phase === "CANCELADO") return 60 * 60_000;
  if (live.phase === "EM_VOO" || live.phase === "EMBARQUE_ENCERRADO") return 3 * 60_000;
  const dep = live.origin.estimated ?? live.origin.scheduled;
  if (dep && Math.abs(new Date(dep).getTime() - Date.now()) < 4 * 3_600_000) {
    return 3 * 60_000;
  }
  return 20 * 60_000;
}

export function parseLive(raw: string | null | undefined): FlightLive | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FlightLive;
  } catch {
    return null;
  }
}

async function runActor(flightNumbers: string[], date: string): Promise<ApifyRow[]> {
  const input: Record<string, unknown> = {
    flights: flightNumbers,
    includeHistory: false,
    market: "BR",
  };
  if (date) input.date = date;
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_S}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.APIFY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout((RUN_TIMEOUT_S + 15) * 1000),
    }
  );
  if (!res.ok) {
    throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as ApifyRow[];
}

// Evita duas consultas simultâneas do mesmo voo (várias abas, vários passageiros).
const inFlight = new Map<string, Promise<void>>();

/**
 * Atualiza o status ao vivo dos voos cujo cache venceu (ou todos, com force).
 * Agrupa por data de operação para fazer uma única chamada à Apify por grupo.
 */
export async function refreshLiveStatus(flights: Flight[], opts: { force?: boolean } = {}) {
  if (!liveStatusEnabled()) return { updated: 0, skipped: flights.length };

  const now = Date.now();
  const stale = flights.filter(
    (f) =>
      f.flightNumber &&
      (!f.liveCheckedAt ||
        // "forçar" ainda respeita 60 s, para cliques repetidos não gastarem créditos
        now - f.liveCheckedAt.getTime() > (opts.force ? 60_000 : ttlMs(f)))
  );

  const groups = new Map<string, Flight[]>();
  for (const f of stale) {
    const key = operationDate(f);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  let updated = 0;
  await Promise.all(
    [...groups].map(([date, group]) => {
      const key = `${date}|${group.map((f) => f.id).sort().join(",")}`;
      const pending = inFlight.get(key);
      if (pending) return pending;

      const job = (async () => {
        const numbers = [...new Set(group.map((f) => f.flightNumber.replace(/\s+/g, "")))];
        const rows = await runActor(numbers, date);
        const byNumber = new Map<string, ApifyRow>();
        for (const r of rows) {
          const k = String(r.requestedFlight ?? "").replace(/\s+/g, "").toUpperCase();
          if (k && !byNumber.has(k)) byNumber.set(k, r);
        }
        for (const f of group) {
          const row = byNumber.get(f.flightNumber.replace(/\s+/g, "").toUpperCase());
          const live: FlightLive = row
            ? normalize(row)
            : { ...emptyLive(), collectedAt: new Date().toISOString() };
          await db.flight.update({
            where: { id: f.id },
            data: {
              liveStatus: live.phase,
              liveData: JSON.stringify(live),
              liveCheckedAt: new Date(),
            },
          });
          updated++;
        }
      })()
        .catch((err) => console.error("[flight-status]", err))
        .finally(() => inFlight.delete(key));

      inFlight.set(key, job);
      return job;
    })
  );

  return { updated, skipped: flights.length - stale.length };
}

function emptyLive(): FlightLive {
  const side = {
    iata: null, airport: null, city: null, terminal: null, gate: null,
    timeZone: null, scheduled: null, estimated: null, actual: null, delayMinutes: null,
  };
  return {
    phase: "SEM_DADOS", sourceStatus: null, flightName: null, operatingFlight: null,
    origin: side, destination: { ...side }, aircraft: null, registration: null,
    altitudeFeet: null, groundspeedKmh: null, distanceRemainingKm: null,
    distanceTotalKm: null, notes: [], collectedAt: "",
  };
}
