const fs = require('fs').promises;
const { log } = require('./logger');
const {
  clickByText, selectRadioByAriaLabel, fillByIdFast, sleep,
  resolveExistingCookies, setCookies, getCookies,
  saveCookiesArray, waitForCUserCookie
} = require('./page-utils');
const { launchBrowser, safeClose } = require('./browser-manager');
const { authenticator } = require('otplib');
const { loginUrl, profileUrl, cookiesPath, timeouts } = require('./config');

const fileExists = async p => { try { await fs.access(p); return true; } catch { return false; } };
const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));

const checkIfAuthenticated = async (page, browser) => {
  log('checking authentication state', 'debug');
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  const cookies = await getCookies(browser);
  const cUser = cookies.find(c => c.name === 'c_user');
  if (!cUser) return { authenticated: false, userID: null, profileName: null };
  let profileName = null;
  try {
    const h = await page.waitForFunction(() => document.querySelector('[role="heading"]') || null, { timeout: 1500 });
    const el = await h.asElement();
    profileName = await el.evaluate(e => e.getAttribute('aria-label') || e.textContent?.trim() || null);
  } catch {}
  return { authenticated: true, userID: cUser.value, profileName };
};

async function loginFacebook({
   email, password, twoFASecret,
   existingCookies = null,
   cookiesFile = cookiesPath,
   headless, executablePath, args, deviceName, blockRequests, defaultViewport
 }) {
  const { browser, page } = await launchBrowser({ headless, executablePath, args, deviceName, blockRequests, defaultViewport });
  try {
    const resolved = await resolveExistingCookies(existingCookies, fileExists, readJson);
    if (resolved?.length) {
      log('setting provided cookies', 'info');
      await setCookies(browser, resolved);
      if (await waitForCUserCookie(browser, 1)) {
        const authed = await checkIfAuthenticated(page, browser);
        if (authed.authenticated) {
          log('authenticated via provided cookies', 'success');
          const cookies = await getCookies(browser);
          await saveCookiesArray(cookiesFile, cookies);
          await safeClose(browser);
          return { ...authed, cookies };
        }
      }
      log('provided cookies invalid/expired; continuing with credentials', 'warn');
    } else if (await fileExists(cookiesFile)) {
      const fromFile = await readJson(cookiesFile);
      if (fromFile?.length) {
        log(`loading cookies from ${cookiesFile}`, 'info');
        await setCookies(browser, fromFile);
        if (await waitForCUserCookie(browser, 1)) {
          const authed = await checkIfAuthenticated(page, browser);
          if (authed.authenticated) {
            log('authenticated via saved cookies', 'success');
            const cookies = await getCookies(browser);
            await saveCookiesArray(cookiesFile, cookies);
            await safeClose(browser);
            return { ...authed, cookies };
          }
        }
        log('saved cookies invalid/expired; continuing with credentials', 'warn');
      }
    }

    log('navigating to login', 'info');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeouts.nav });

    // Handle welcome screen variant: "I already have an account"
    const welcomed = await page.evaluate(() => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const wanted = 'i already have an account';
      const nodes = document.querySelectorAll('span,button,[role="button"],a,div');
      for (const el of nodes) {
        if (norm(el.innerText) === wanted) {
          const btn = el.closest('button,[role="button"],a') || el;
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (welcomed) {
      log('Clicked "I already have an account"', 'info');
      await sleep(500);
    }

    log('filling #m_login_email', 'info');
    await fillByIdFast(page, 'm_login_email', email);

    log('filling #m_login_password', 'info');
    await fillByIdFast(page, 'm_login_password', password);

    log('clicking "Log in"', 'info');
    await clickByText(page, 'Log in', 5, 300, true, 'click "Log in"');

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await sleep(200);

    log('clicking "Try another way"', 'info');
    await clickByText(page, 'Try another way', 5, 200, true, 'click "Try another way"');

    log('selecting radio by aria-label: Authentication app + Get a code...', 'info');
    const radioOrCode = await Promise.race([
      selectRadioByAriaLabel(page, ['authentication app', 'get a code from your authentication app'], 5, 250, 'select radio "Authentication app, Get a code..."').then(() => 'radio').catch(() => 'skip'),
      page.waitForFunction(() => !!document.querySelector('input[aria-label="Code"],input[name="approvals_code"]'), { timeout: 3000 }).then(() => 'code').catch(() => 'none')
    ]);

    if (radioOrCode === 'radio') {
      log('radio selected, clicking "Continue"', 'info');
      await clickByText(page, 'Continue', 5, 250, true, 'click "Continue" after radio');
    }

    await page.waitForFunction(() => !!document.querySelector('input[aria-label="Code"],input[name="approvals_code"]'), { timeout: 8000 }).catch(() => {});
    const needCode = await page.evaluate(() => !!document.querySelector('input[aria-label="Code"],input[name="approvals_code"]'));
    if (needCode && twoFASecret) {
      log('filling 2FA code', 'info');
      const code = authenticator.generate(twoFASecret);
      const sel = 'input[aria-label="Code"],input[name="approvals_code"]';
      await page.waitForSelector(sel, { visible: true, timeout: 10000 });
      for (let i = 0; i < 3; i++) {
        await page.click(sel, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(sel, code, { delay: 15 });
        const v = await page.$eval(sel, el => el.value);
        if (v === code) break;
        await sleep(150);
      }
      await clickByText(page, 'Continue', 5, 250, true, 'click "Continue" after code');
    }

    // Post-2FA Save prompt
    try {
      await page.waitForSelector('[role="button"][aria-label="Save"]', { visible: true, timeout: 6000 });
      await page.click('[role="button"][aria-label="Save"]');
      log('clicked "Save"', 'success');
    } catch {}

    // Confirm auth via cookie
    const gotCookie = await waitForCUserCookie(browser, 12000, 250);
    if (!gotCookie) {
      await clickByText(page, 'Continue', 2, 250, true, 'click "Continue" checkpoint');
      await sleep(500);
    }

    const authed = await checkIfAuthenticated(page, browser);
    if (!authed.authenticated) throw new Error('Login failed');

    log('saving cookies', 'info');
    const cookies = await getCookies(browser);
    await saveCookiesArray(cookiesFile, cookies);
    await safeClose(browser);
    log(`login complete for user ${authed.userID}`, 'success');
    return { ...authed, cookies };
  } catch (e) {
    log(`fatal error: ${e?.message || e}`, 'error');
    try { await page.screenshot({ path: 'error-screenshot.png' }); log('saved error-screenshot.png', 'warn'); } catch {}
    await safeClose(browser);
    throw e;
  }
}

module.exports = { loginFacebook, loginPuppy: loginFacebook, default: loginFacebook };
