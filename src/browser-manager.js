const puppeteer = require('puppeteer');
const { log } = require('./logger');
const { headless, deviceName } = require('./config');

const launchBrowser = async (overrides = {}) => {
  log('launching browser', 'info');
  const browser = await puppeteer.launch({
    headless: overrides.headless ?? headless,
    executablePath: overrides.executablePath,        // optional
    args: overrides.args ?? ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: overrides.defaultViewport ?? null
  });
  const page = await browser.newPage();
  await page.emulate(puppeteer.KnownDevices[overrides.deviceName ?? deviceName]);
  log(`emulated ${deviceName}`, 'debug');
  if (overrides.blockRequests !== false) await enableRequestBlocking(page);
  return { browser, page };
};

const enableRequestBlocking = async (page) => {
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (type === 'image' || type === 'font' || type === 'stylesheet' || type === 'media') return req.abort();
    req.continue();
  });
};

const safeClose = async (browser) => {
  try { if (browser?.isConnected?.()) await browser.close(); } catch {}
};

module.exports = { launchBrowser, safeClose };
