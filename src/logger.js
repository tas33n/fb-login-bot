const { tz, debug } = require("./config");

/**
 * @param {string} msg
 * @param {"success"|"error"|"debug"|"info"|"warn"} [level]
 */
const log = (msg, level = "info") => {
  if (!debug && level === "debug") return;
  const t = new Date().toLocaleString("en-US", { timeZone: tz });
  const c = { success: "\x1b[32m", error: "\x1b[31m", debug: "\x1b[36m", info: "\x1b[37m", warn: "\x1b[33m" }[level] || "\x1b[37m";
  console.log(`${c}[${t}] ${level.toUpperCase()}: ${msg}\x1b[0m`);
};

module.exports = { log };
