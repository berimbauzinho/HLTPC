import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import authUtils from "./auth-utils.js";
import demoProcessor from "./demo-processor.js";
import { getContent, saveContent } from "./content-store-v2.mjs";

const { configuration, readSession } = authUtils;
const { processDemoPath } = demoProcessor;

function authorized(request) {
  const config = configuration();
  const session = config && readSession(request.headers.get("cookie") || "", config.secret);
  return session && !session.mustChangePassword ? session : null;
}

function driveFileId(value) {
  const raw = String(value || "");
  return raw.match(/\/file\/d\/([^/?#]+)/)?.[1] || raw.match(/[?&]id=([^&#]+)/)?.[1] || "";
}

function downloadUrl(value) {
  const url = new URL(String(value || ""));
  if (!/(^|\.)google\.com$/i.test(url.hostname) && !/(^|\.)googleusercontent\.com$/i.test(url.hostname)) {
    throw new Error("O processamento no servidor aceita somente links de demo do Google Drive.");
  }
  const id = driveFileId(url.href);
  if (!id) throw new Error("Não foi possível identificar o arquivo nesse link do Google Drive.");
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

async function saveMatchUpdate(matchId, updater) {
  const latest = await getContent();
  const match = (latest.matches || []).find((item) => item.id === matchId);
  if (!match) throw new Error("Partida não encontrada durante a atualização.");
  updater(match, latest);
  return saveContent(latest, { expectedRevision: latest._revision });
}

export default async (request) => {
  if (!authorized(request) || request.method !== "POST") return new Response(null, { status: 403 });

  let directory = "";
  let matchId = "";
  let mapIndex = null;
  let startedAt = "";
  try {
    ({ matchId, mapIndex } = await request.json());
    mapIndex = Number.isInteger(mapIndex) && mapIndex >= 0 ? mapIndex : null;
    const initial = await getContent();
    const initialMatch = (initial.matches || []).find((item) => item.id === matchId);
    if (!initialMatch) throw new Error("Partida não encontrada.");
    const initialTarget = mapIndex === null ? initialMatch : initialMatch.maps?.[mapIndex];
    if (!initialTarget) throw new Error("Mapa não encontrado nesta série.");
    if (!initialTarget.demoUrl) throw new Error("Informe o link da demo no Google Drive antes de processar no servidor.");

    startedAt = new Date().toISOString();
    await saveMatchUpdate(matchId, (match) => {
      const target = mapIndex === null ? match : match.maps?.[mapIndex];
      if (!target) throw new Error("Mapa não encontrado durante a atualização.");
      target.demoProcessing = { status: "processing", startedAt, error: "" };
    });

    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hltpc-demo-"));
    const demoPath = path.join(directory, "match.dem");
    const response = await fetch(downloadUrl(initialTarget.demoUrl), { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`O Google Drive respondeu HTTP ${response.status}. Confirme que o link está compartilhado para leitura.`);
    }

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 700 * 1024 * 1024) throw new Error("A demo ultrapassa o limite de 700 MB do processador.");
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(demoPath));
    const fileSize = (await fs.promises.stat(demoPath)).size;
    if (fileSize > 700 * 1024 * 1024) throw new Error("A demo ultrapassa o limite de 700 MB do processador.");
    if (fileSize < 1024 * 1024) throw new Error("O Drive não devolveu uma demo válida; confirme o compartilhamento como ‘qualquer pessoa com o link’.");

    const handle = await fs.promises.open(demoPath, "r");
    const signature = Buffer.alloc(8);
    await handle.read(signature, 0, 8, 0);
    await handle.close();
    if (!signature.toString("utf8").startsWith("PBDEMS2")) throw new Error("O link do Drive devolveu uma página ou um arquivo que não é uma demo CS2.");

    const expectedSize = Number(initialTarget.demoInfo?.fileSize || 0);
    if (expectedSize && fileSize + 1024 * 1024 < expectedSize) {
      throw new Error(`O download ficou incompleto (${Math.round(fileSize / 1048576)} de ${Math.round(expectedSize / 1048576)} MB). Tente reprocessar a demo.`);
    }

    const latest = await getContent();
    const latestMatch = (latest.matches || []).find((item) => item.id === matchId);
    if (!latestMatch) throw new Error("Partida não encontrada após o download.");
    const latestTarget = mapIndex === null ? latestMatch : latestMatch.maps?.[mapIndex];
    if (!latestTarget) throw new Error("Mapa não encontrado após o download.");
    const fileName = latestTarget.demoInfo?.fileName || `demo-${latestMatch.id}${mapIndex === null ? "" : `-map-${mapIndex + 1}`}.dem`;
    const processed = processDemoPath(demoPath, latestMatch, latest, { fileName, fileSize });
    const manualResult = mapIndex === null && (latestMatch.manualResult === true || ["manual", "manual-maps"].includes(latestMatch.resultSource));
    if (manualResult) {
      delete processed.score;
      delete processed.winner;
      delete processed.winnerId;
      delete processed.resultSource;
      delete processed.status;
      processed.evidenceNote = latestMatch.evidenceNote;
    }

    await saveMatchUpdate(matchId, (match) => {
      const target = mapIndex === null ? match : match.maps?.[mapIndex];
      if (!target) throw new Error("Mapa não encontrado ao concluir o processamento.");
      if (mapIndex !== null) {
        const manualMap = target.resultSource === "manual" || target.scoreSource === "manual";
        const { score, winner, winnerId, resultSource, status, evidenceNote, ...mapStats } = processed;
        Object.assign(target, mapStats, {
          name: processed.demoInfo?.mapName || target.name,
          demoProcessing: { status: "complete", startedAt, processedAt: new Date().toISOString(), error: "" },
          updated: "Demo do mapa processada no servidor HLTPC · fonte principal"
        });
        if (!manualMap) Object.assign(target, { score, winner, winnerId, resultSource, status, evidenceNote, scoreSource: "demo" });
        match.updated = `Demo do mapa ${mapIndex + 1} processada no servidor HLTPC`;
        return;
      }
      Object.assign(match, processed, {
        demoProcessing: {
          status: "complete",
          startedAt,
          processedAt: new Date().toISOString(),
          error: ""
        },
        updated: "Demo processada no servidor HLTPC · fonte principal"
      });
    });
    return new Response(null, { status: 200 });
  } catch (reason) {
    console.error("HLTPC demo processing v2 error", reason);
    if (matchId) {
      await saveMatchUpdate(matchId, (match) => {
        const target = mapIndex === null ? match : match.maps?.[mapIndex];
        if (!target) return;
        target.demoProcessing = {
          status: "error",
          startedAt: startedAt || target.demoProcessing?.startedAt || new Date().toISOString(),
          failedAt: new Date().toISOString(),
          error: String(reason?.message || "Não foi possível processar a demo.").slice(0, 300)
        };
        match.updated = mapIndex === null ? "Falha ao processar demo no servidor" : `Falha ao processar a demo do mapa ${mapIndex + 1}`;
      }).catch((storageError) => console.error("HLTPC demo error persistence", storageError));
    }
    return new Response(null, { status: 500 });
  } finally {
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
};
