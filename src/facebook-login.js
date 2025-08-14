const fs = require("fs").promises;
const { log } = require("./logger");
const {
  clickByText,
  selectRadioByAriaLabel,
  fillByIdFast,
  sleep,
  setCookies,
  getCookies,
  saveCookiesArray,
  waitForCUserCookie,
  normalizeCookies,
  parseCookieString,
} = require("./page-utils");
const { launchBrowser, safeClose } = require("./browser-manager");
const { authenticator } = require("otplib");
const base = require("./config");

/** @returns {Promise<boolean>} */
const fileExists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

/** @param {string} p */
const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

/**
 * @param {import('puppeteer').Page} page
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
const hasGoToProfileButton = async (page, timeoutMs = 8000) => {
  try {
    await page.waitForFunction(
      () => !!document.querySelector('[role="button"][aria-label="Go to profile"]'),
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * @param {import('puppeteer').Page} page
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
const clickGoToProfile = async (page, timeoutMs = 8000) => {
  try {
    await page.waitForFunction(
      () => !!document.querySelector('[role="button"][aria-label="Go to profile"]'),
      { timeout: timeoutMs }
    );
    const clicked = await page.evaluate(() => {
      const el = document.querySelector('[role="button"][aria-label="Go to profile"]');
      if (!el) return false;
      (el instanceof HTMLElement ? el : el.closest('[role="button"]'))?.click?.();
      return true;
    });
    if (!clicked) return false;
    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {}),
      page.waitForFunction(() => /profile\.php|\/profile\//i.test(location.href), { timeout: 10000 }).catch(() => {}),
    ]);
    return true;
  } catch {
    return false;
  }
};


/**
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
const isLoginLike = async (page) => {
  try {
    return await page.evaluate(() => {
      const u = location.href;
      const hasLoginInput = !!document.querySelector(
        '#m_login_email, input[name="email"][type="text"], input[name="pass"]'
      );
      const checkpoint = /checkpoint|two_step|approvals|recover/i.test(u);
      const loginInUrl = /\/login\//i.test(u);
      return hasLoginInput || checkpoint || loginInUrl;
    });
  } catch {
    return false;
  }
};

/**
 * @param {import('puppeteer').Page} page
 */
const gotoHome = async (page) => {
  try {
    await page.goto("https://m.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
  } catch (e) {
    log(`auth-check: goto home failed: ${e?.message || e}`, "warn");
  }
};

/**
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').Browser} browser
 * @returns {Promise<{authenticated:boolean,userID:string|null,profileName:string|null}>}
 */
const checkIfAuthenticated = async (page, browser) => {
  const cookies = await getCookies(browser);
  const names = cookies.map((c) => c.name).sort();
  log(
    `auth-check: cookie snapshot count=${cookies.length}, names=[${names.join(
      ", "
    )}]`,
    "debug"
  );

  const beforeUrl = page.url();
  if (beforeUrl) log(`auth-check: precheck url=${beforeUrl}`, "debug");

  await gotoHome(page);
  let landed = page.url();
  log(`auth-check: landed on ${landed}`, "debug");

  if (await isLoginLike(page))
    return { authenticated: false, userID: null, profileName: null };

  const hasProfileBtn = await hasGoToProfileButton(page, 12000)
  const cUser = cookies.find((c) => c.name === "c_user");
  if (!hasProfileBtn && !cUser)
    return { authenticated: false, userID: null, profileName: null };
  log(
    `auth-check: hasProfileBtn=${hasProfileBtn}, cUser=${
      cUser?.value || "null"
    }`,
    "debug"
  );
  let profileName = null;
  if (hasProfileBtn) {
    for (let i = 1; i <= 3; i++) {
      log(`auth-check: clicking Go to profile (${i}/3)`, "info");
      const ok = await clickGoToProfile(page);
      landed = page.url();
      log(`auth-check: post-click url=${landed}`, "debug");
      // if (ok && /profile\.php|\/profile\//i.test(landed)) 
        break;
      await sleep(350);
    }
    try {
      const h = await page.waitForFunction(
        () => {
          const el = document.querySelector('[role="heading"]');
          return (
            el?.getAttribute("aria-label") || el?.textContent?.trim() || null
          );
        },
        { timeout: 6000 }
      );
      profileName = await h.jsonValue();
    } catch {}
  }

  if (!profileName) {
    try {
      const ui = await page.evaluate(() => {
        const heading = document.querySelector('[role="heading"]');
        const headingText =
          heading?.getAttribute("aria-label") ||
          heading?.textContent?.trim() ||
          null;
        return {
          logout: !!document.querySelector('a[href*="/logout.php"]'),
          settings: !!document.querySelector('a[href^="/settings"]'),
          messages: !!document.querySelector('a[href^="/messages"]'),
          friends: !!document.querySelector('a[href^="/friends"]'),
          headingText,
        };
      });
      const hasUi =
        ui.logout ||
        ui.settings ||
        ui.messages ||
        ui.friends ||
        !!ui.headingText;
      if (!hasUi && !cUser)
        return { authenticated: false, userID: null, profileName: null };
      profileName = ui.headingText || profileName;
    } catch {}
  }

  return {
    authenticated: true,
    userID: cUser?.value || null,
    profileName: profileName || null,
  };
};

/**
 * @typedef {Object} LoginArgs
 * @property {string} email
 * @property {string} password
 * @property {string} [twoFASecret]
 * @property {Array|String} [existingCookies] @description Array of cookie objects or a standard Cookie header string. String file paths are not allowed here.
 * @property {string|null} [cookiesFile] @description Single authoritative cookies file path. If absent, cookies will not be written to disk.
 * @property {boolean} [headless]
 * @property {string} [executablePath]
 * @property {string[]} [args]
 * @property {string} [deviceName]
 * @property {boolean} [blockRequests]
 * @property {import('puppeteer').Viewport} [defaultViewport]
 */

/**
 * @param {LoginArgs} args
 * @returns {Promise<{authenticated:boolean,userID:string|null,profileName:string|null,cookies:Array}>}
 */
async function loginFacebook(args) {
  const {
    email,
    password,
    twoFASecret,
    existingCookies = null,
    cookiesFile = (args.cookiesFile === null ? null : args.cookiesFile) ??
      base.cookiesPath ??
      null,
    headless,
    executablePath,
    args: launchArgs,
    deviceName,
    blockRequests,
    defaultViewport,
  } = args;

  const { browser, page } = await launchBrowser({
    headless,
    executablePath,
    args: launchArgs,
    deviceName,
    blockRequests,
    defaultViewport,
  });

  /** Try a cookies array against the session */
  const tryAuthWithCookies = async (label, raw) => {
    const normalized = Array.isArray(raw)
      ? normalizeCookies(raw)
      : parseCookieString(typeof raw === "string" ? raw : "");
    if (!normalized?.length) return null;
    log(`setting ${label} cookies`, "info");
    await setCookies(browser, normalized);
    const authed = await checkIfAuthenticated(page, browser);
    if (!authed.authenticated) return null;
    const cookies = await getCookies(browser);
    if (cookiesFile) await saveCookiesArray(cookiesFile, cookies);
    await safeClose(browser);
    return { ...authed, cookies };
  };

  try {
    if (cookiesFile && (await fileExists(cookiesFile))) {
      try {
        const fromFile = await readJson(cookiesFile);
        const viaFile = await tryAuthWithCookies("file", fromFile);
        console.log(viaFile);
        if (viaFile) {
          log("authenticated via cookies file", "success");
          return viaFile;
        }
        log(
          "stored cookies invalid/expired; continuing with credentials",
          "warn"
        );
      } catch (e) {
        log(
          `failed reading cookies file ${cookiesFile}: ${e?.message || e}`,
          "warn"
        );
      }
    }

    if (existingCookies) {
      const viaProvided = await tryAuthWithCookies("provided", existingCookies);
      if (viaProvided) {
        log("authenticated via provided cookies", "success");
        return viaProvided;
      }
    }

    log("navigating to login", "info");
    await page.goto(base.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: base.timeouts.nav,
    });

    const welcomed = await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const wanted = "i already have an account";
      const nodes = document.querySelectorAll(
        'span,button,[role="button"],a,div'
      );
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
      log('Clicked "I already have an account"', "info");
      await sleep(500);
    }

    log("filling #m_login_email", "info");
    await fillByIdFast(page, "m_login_email", email);

    log("filling #m_login_password", "info");
    await fillByIdFast(page, "m_login_password", password);

    log('clicking "Log in"', "info");
    await clickByText(page, "Log in", 5, 300, true, 'click "Log in"');
    await page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 })
      .catch(() => {});
    await sleep(200);

    log('clicking "Try another way"', "info");
    await clickByText(
      page,
      "Try another way",
      5,
      200,
      true,
      'click "Try another way"'
    );

    log(
      "selecting radio by aria-label: Authentication app + Get a code...",
      "info"
    );
    const radioOrCode = await Promise.race([
      selectRadioByAriaLabel(
        page,
        ["authentication app", "get a code from your authentication app"],
        5,
        250,
        'select radio "Authentication app, Get a code..."'
      )
        .then(() => "radio")
        .catch(() => "skip"),
      page
        .waitForFunction(
          () =>
            !!document.querySelector(
              'input[aria-label="Code"],input[name="approvals_code"]'
            ),
          { timeout: 3000 }
        )
        .then(() => "code")
        .catch(() => "none"),
    ]);
    if (radioOrCode === "radio") {
      log('radio selected, clicking "Continue"', "info");
      await clickByText(
        page,
        "Continue",
        5,
        250,
        true,
        'click "Continue" after radio'
      );
    }

    await page
      .waitForFunction(
        () =>
          !!document.querySelector(
            'input[aria-label="Code"],input[name="approvals_code"]'
          ),
        { timeout: 8000 }
      )
      .catch(() => {});
    const needCode = await page.evaluate(
      () =>
        !!document.querySelector(
          'input[aria-label="Code"],input[name="approvals_code"]'
        )
    );
    if (needCode && twoFASecret) {
      log("filling 2FA code", "info");
      const code = authenticator.generate(twoFASecret);
      const sel = 'input[aria-label="Code"],input[name="approvals_code"]';
      await page.waitForSelector(sel, { visible: true, timeout: 10000 });
      for (let i = 0; i < 3; i++) {
        await page.click(sel, { clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.type(sel, code, { delay: 15 });
        const v = await page.$eval(sel, (el) => el.value);
        if (v === code) break;
        await sleep(150);
      }
      await clickByText(
        page,
        "Continue",
        5,
        250,
        true,
        'click "Continue" after code'
      );
    }

    try {
      await page.waitForSelector('[role="button"][aria-label="Save"]', {
        visible: true,
        timeout: 6000,
      });
      await page.click('[role="button"][aria-label="Save"]');
      log('clicked "Save"', "success");
    } catch {}

    const gotCookie = await waitForCUserCookie(browser, 12000, 250);
    if (!gotCookie) {
      await clickByText(
        page,
        "Continue",
        2,
        250,
        true,
        'click "Continue" checkpoint'
      );
      await sleep(500);
    }

    const authed = await checkIfAuthenticated(page, browser);
    if (!authed.authenticated) throw new Error("Login failed");

    log("saving cookies (if path provided)", "info");
    const cookies = await getCookies(browser);
    if (cookiesFile) await saveCookiesArray(cookiesFile, cookies);
    await safeClose(browser);
    log(`login complete for user ${authed.userID}`, "success");
    return { ...authed, cookies };
  } catch (e) {
    log(`fatal error: ${e?.message || e}`, "error");
    try {
      await page.screenshot({ path: "error-screenshot.png" });
      log("saved error-screenshot.png", "warn");
    } catch {}
    await safeClose(browser);
    throw e;
  }
}

module.exports = { loginFacebook, default: loginFacebook };
