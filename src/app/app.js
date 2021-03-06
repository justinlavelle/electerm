
//use bluebird for performance
global.Promise = require('bluebird')

import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  globalShortcut,
  shell
} from 'electron'
import {fork} from 'child_process'
import _ from 'lodash'
import getConf from './utils/config.default'
import sshConfigItems from './lib/ssh-config'
import lookup from './utils/lookup'
import os from 'os'
import {resolve} from 'path'
import {instSftpKeys} from './server/sftp'
import {transferKeys} from './server/transfer'
import {saveUserConfig, userConfig} from './lib/user-config-controller'
import {init, changeHotkeyReg} from './lib/shortcut'
import {fsExport, fsFunctions} from './lib/fs'
import ls from './lib/ls'
import menu from './lib/menu'
import log from './utils/log'
import {testConnection} from './server/terminal'
import {saveLangConfig, lang, langs} from './lib/locales'
import {promisified as rp} from 'phin'
import lastStateManager from './lib/last-state'
import installSrc from './lib/install-src'
import {
  prefix
} from './lib/locales'

const a = prefix('app')
global.win = null
let timer
let timer1
let childPid
let {NODE_ENV} = process.env
const isDev = NODE_ENV === 'development'
const packInfo = require(isDev ? '../package.json' : './package.json')
const iconPath = resolve(
  __dirname,
  (
    isDev
      ? '../node_modules/@electerm/electerm-resource/res/imgs/electerm-round-128x128.png'
      : 'assets/images/electerm-round-128x128.png'
  )
)

function onClose() {
  log.debug('close app')
  ls.set({
    exitStatus: 'ok',
    sessions: null
  })
  process.nextTick(() => {
    clearTimeout(timer)
    clearTimeout(timer1)
    global.win = null
    process.kill(childPid)
    process.on('uncaughtException', function () {
      process.exit(0)
    })
    process.exit(0)
  })
}

async function waitUntilServerStart(url) {
  let serverStarted = false
  while (!serverStarted) {
    await rp({
      url,
      timeout: 100
    })
      .then(() => {
        serverStarted = true
      })
      .catch(() => null)
  }
}

log.debug('App starting...')

async function createWindow () {

  let config = await getConf()

  //start server
  let child = fork(resolve(__dirname, './server/server.js'), {
    env: Object.assign(
      {},
      process.env,
      _.pick(config, ['port', 'host'])
    ),
    cwd: process.cwd()
  }, (error, stdout, stderr) => {
    if (error || stderr) {
      throw error || stderr
    }
    log.info(stdout)
  })

  childPid = child.pid

  if (config.showMenu) {
    Menu.setApplicationMenu(menu)
  }

  let windowSizeLastState = lastStateManager.get('windowSize')
  const {width, height} = windowSizeLastState && !isDev
    ? windowSizeLastState
    : require('electron').screen.getPrimaryDisplay().workAreaSize

  // Create the browser window.
  global.win = new BrowserWindow({
    width,
    height,
    fullscreenable: true,
    //fullscreen: true,
    title: packInfo.name,
    frame: false,
    transparent: true,
    titleBarStyle: 'customButtonsOnHover',
    icon: iconPath
  })

  //win.setAutoHideMenuBar(true)

  //handle autohide flag
  if (process.argv.includes('--autohide')) {
    timer1 = setTimeout(() => global.win.hide(), 500)
    if (Notification.isSupported()) {
      let notice = new Notification({
        title: `${packInfo.name} ${a('isRunning')}, ${a('press')} ${config.hotkey} ${a('toShow')}`
      })
      notice.show()
    }
  }

  global.et = {
    exitStatus: process.argv.includes('--no-session-restore')
      ? 'ok' : ls.get('exitStatus')
  }
  Object.assign(global.et, {
    _config: config,
    installSrc,
    instSftpKeys,
    transferKeys,
    upgradeKeys: transferKeys,
    fs: fsExport,
    ls,
    getExitStatus: () => global.et.exitStatus,
    setExitStatus: (status) => {
      global.et.exitStatus = status
    },
    popup: (options) => {
      Menu.getApplicationMenu().popup(options)
    },
    versions: process.versions,
    sshConfigItems,
    testConnection,
    env: process.env,
    fsFunctions,
    openExternal: shell.openExternal,
    homeOrtmp: os.homedir() || os.tmpdir(),
    closeApp: () => {
      global.win.close()
    },
    restart: () => {
      global.win.close()
      app.relaunch()
    },
    minimize: () => {
      global.win.minimize()
    },
    maximize: () => {
      global.win.maximize()
    },
    unmaximize: () => {
      global.win.unmaximize()
    },
    isMaximized: () => {
      return global.win.isMaximized()
    },
    openDevTools: () => {
      global.win.webContents.openDevTools()
    },
    lookup,
    lang,
    langs,
    packInfo,
    lastStateManager,
    os,
    saveUserConfig,
    setTitle: (title) => {
      global.win.setTitle(packInfo.name + ' - ' +title)
    },
    changeHotkey: changeHotkeyReg(globalShortcut, global.win)
  })

  timer = setTimeout(() => {
    ls.set('exitStatus', 'unknown')
    saveLangConfig(saveUserConfig, userConfig)
  }, 100)

  let opts = require('url').format({
    protocol: 'file',
    slashes: true,
    pathname: resolve(__dirname, 'assets', 'index.html')
  })

  let childServerUrl = `http://localhost:${config.port}/run`
  if (isDev) {
    let {devPort = 5570} = process.env
    opts = `http://localhost:${devPort}`
  }

  await waitUntilServerStart(childServerUrl)

  global.win.loadURL(opts)
  //win.maximize()

  // Open the DevTools.
  if (isDev) {
    global.win.webContents.openDevTools()
  }

  //init hotkey
  init(globalShortcut, global.win, config)

  // Emitted when the window is closed.
  global.win.on('close', onClose)
  global.win.on('focus', () => {
    global.win.webContents.send('focused', null)
  })

}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', onClose)

app.on('activate', () => {

  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (global.win === null) {
    createWindow()
  }
})

