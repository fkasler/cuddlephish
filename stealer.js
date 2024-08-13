import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteer.use(StealthPlugin())
import fs from 'fs';

const default_user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.54 Safari/537.36";
var proxy = false
if(process.argv.length > 3){
  var proxy = process.argv[2];
  var session = JSON.parse(fs.readFileSync(process.argv[3]));
}else{
  var session = JSON.parse(fs.readFileSync(process.argv[2]));
}

(async () => {
  let puppet_options = [
    "--ignore-certificate-errors",
    "--disable-blink-features=AutomationControlled",
    "--start-maximized",
    "--no-sandbox",
    "--remote-debugging-port=9223",
  ]
  if(proxy){
    puppet_options.push("--proxy-server=" + proxy)
  }
  const browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ["--enable-automation"],
    defaultViewport: null,
    args: puppet_options
  });
  browser.on('disconnected', () => browser.close());
  const page = await browser.newPage();
  var checkClosed = setInterval(async () => {
    const pages = await browser.pages()
    if(pages == 0) {
      clearInterval(checkClosed);
      process.exit();
    }
  }, 3000)
  await page.setUserAgent(default_user_agent)
  //filter out the partitionKey attribute on all cookies
  session.cookies.map((cookie) => {
    delete cookie.partitionKey
  })
  //inject our cookies
  // const cdp = await page.target().createCDPSession();
  // await cdp.send('Network.setCookies',{
  //   cookies: session.cookies,
  // })
  for (let cookie of session.cookies) {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.setCookie', cookie).catch((err) => console.log(`error setting cookie on ${cookie}`, err));
  }

  //load the page without JS real quick so that we can inject local storage without interference
  await page.setJavaScriptEnabled(false)
  await page.goto(session.url, {
    waitUntil: 'networkidle2'
  })
  .catch((err) => console.log("error loading url", err));
  session.local_storage.map(async (key_val) => {
    await page.evaluate(`window.localStorage.setItem('${key_val[0]}', ${JSON.stringify(key_val[1])});`)
  })
  
  //load it for real this time
  await page.setJavaScriptEnabled(true)
  await page.goto(session.url, {
    waitUntil: 'networkidle2'
  })
  .catch((err) => console.log("error loading url", err));

})();
