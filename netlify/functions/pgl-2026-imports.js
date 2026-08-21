const IMPORTS = {
  "pgl-abadia-2026-group-1": {
    demoUrl: "https://drive.google.com/file/d/1ijMqtTU2WuE7_hkCBy1SDbzInsDw0I82/view?usp=drivesdk",
    leetifyUrl: "https://leetify.com/app/match-details/feb1d954-0319-4c11-a24f-cfb2b2f96ba9/overview",
    demoInfo: {
      fileName: "Fase_de_grupos_BOCADEFUMO_vs_redpillados_INFERNO.dem",
      fileSize: 360315374,
      mapName: "de_inferno",
      rawFileStored: false,
      storedExternally: true,
      extractionStatus: "external"
    }
  },
  "pgl-abadia-2026-group-2": {
    demoUrl: "https://drive.google.com/file/d/14IO-Ggb6FS0-sS1TCYzorSPUHErPMQ6G/view?usp=drivesdk",
    leetifyUrl: "https://leetify.com/app/match-details/a797b738-b3e6-4144-8c80-33e9f43b699a/overview",
    score: "13 - 9",
    winner: "BOCA DE FUMO Gaming",
    statisticsStatus: "partial",
    evidenceNote: "Demo corrompida: o Leetify registrou 12–9. O placar final confirmado foi 13–9.",
    demoInfo: {
      fileName: "Fase_de_grupos_DEFTONES_vs_BOCADEFUMO_NUKE.dem",
      fileSize: 284983296,
      mapName: "de_nuke",
      rawFileStored: false,
      storedExternally: true,
      extractionStatus: "corrupted",
      warnings: ["Demo incompleta: estatísticas individuais devem ser tratadas como parciais."]
    }
  },
  "pgl-abadia-2026-group-3": {
    demoUrl: "https://drive.google.com/file/d/1l5x0rC0viq8jVQsE0bWxXCpivxU_fmrp/view?usp=drivesdk",
    leetifyUrl: "https://leetify.com/app/match-details/df22fea4-8adc-4fee-88ee-304f90dbdad6/details-clutches",
    score: "16 - 14",
    winner: "RED PILL Gaming",
    demoInfo: {
      fileName: "Fase_de_grupos_Deftones_vs_Redpill_cache.dem",
      fileSize: 436805773,
      mapName: "de_cache",
      rawFileStored: false,
      storedExternally: true,
      extractionStatus: "external"
    }
  },
  "pgl-abadia-2026-group-4": {
    demoUrl: "https://drive.google.com/file/d/1OROYDCKxLHJZw7ecKJR9fwz9Uhd5ajDx/view?usp=drivesdk",
    leetifyUrl: "https://leetify.com/public/match-details/730a33b3-4409-41b5-9863-131194d2a008/overview",
    score: "10 - 13",
    winner: "BOCA DE FUMO Gaming",
    demoInfo: {
      fileName: "Fase_de_grupos_redxboca_dust2.dem",
      fileSize: 321342579,
      mapName: "de_dust2",
      rawFileStored: false,
      storedExternally: true,
      extractionStatus: "external"
    }
  },
  "pgl-abadia-2026-group-5": {
    demoUrl: "https://drive.google.com/file/d/147MqCNgzIu1BXBsNxYelXovscLZmKoE9/view?usp=drivesdk",
    leetifyUrl: "https://leetify.com/app/match-details/98d9c7fa-9e61-4e05-bc6a-97e27a745745",
    score: "11 - 13",
    winner: "BOCA DE FUMO Gaming",
    demoInfo: {
      fileName: "Fase_de_grupos_BOCADEFUMO_vs_DEFTONES_INFERNO.dem",
      fileSize: 464727770,
      mapName: "de_inferno",
      rawFileStored: false,
      storedExternally: true,
      extractionStatus: "external"
    }
  }
};

function fillMissing(target, imported) {
  Object.entries(imported).forEach(([key, value]) => {
    if (key === "demoInfo") {
      target.demoInfo = { ...value, ...(target.demoInfo || {}) };
      return;
    }
    if (target[key] === undefined || target[key] === null || target[key] === "") target[key] = value;
  });
  target.updated = target.updated || "Fontes importadas automaticamente do Drive e Leetify";
  return target;
}

function applyPgl2026Imports(content) {
  if (!content || !Array.isArray(content.matches)) return content || {};
  content.matches = content.matches.map((match) => {
    if (!IMPORTS[match.id]) return match;
    const merged = fillMissing({ ...match }, IMPORTS[match.id]);
    if (match.id === "pgl-abadia-2026-group-2" && match.resultSource !== "manual" && match.scoreSource !== "manual") {
      merged.score = "13 - 9";
      merged.winner = "BOCA DE FUMO Gaming";
      merged.statisticsStatus = "partial";
    }
    return merged;
  });
  return content;
}

module.exports = { applyPgl2026Imports };
