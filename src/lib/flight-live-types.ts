// Tipos do status ao vivo — sem dependências de servidor, usáveis no cliente.

export type LivePhase =
  | "PROGRAMADO"
  | "ATRASADO"
  | "EMBARQUE_ENCERRADO"
  | "EM_VOO"
  | "POUSOU"
  | "CANCELADO"
  | "DESVIADO"
  | "SEM_DADOS";

export type FlightLiveSide = {
  iata: string | null;
  airport: string | null;
  city: string | null;
  terminal: string | null;
  gate: string | null;
  timeZone: string | null;
  /** ISO em UTC */
  scheduled: string | null;
  estimated: string | null;
  actual: string | null;
  delayMinutes: number | null;
};

export type FlightLive = {
  phase: LivePhase;
  sourceStatus: string | null;
  flightName: string | null;
  operatingFlight: string | null;
  origin: FlightLiveSide;
  destination: FlightLiveSide;
  aircraft: string | null;
  registration: string | null;
  altitudeFeet: number | null;
  groundspeedKmh: number | null;
  distanceRemainingKm: number | null;
  distanceTotalKm: number | null;
  notes: string[];
  collectedAt: string;
};

export const LIVE_PHASE: Record<LivePhase, { label: string; tone: string }> = {
  PROGRAMADO: { label: "No horário", tone: "green" },
  ATRASADO: { label: "Atrasado", tone: "amber" },
  EMBARQUE_ENCERRADO: { label: "Saiu do portão", tone: "blue" },
  EM_VOO: { label: "Em voo", tone: "blue" },
  POUSOU: { label: "Pousou", tone: "teal" },
  CANCELADO: { label: "Cancelado", tone: "rose" },
  DESVIADO: { label: "Desviado", tone: "rose" },
  SEM_DADOS: { label: "Sem dados ao vivo", tone: "slate" },
};
