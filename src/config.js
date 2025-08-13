require("dotenv").config();

/**
 * @typedef {Object} Timeouts
 * @property {number} nav
 * @property {number} short
 * @property {number} tiny
 */

/**
 * @typedef {Object} AppConfig
 * @property {boolean} headless
 * @property {string|null} cookiesPath
 * @property {string} tz
 * @property {boolean} debug
 * @property {string} loginUrl
 * @property {string} profileUrl
 * @property {string} deviceName
 * @property {Timeouts} timeouts
 */

/** @type {AppConfig} */
const config = {
  headless: process.env.HEADLESS !== "false",
  cookiesPath: process.env.COOKIES_PATH || null,
  tz: process.env.TZ || "Asia/Dhaka",
  debug: true, //process.env.DEBUG === "true",
  loginUrl: "https://m.facebook.com/login",
  profileUrl: "https://m.facebook.com/profile.php",
  deviceName: "iPhone 15 Pro",
  timeouts: { nav: 30000, short: 6000, tiny: 300 },
};

module.exports = config;