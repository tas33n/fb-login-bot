const puppeteer = require("puppeteer");
const { log } = require("./logger");
const base = require("./config");

/**
 * @typedef {Object} LaunchOverrides
 * @property {boolean} [headless]
 * @property {string} [executablePath]
 * @property {string[]} [args]
 * @property {string} [deviceName]
 * @property {boolean} [blockRequests]
 * @property {import('puppeteer').Viewport} [defaultViewport]
 */

/**
 * @param {LaunchOverrides} [overrides]
 * @returns {Promise<{browser: import('puppeteer').Browser, page: import('puppeteer').Page}>}
 */
const launchBrowser = async (overrides = {}) => {
  const headless = overrides.headless ?? base.headless;
  const deviceName = overrides.deviceName ?? base.deviceName;
  log(`launching browser (headless=${headless})`, "info");
  const browser = await puppeteer.launch({
    headless,
    executablePath: overrides.executablePath ?? process.env.PUPPETEER_EXECUTABLE_PATH,
    args: overrides.args ?? ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: overrides.defaultViewport ?? null,
  });
  const page = await browser.newPage();
  await page.emulate(puppeteer.KnownDevices[deviceName]);
  log(`emulated ${deviceName}`, "debug");
  if (overrides.blockRequests !== false) await enableRequestBlocking(page);
  return { browser, page };
};

/** @param {import('puppeteer').Page} page */
const enableRequestBlocking = async (page) => {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (["image", "font", "stylesheet", "media"].includes(type)) return req.abort();
    req.continue();
  });
};

/** @param {import('puppeteer').Browser} browser */
const safeClose = async (browser) => {
  try {
    if (browser?.isConnected?.()) await browser.close();
  } catch {}
};

module.exports = { launchBrowser, safeClose };
