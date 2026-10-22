const fs = require("fs");
const vm = require("vm");

const gamePath = process.argv[2] || "18-0_CFL_Perfect_Season_complete (12).html";
const canonicalPath = process.argv[3] || "cfl-all-player-season-stats.json";
const outputPath = process.argv[4] || "cfl-game-data.json";

const html = fs.readFileSync(gamePath, "utf8");
const canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf8"));

function declarationValue(name) {
  const start = html.search(new RegExp(`const ${name}\\s*=\\s*`));
  if (start < 0) throw new Error(`Missing ${name} declaration`);
  const open = html.indexOf("[", start);
  let depth = 0;
  let quote = null;
  for (let i = open; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote && html[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) return vm.runInNewContext(html.slice(open, i + 1));
    }
  }
  throw new Error(`Unterminated ${name} declaration`);
}

const aliases = new Map([
  ["Hamilton Tigers", "Hamilton Tiger-Cats"],
  ["Montreal Hornets", "Montreal Alouettes"],
  ["Edmonton Eskimos", "Edmonton Eskimos"],
  ["Baltimore Colts", "Baltimore CFL Colts"],
]);
const positions = new Set(["QB", "RB", "WR", "OL", "DL", "LB", "DB", "K"]);
const badPlayers = new Set(["Bud Grant|1940s|Winnipeg Blue Bombers", "Kenny Ploen|1940s|Winnipeg Blue Bombers"]);
const careerStats = new Map((canonical.careerPlayerStats || []).map((p) => [p.name, p]));
const canonicalNames = new Set(careerStats.keys());
const eraFor = (year) => `${Math.floor(Number(year) / 10) * 10}s`;
const normalizeTeam = (team) => {
  let value = String(team || "").replace(/^\d{4}\s+/, "").replace(/\s+football$/, "").trim();
  return aliases.get(value) || value;
};
const normalizePosition = (pos) => {
  const value = String(pos || "").toUpperCase().replace(/[^A-Z/-]/g, "");
  const tokens = value.split(/[/-]/).filter(Boolean);
  const tokenPosition = (token) => {
    if (["QB"].includes(token)) return "QB";
    if (["RB", "HB", "FB", "TB", "FW"].includes(token)) return "RB";
    if (["WR", "E", "SB", "TE", "FL"].includes(token)) return "WR";
    if (["C", "G", "T", "OT", "OG", "OL", "GT", "CT", "ROG", "LOG", "LOT", "ROT", "LS", "LONG"].includes(token)) return "OL";
    if (["DT", "DE", "DL", "D", "DH", "NT"].includes(token)) return "DL";
    if (["LB", "MLB", "WLB", "SLB", "OLB"].includes(token)) return "LB";
    if (["DB", "CB", "S", "DH"].includes(token)) return "DB";
    if (["K", "P"].includes(token)) return "K";
    return null;
  };
  const tokenMatch = tokens.map(tokenPosition).find(Boolean);
  if (tokenMatch) return tokenMatch;
  if (value.includes("QUARTER")) return "QB";
  if (value.includes("RUNNING") || value === "HB" || value === "FB" || value === "TB") return "RB";
  if (value.includes("RECEIV") || value === "E") return "WR";
  if (value.includes("GUARD") || value.includes("TACKLE") || ["C", "G", "T", "OT", "OG", "OL", "G/T", "C/G"].includes(value)) return "OL";
  if (value.includes("DEFENSIVE") || ["DT", "DE", "DL", "D", "DH"].includes(value)) return "DL";
  if (value.includes("LINEBACK") || ["LB", "MLB", "WLB", "C/LB", "G/LB"].includes(value)) return "LB";
  if (value.includes("BACK") || ["DB", "CB", "S", "D"].includes(value)) return "DB";
  if (value.includes("KICK") || ["K", "P", "P/K", "HB/K", "T/K"].includes(value)) return "K";
  return positions.has(value) ? value : null;
};
const inferPosition = (player) => {
  const categories = Object.keys(player?.categories || {});
  if (categories.includes("Passing")) return { position: "QB", evidence: ["Passing"] };
  if (categories.includes("Kicking") || categories.includes("Punting")) {
    return {
      position: "K",
      evidence: categories.filter((category) => ["Kicking", "Punting"].includes(category)),
    };
  }
  if (categories.includes("Sacks")) return { position: "DL", evidence: ["Sacks"] };
  if (categories.includes("Rushing")) return { position: "RB", evidence: ["Rushing"] };
  if (categories.includes("Receiving") || categories.includes("Kick Returns") || categories.includes("Punt Returns")) {
    return {
      position: "WR",
      evidence: categories.filter((category) => ["Receiving", "Kick Returns", "Punt Returns"].includes(category)),
    };
  }
  if (categories.includes("Interceptions") || categories.includes("Defense and Fumbles")) {
    return {
      position: "DB",
      evidence: categories.filter((category) => ["Interceptions", "Defense and Fumbles"].includes(category)),
    };
  }
  return null;
};

const curated = declarationValue("PLAYERS");
const additions = declarationValue("X").map(([name, pos, ovr, team]) => ({
  name, pos, ovr, era: "1950s", teams: [team],
}));
const careerAppearances = new Map((canonical.careerPlayerStats || []).map((p) => [
  p.name,
  Object.values(p.categories || {}).reduce((sum, category) => sum + Number(category.appearances || 0), 0),
]));
const rosterRows = (canonical.rosterPlayers || []).flatMap((page) => (page.players || []).map((row) => ({
  page,
  row,
})));
const isDateValue = (value) => /^\w+ \d{1,2}, \d{4}$/.test(String(value || "").trim());
const quarantinedRows = [];
let inferredPositionRows = 0;
const rosterRecords = rosterRows.flatMap(({ page, row }) => {
  // Some early roster tables shifted the birth-date column into position.
  // Recover only when the same player has career statistics that identify a
  // useful game position; otherwise retain the row in the quarantine report.
  const corrupted = isDateValue(row.position);
  const inferred = corrupted ? inferPosition(careerStats.get(row.name)) : null;
  if (corrupted && !inferred) {
    quarantinedRows.push({
      season: page.season,
      team: page.team,
      name: row.name,
      birthDate: String(row.position).trim(),
    });
    return [];
  }
  if (inferred) inferredPositionRows += 1;
  return [{
    name: row.name,
    pos: inferred ? inferred.position : normalizePosition(row.position),
    ovr: 72 + Math.min(16, careerAppearances.get(row.name) || 0),
    era: eraFor(page.season),
    teams: [normalizeTeam(page.team)],
    positionSource: inferred ? "inferred-from-statistics" : "roster",
    positionEvidence: inferred?.evidence,
  }];
});
const malformedPositionRows = rosterRows.filter(({ row }) => isDateValue(row.position)).length;
const unrecognizedPositionRows = rosterRows.filter(({ row }) => !isDateValue(row.position) && !normalizePosition(row.position)).length;
const jerseyFormats = {
  numeric: rosterRows.filter(({ row }) => /^\d{1,2}$/.test(String(row.jersey || "").trim())).length,
  multiple: rosterRows.filter(({ row }) => /^\d{1,2}(\/\d{1,2})+$/.test(String(row.jersey || "").trim())).length,
  name: rosterRows.filter(({ row }) => String(row.jersey || "").trim() === String(row.name || "").trim() && String(row.name || "").trim() !== "").length,
  empty: rosterRows.filter(({ row }) => String(row.jersey || "").trim() === "").length,
};
const records = [...rosterRecords, ...curated, ...additions].flatMap((p) => {
  const era = String(p.era);
  const teams = (p.teams || []).map(normalizeTeam);
  const pos = normalizePosition(p.pos);
  if (!p.name || !pos || !teams.length || !/^\d{4}s$/.test(era)) return [];
  return teams.map((team) => ({
    name: String(p.name).trim(),
    pos,
    ovr: Math.max(58, Math.min(99, Math.round(Number(p.ovr) || 72))),
    era,
    teams: [team],
    canonicalMatch: canonicalNames.has(p.name),
    positionSource: p.positionSource || "curated",
    positionEvidence: p.positionEvidence,
  }));
});

const unique = new Map();
for (const p of records) {
  const key = `${p.name}|${p.pos}|${p.era}|${p.teams[0]}`;
  if (badPlayers.has(`${p.name}|${p.era}|${p.teams[0]}`)) continue;
  const old = unique.get(key);
  if (!old || p.ovr > old.ovr) unique.set(key, p);
}

const players = [...unique.values()].map((p, i) => ({ id: 1000000 + i, ...p }));
const pairs = [...new Map(players.flatMap((p) => p.teams.map((team) => [
  `${team}|${p.era}`, { team, era: p.era },
])).map(([key, value]) => [key, value])).values()]
  .filter((pair) => {
    const counts = Object.fromEntries([...positions].map((pos) => [pos, 0]));
    players.filter((p) => p.era === pair.era && p.teams.includes(pair.team))
      .forEach((p) => { counts[p.pos] += 1; });
    return ["QB", "RB", "WR", "OL", "DL", "LB", "DB", "K"].every((pos) => counts[pos] >= (pos === "WR" || pos === "OL" || pos === "DL" || pos === "DB" ? 2 : 1));
  });

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "cfl-all-player-season-stats.json plus curated game ratings",
  players,
  playablePairs: pairs,
  coverageRequirements: { QB: 1, RB: 1, WR: 2, OL: 2, DL: 2, LB: 1, DB: 2, K: 1 },
  validation: {
    sourceTeamSeasonRecords: canonical.team_season_records?.length || 0,
    sourceRosterPages: canonical.rosterPlayers?.length || 0,
    canonicalNameMatches: players.filter((p) => p.canonicalMatch).length,
    deduplicatedPlayers: players.length,
    excludedPairsForCoverage: [...new Set(players.flatMap((p) => p.teams.map((team) => `${team}|${p.era}`)))].length - pairs.length,
    malformedRosterRows: malformedPositionRows,
    inferredPositionRows,
    quarantinedRosterRows: quarantinedRows.length,
    unrecognizedPositionRows,
    excludedDatePositionRows: malformedPositionRows,
    jerseyFormats,
    quarantinedRows,
    knownHistoricalCorrections: [
      "Removed Bud Grant from Winnipeg Blue Bombers 1940s",
      "Removed Kenny Ploen from Winnipeg Blue Bombers 1940s",
      "Mapped Hamilton Tigers to Hamilton Tiger-Cats",
      "Mapped Montreal Hornets to Montreal Alouettes",
    ],
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`);
console.log(JSON.stringify(result.validation));
