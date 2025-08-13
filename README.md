# fb-login-bot

Facebook auto-login with 2FA using Puppeteer. Cookie-aware, resilient, and production-ready.

## Features
- Plain Puppeteer
- Cookie short-circuit (array|string|file)
- 2FA via TOTP (otplib)
- Stable ARIA/text targeting (no brittle classes)
- Request blocking for speed
- Graceful retries and safe cleanup

## Install
```bash
npm i fb-login-bot
```

## Usage
```js
const { loginFacebook } = require('fb-login-bot');

(async () => {
  const res = await loginFacebook({
    email: process.env.FB_EMAIL,
    password: process.env.FB_PASSWORD,
    twoFASecret: process.env.FB_2FA_SECRET,
    cookiesFile: process.env.COOKIES_PATH || null,
    headless: true,
  });
  console.log(res);
})();
```


### Env
- `FB_EMAIL`, `FB_PASSWORD`, `FB_2FA_SECRET`
- `COOKIES_PATH` (default `cookies.json`)
- `HEADLESS` (`true` by default), `DEBUG` (`false` by default), `TZ` (default `Asia/Dhaka`)

## API
```ts
type LoginArgs = {
  email: string
  password: string
  twoFASecret?: string
  existingCookies?: Array|String // array, cookie string, or file path
  cookiesFile?: string
}

loginFacebook(args: LoginArgs) -> Promise<{
  authenticated: boolean
  userID: string|null
  profileName: string|null
  cookies: Array
}>
```

## License
MIT
