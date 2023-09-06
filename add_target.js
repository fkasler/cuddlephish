import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import fs from 'fs';
import path from 'path';
import prompt from 'prompt';
prompt.message = '';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const default_user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.54 Safari/537.36";
var config = {}
if (fs.existsSync('./targets.json')){
  config = JSON.parse(fs.readFileSync('./targets.json'))
}

var captured_favicon = false;
var desperate = false;
var super_desperate = false;
var favicon_url = '';

(async () => {
  let puppet_options = [
    "--ignore-certificate-errors",
    "--disable-blink-features=AutomationControlled",
    "--start-maximized",
    "--no-sandbox",
  ]
  const browser = await puppeteer.launch({
    headless: "new",
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ["--enable-automation"],
    defaultViewport: null,
    args: puppet_options
  });
  const page = await browser.newPage();
  await page.setUserAgent(default_user_agent)
  await page.setCacheEnabled(false);
  const {login_page} = await prompt.get([{name: 'login_page', description: 'URL of Login Page to Target', type: 'string'}]);
  const short_name = login_page.split("/")[2].split('.').slice(-2, -1)[0]

  page.on('response', async response => {
    let mime_type = response.headers()['content-type'] 
    if (mime_type === 'image/x-icon' || mime_type === 'image/vnd.microsoft.icon' || (desperate && /image/.test(mime_type)) || super_desperate) {
      captured_favicon = true
      console.log(`Collected Favicon From: ${response.url()}`)
      response.buffer().then(file => {
        const fileName = `favicons/${short_name}.ico`;
        const filePath = path.resolve(__dirname, fileName);
        const writeStream = fs.createWriteStream(filePath);
        writeStream.write(file);
      });
    }
  });

  await page.goto(login_page, {
    waitUntil: 'networkidle2'
  })
  .catch((err) => console.log("error loading url", err));
  const title = await page.evaluate('document.title');
  console.log(`Target Tab Title: ${title}`)
  if(!captured_favicon){
    console.log(`Failed to Passively Collect Favicon... Attempting to Manually Extract`)
    favicon_url = await page.evaluate('const iconElement = document.querySelector("link[rel~=icon]");const href = (iconElement && iconElement.href) || "/favicon.ico";const faviconURL = new URL(href, window.location).toString();faviconURL;');
    desperate = true
    await page.goto(favicon_url, {
      waitUntil: 'networkidle2'
    })
  }

  if(!captured_favicon){
    console.log(`Failed to Actively Collect Favicon... Attempting to One Last Try`)
    super_desperate = true
    await page.goto(favicon_url, {
      waitUntil: 'networkidle2'
    })
  }

  if(!captured_favicon){
    console.log(`Failed to Actively Collect Favicon... Try Downloading it Yourself and Name it ./favicons/${short_name}.ico`)
  }
  config[short_name] = {
    login_page: login_page, 
    boot_location: login_page, 
    tab_title: title,
    favicon: `${short_name}.ico`,
    payload: `payload.txt`,
  }
  fs.writeFileSync(`./targets.json`,`${JSON.stringify(config, null, 2)}`)

  await browser.close();
})();
