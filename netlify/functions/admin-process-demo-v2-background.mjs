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

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const scoreParts = (value) => {
  const parts = String(value || "").match(/\d+/g)?.map(Number) || [];
  return parts.length >= 2 ? parts.slice(0, 2) : [];
};

function consolidateSeries(match) {
  const maps = (match.maps || []).filter((map) => Array.isArray(map.statistics) && map.statistics.length);
  if (!maps.length) return;
  const players = new Map();
  let totalRounds = 0;
  maps.forEach((map) => {
    const scores = scoreParts(map.score);
    const rounds = number(map.rounds || map.demoInfo?.rounds) || (scores.length ? scores[0] + scores[1] : 0);
    totalRounds += rounds;
    map.statistics.forEach((player) => {
      const key = `${player.steamid || player.steam64Id || player.name}::${player.team || ""}`;
      if (!players.has(key)) players.set(key, { ...player, kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, shots: 0, hits: 0, headHits: 0, utilityDamage: 0, openingKills: 0, openingDeaths: 0, multiKill2: 0, multiKill3: 0, multiKill4: 0, multiKill5: 0, kastWeight: 0, ratingWeight: 0, rounds: 0 });
      const row = players.get(key);
      ["kills", "deaths", "assists", "headshots", "damage", "shots", "hits", "headHits", "utilityDamage", "openingKills", "openingDeaths", "multiKill2", "multiKill3", "multiKill4", "multiKill5"].forEach((field) => { row[field] += number(player[field]); });
      row.rounds += rounds;
      row.kastWeight += number(player.kast) * rounds;
      row.ratingWeight += number(player.rating) * rounds;
    });
  });
  match.statistics = [...players.values()].map((player) => ({
    ...player,
    adr: player.rounds ? Number((player.damage / player.rounds).toFixed(1)) : 0,
    kd: player.deaths ? Number((player.kills / player.deaths).toFixed(2)) : player.kills,
    kast: player.rounds ? Number((player.kastWeight / player.rounds).toFixed(1)) : 0,
    rating: player.rounds ? Number((player.ratingWeight / player.rounds).toFixed(2)) : 0,
    hsPercent: player.kills ? Number((player.headshots * 100 / player.kills).toFixed(1)) : 0,
    accuracy: player.shots ? Number((player.hits * 100 / player.shots).toFixed(1)) : 0,
    headAccuracy: player.hits ? Number((player.headHits * 100 / player.hits).toFixed(1)) : 0
  })).sort((a, b) => b.rating - a.rating || b.kills - a.kills);
  match.statisticsSource = "demo";
  match.statisticsSecondarySource = "";
  match.demoInfo = { ...(match.demoInfo || {}), rounds: totalRounds, mapCount: maps.length, extractionStatus: "complete", rawFileStored: false };

  const scores = (match.maps || []).map((map) => scoreParts(map.score)).filter((score) => score.length);
  const winsNeeded = Math.ceil(number(match.bestOf || match.maps?.length) / 2);
  let winsA = 0; let winsB = 0;
  scores.forEach(([a, b]) => { if (a > b) winsA += 1; else if (b > a) winsB += 1; });
  if (Math.max(winsA, winsB) >= winsNeeded) {
    match.score = `${winsA} - ${winsB}`;
    match.winner = winsA > winsB ? match.teamA : match.teamB;
    match.winnerId = winsA > winsB ? match.teamAId || "" : match.teamBId || "";
    if (!match.manualResult) match.resultSource = "demo-maps";
    match.status = "finished";
    match.evidenceNote = match.manualResult ? match.evidenceNote : `Resultado e estatísticas consolidados de ${maps.length} demos da série.`;
  }
}

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
        consolidateSeries(match);
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
