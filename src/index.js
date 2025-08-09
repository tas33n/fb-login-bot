const { loginFacebook } = require('./facebook-login');
const { cookiesPath } = require('./config');

(async () => {
  const email = process.env.FB_EMAIL;
  const password = process.env.FB_PASSWORD;
  const twoFASecret = process.env.FB_2FA_SECRET;
  const existingCookies = null;

  const res = await loginFacebook({ email, password, twoFASecret, existingCookies, cookiesFile: cookiesPath });
  console.log(JSON.stringify({ success: true, userID: res.userID, profileName: res.profileName }, null, 2));
})().catch(e => {
  console.error(e);
  process.exit(1);
});
