"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { requirePassenger } from "@/lib/auth";
import { refreshLiveStatus } from "@/lib/flight-status";

/** Atualiza o status ao vivo dos voos do passageiro logado (respeitando o cache). */
export async function refreshMyFlightsLive(force: boolean) {
  const session = await requirePassenger();
  const flights = await db.flight.findMany({
    where: { passengers: { some: { passengerId: session.passengerId } } },
  });
  const result = await refreshLiveStatus(flights, { force });
  if (result.updated > 0) refresh();
  return result;
}
