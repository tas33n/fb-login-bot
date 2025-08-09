require('dotenv').config();

module.exports = {
  headless: process.env.HEADLESS !== 'false',
  cookiesPath: process.env.COOKIES_PATH || 'cookies.json',
  tz: process.env.TZ || 'Asia/Dhaka',
  debug: process.env.DEBUG === 'true',
  loginUrl: 'https://m.facebook.com/login',
  profileUrl: 'https://m.facebook.com/profile.php',
  deviceName: 'iPhone 15 Pro',
  timeouts: {
    nav: 30000,
    short: 6000,
    tiny: 300
  }
};
