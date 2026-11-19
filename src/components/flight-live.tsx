"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Radio, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui";
import { LIVE_PHASE, type FlightLive, type FlightLiveSide } from "@/lib/flight-live-types";

/** Hora no relógio do aeroporto (o fuso vem da própria fonte). */
function localTime(iso: string | null, tz: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz ?? undefined,
  });
}

function ago(iso: string | null) {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.round(min / 60)} h`;
}

function Side({ label, s }: { label: string; s: FlightLiveSide }) {
  const sched = localTime(s.scheduled, s.timeZone);
  const best = s.actual ?? s.estimated;
  const bestTxt = localTime(best, s.timeZone);
  const changed = bestTxt && bestTxt !== sched;
  const late = (s.delayMinutes ?? 0) >= 15;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
        {label} · {s.iata}
      </p>
      <p className="text-sm font-bold text-slate-900">
        {changed ? (
          <>
            <span className={late ? "text-amber-700" : "text-emerald-700"}>{bestTxt}</span>{" "}
            <span className="text-[11px] font-normal text-slate-400 line-through">{sched}</span>
          </>
        ) : (
          sched ?? "—"
        )}
      </p>
      <p className="text-[11px] text-slate-500">
        {s.actual ? "Real" : s.estimated ? "Estimado" : "Previsto"}
        {s.delayMinutes ? ` · ${s.delayMinutes > 0 ? "+" : ""}${s.delayMinutes} min` : ""}
      </p>
      {(s.terminal || s.gate) && (
        <p className="text-[11px] font-semibold text-slate-600">
          {s.terminal && `Terminal ${s.terminal}`}
          {s.terminal && s.gate && " · "}
          {s.gate && `Portão ${s.gate}`}
        </p>
      )}
    </div>
  );
}

/** Painel de status ao vivo de um voo. Sem dados ainda → linha discreta. */
export function FlightLivePanel({
  live,
  checkedAt,
  expectedRoute,
}: {
  live: FlightLive | null;
  checkedAt: string | null;
  /** "GRU-MAD" do cadastro, para avisar se a fonte devolveu outra rota. */
  expectedRoute?: string;
}) {
  if (!live) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
        <Radio className="h-3 w-3" /> Status ao vivo ainda não consultado.
      </p>
    );
  }
  const phase = LIVE_PHASE[live.phase] ?? LIVE_PHASE.SEM_DADOS;
  const route = `${live.origin.iata}-${live.destination.iata}`;
  const routeMismatch =
    live.phase !== "SEM_DADOS" && expectedRoute && live.origin.iata && route !== expectedRoute;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={phase.tone}>
          <span className="relative flex h-1.5 w-1.5">
            {(live.phase === "EM_VOO" || live.phase === "PROGRAMADO" || live.phase === "ATRASADO") && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
          </span>
          {phase.label}
        </Badge>
        <span className="text-[11px] text-slate-500">
          Ao vivo · atualizado {ago(checkedAt ?? live.collectedAt)}
        </span>
        {live.aircraft && (
          <span className="ml-auto text-[11px] text-slate-500">
            {live.aircraft}
            {live.registration ? ` · ${live.registration}` : ""}
          </span>
        )}
      </div>

      {live.phase !== "SEM_DADOS" ? (
        <div className="grid grid-cols-2 gap-3">
          <Side label="Partida" s={live.origin} />
          <Side label="Chegada" s={live.destination} />
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          A fonte não publicou dados para este número de voo nesta data.
        </p>
      )}

      {live.phase === "EM_VOO" && (live.altitudeFeet || live.distanceRemainingKm) && (
        <p className="mt-2 text-[11px] text-slate-600">
          {live.altitudeFeet ? `${live.altitudeFeet.toLocaleString("pt-BR")} pés` : ""}
          {live.groundspeedKmh ? ` · ${Math.round(live.groundspeedKmh)} km/h` : ""}
          {live.distanceRemainingKm
            ? ` · faltam ${Math.round(live.distanceRemainingKm).toLocaleString("pt-BR")} km`
            : ""}
        </p>
      )}

      {live.notes.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-800">{live.notes.join(" · ")}</p>
      )}

      {routeMismatch && (
        <p className="mt-2 text-[11px] font-semibold text-amber-800">
          Atenção: a fonte informa a rota {live.origin.iata} → {live.destination.iata} para
          este número de voo, diferente do cadastro.
        </p>
      )}
    </div>
  );
}

/**
 * Dispara a atualização no servidor ao abrir a página e a cada `intervalMs`.
 * O servidor só consulta a Apify quando o cache venceu, então é barato.
 */
export function LiveStatusRefresher({
  action,
  intervalMs = 120_000,
  showButton = true,
}: {
  action: (force: boolean) => Promise<unknown>;
  intervalMs?: number;
  showButton?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);

  const run = (force: boolean) =>
    start(async () => {
      try {
        await action(force);
        setError(false);
      } catch {
        setError(true);
      }
    });

  useEffect(() => {
    run(false);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") run(false);
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  if (!showButton) return null;
  return (
    <button
      type="button"
      onClick={() => run(true)}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      {pending ? "Consultando…" : error ? "Falhou — tentar de novo" : "Atualizar status"}
    </button>
  );
}
