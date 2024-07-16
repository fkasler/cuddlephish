import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import fs from 'fs';

var proxy = process.argv[2];
var target = process.argv[3];

(async () => {
    //connect to the browser via puppeteer.connect
    const browser = await puppeteer.connect({
        //browserWSEndpoint: `ws://${proxy}`,
        browserURL: `http://${proxy}`,
    }).catch((err) => console.log("error connecting to browser", err));
    const target_page = await browser.newPage();
    await target_page.goto(target, {
        waitUntil: 'networkidle2'
    })
    let cookie_data = await target_page._client.send('Storage.getCookies')
    let cookies = cookie_data.cookies
    let dom_data = await target_page._client.send('DOMStorage.getDOMStorageItems', {
        storageId: {
            securityOrigin: await target_page.evaluate(() => window.origin),
            isLocalStorage: true,
        },
    })
    let local_storage = dom_data.entries
    console.log({ url: target_page.url(), cookies: cookies, local_storage: local_storage })
    //write the data to a file
    fs.writeFileSync('data.json', JSON.stringify({ url: target_page.url(), cookies: cookies, local_storage: local_storage }))
    //close the page
    await target_page.close();
    //disconnect from the browser
    await browser.disconnect();
})()