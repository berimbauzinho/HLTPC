const IMPORT_DATA = require("./statistics-imports-data.json");

function applyStatisticsImports(content) {
  if (!content || !Array.isArray(content.matches)) return content || {};
  const version = Number(IMPORT_DATA.version || 1);
  content.matches = content.matches.map((match) => {
    const imported = IMPORT_DATA.matches?.[match.id];
    if (!imported || Number(match.statisticsImportVersion || 0) >= version) return match;
    return {
      ...match,
      ...imported,
      maps: Array.isArray(imported.maps) ? imported.maps : match.maps,
      statisticsImportVersion: version
    };
  });
  return content;
}

module.exports = { applyStatisticsImports };
