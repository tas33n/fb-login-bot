const fs = require('fs').promises;
const { log } = require('./logger');
const { timeouts } = require('./config');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const retry = async (fn, attempts = 5, delayMs = 500, label = 'task') => {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      log(`${label}: attempt ${i}/${attempts}`, 'debug');
      const out = await fn();
      log(`${label}: success on attempt ${i}`, 'debug');
      return out;
    } catch (e) {
      last = e;
      log(`${label}: failed attempt ${i} – ${e?.message || e}`, i === attempts ? 'warn' : 'debug');
      if (i < attempts) await sleep(delayMs);
    }
  }
  throw last;
};

const clickByText = async (page, text, attempts = 5, delay = 250, exact = true, label = `click "${text}"`) => {
  const target = text.trim().toLowerCase();
  return retry(async () => {
    const handle = await page.waitForFunction(
      (t, ex) => {
        const norm = s => s?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
        const nodes = document.querySelectorAll('button,[role="button"],a,div,span');
        for (const el of nodes) {
          const txt = norm(el.innerText);
          if (!txt) continue;
          const hit = ex ? txt === norm(t) : txt.includes(norm(t));
          if (!hit) continue;
          if (el.closest('[aria-disabled="true"],[disabled]')) continue;
          const btn = (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.tagName === 'A') ? el : el.closest('button,[role="button"],a');
          if (btn) return btn;
        }
        return null;
      },
      { timeout: timeouts.short },
      target,
      !!exact
    );
    const el = await handle.asElement();
    await el.click();
  }, attempts, delay, label).catch(() => { log(`${label}: not found, skipping`, 'warn'); });
};

const selectRadioByAriaLabel = async (page, substrings, attempts = 5, delay = 250, label = 'select radio') => {
  const wants = substrings.map(s => s.toLowerCase());
  return retry(async () => {
    const h = await page.waitForFunction(
      (arr) => {
        const norm = s => s?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
        const radios = document.querySelectorAll('[role="radio"]');
        for (const el of radios) {
          const al = norm(el.getAttribute('aria-label') || '');
          if (arr.every(w => al.includes(w))) return el;
        }
        return null;
      },
      { timeout: timeouts.short },
      wants
    );
    const el = await h.asElement();
    await el.click();
    await page.waitForFunction(
      (arr) => {
        const norm = s => s?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
        const sel = document.querySelector('[role="radio"][aria-checked="true"]');
        if (!sel) return false;
        const al = norm(sel.getAttribute('aria-label') || '');
        return arr.every(w => al.includes(w));
      },
      { timeout: timeouts.short },
      wants
    );
  }, attempts, delay, label).catch(() => { log(`${label}: not found, skipping`, 'warn'); });
};

const fillByIdFast = async (page, id, value) => {
  const sel = `#${id}`;
  await retry(async () => {
    const h = await page.waitForSelector(sel, { timeout: timeouts.short });
    await page.evaluate((el, v) => {
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, h, value);
    const val = await page.$eval(sel, el => el.value);
    if (val !== value) {
      await page.click(sel, { clickCount: 3 });
      await page.type(sel, value, { delay: 10 });
      const again = await page.$eval(sel, el => el.value);
      if (again !== value) throw new Error(`failed to set ${id}`);
    }
  }, 3, 150, `fill #${id}`);
};

const normalizeCookies = (raw) => raw.map(c => {
  const name = c.name || c.key;
  if (!name || !c.value) return null;
  const expires =
    typeof c.expires === 'number' && c.expires > 0 ? c.expires :
    typeof c.expirationDate === 'number' && c.expirationDate > 0 ? c.expirationDate : -1;
  return {
    name,
    value: String(c.value),
    domain: c.domain || '.facebook.com',
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameParty: c.sameParty ?? false,
    expires
  };
}).filter(Boolean);

const resolveExistingCookies = async (existingCookies, fileExists, readJson) => {
  if (!existingCookies) return null;
  if (Array.isArray(existingCookies)) return normalizeCookies(existingCookies);
  if (typeof existingCookies === 'string') {
    const maybePath = existingCookies.trim();
    try {
      if (await fileExists(maybePath)) {
        const fromFile = await readJson(maybePath);
        return normalizeCookies(Array.isArray(fromFile) ? fromFile : []);
      }
    } catch {}
    const arr = existingCookies.split(';').map(s => s.trim()).filter(Boolean).map(s => {
      const i = s.indexOf('=');
      if (i === -1) return null;
      return { name: s.slice(0, i).trim(), value: s.slice(i + 1).trim(), domain: '.facebook.com', path: '/' };
    }).filter(Boolean);
    return normalizeCookies(arr);
  }
  throw new Error('existingCookies must be an array, cookie string, or a readable file path');
};

const setCookies = async (browser, cookies) => {
  if (!cookies?.length) return;
  const ctx = browser.defaultBrowserContext();
  await ctx.setCookie(...cookies);
};

const getCookies = async (browser) => {
  const ctx = browser.defaultBrowserContext();
  return await ctx.cookies('https://m.facebook.com');
};

const saveCookiesArray = async (cookiesPath, cookies = []) => {
  if (!cookiesPath) return;
  await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
};

const waitForCUserCookie = async (browser, totalMs = 10000, step = 250) => {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    const cookies = await getCookies(browser);
    if (cookies.find(c => c.name === 'c_user')) return true;
    await sleep(step);
  }
  return false;
};

module.exports = {
  sleep,
  retry,
  clickByText,
  selectRadioByAriaLabel,
  fillByIdFast,
  resolveExistingCookies,
  setCookies,
  getCookies,
  saveCookiesArray,
  waitForCUserCookie
};
