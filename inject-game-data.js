// Usage: node inject-game-data.js [index.html] [cfl-game-data.json]
// Makes cfl-game-data.json the single source of truth: rewrites the
// `const PLAYERS = [...]` line inside index.html from the JSON players.
const fs = require("fs");
const htmlPath = process.argv[2] || "index.html";
const jsonPath = process.argv[3] || "cfl-game-data.json";
const lines = fs.readFileSync(htmlPath, "utf8").split("\n");
const i = lines.findIndex((l) => l.startsWith("const PLAYERS = "));
if (i < 0) throw new Error("const PLAYERS line not found");
const players = JSON.parse(fs.readFileSync(jsonPath, "utf8")).players;
lines[i] = "const PLAYERS = " + JSON.stringify(players) + ";";
fs.writeFileSync(htmlPath, lines.join("\n"));
console.log("Injected " + players.length + " players into " + htmlPath);
