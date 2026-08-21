const IMPORT_DATA = require("./statistics-imports-data.json");

function applyStatisticsImports(content) {
  if (!content || !Array.isArray(content.matches)) return content || {};
  content.matches = content.matches.map((match) => {
    const imported = IMPORT_DATA.matches?.[match.id];
    const version = Number(imported?.version || IMPORT_DATA.version || 1);
    if (!imported || Number(match.statisticsImportVersion || 0) >= version) return match;
    const { version: _, ...importedFields } = imported;
    return {
      ...match,
      ...importedFields,
      maps: Array.isArray(importedFields.maps) ? importedFields.maps : match.maps,
      statisticsImportVersion: version
    };
  });
  return content;
}

module.exports = { applyStatisticsImports };
