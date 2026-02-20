const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage } = require('electron');
const path = require('node:path')
const os = require('os');
const fs = require('fs');
const storage = require('electron-json-storage');
const windowStateKeeper = require('electron-window-state');
const prompt = require('electron-plugin-prompts');

//establish storage path for settings and screenshots
let storagePath = path.join(os.tmpdir(), 'EntranaLauncher');
if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath);
storage.setDataPath(storagePath);
let screenshots = path.join(os.tmpdir(), 'EntranaLauncher', 'Screenshots');
if (!fs.existsSync(screenshots)) fs.mkdirSync(screenshots);

const defaultTitle = "Entrana  |  Lost City Launcher";
let worlds = [], loginStatus = false, accounts = {}, currentWorld, lowMem, idleTimer, sessionTimer, loginMusic, mapWindow, latencyThreshold, lastWorldUpdate, pingHistory = [];

const warningDefaults = {
    title: 'Warning',
    label: '',
    icon: path.join(__dirname, 'icon.ico'),
    buttonLabels:{ok:'Continue', cancel:'Cancel'},
    width: 400,
    menuBarVisible: false,
    customStylesheet: path.join(__dirname, 'prompt.css'),
    inputAttrs: {type: 'hidden'},
    type: 'input'
}

function createWindow () {

  let mainWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 608
  });

  const mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    title: defaultTitle,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
    }
  })

  mainWindowState.manage(mainWindow);

  mainWindow.loadURL(`https://w${currentWorld}-2004.lostcity.rs/rs2.cgi?plugin=0&world=${currentWorld}&lowmem=${lowMem.value?1:0}`);

  createAppMenu(mainWindow);
  setInterval(() => createAppMenu(mainWindow), 10 * 1000); //update player counts

  ipcMain.on('resize-to-client', (event, windowHeight, canvasHeight) => {
    const statusBarHeight = 28;
    const size = mainWindow.getSize();
    const offset_win = windowHeight - canvasHeight;
    mainWindow.setSize(size[0], (size[1]-offset_win)+statusBarHeight);
  });

  //send stored settings to client on request
  ipcMain.on('send-stored-values', (event) => {
    mainWindow.webContents.send('client-message', {'IdleTimer': idleTimer.value});
    mainWindow.webContents.send('client-message', {'SessionTimer': sessionTimer.value});
    mainWindow.webContents.send('client-message', {'LoginMusic': loginMusic.value});
  });

  ipcMain.on('client-logged-in', (event, loggedIn) => {
    loginStatus = loggedIn;
    createAppMenu(mainWindow);
  });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  //disable history
  mainWindow.webContents.on('update-target-url', () => {
    mainWindow.webContents.navigationHistory.clear();
  })

  //warn user before closing if they are logged in
  mainWindow.on('close', function(e){
    if(loginStatus == true){
      prompt({...warningDefaults,
        description : 'You are currently logged in! Closing the launcher now will not log you out for 60 seconds. Are you sure you want to continue?'
      },mainWindow)
      .then((r) => {
          if(r !== null) app.exit(0);
      }).catch(console.error);
      e.preventDefault();
    }
  });

}

function createMapWindow(parentWindow) {
    parentWindow.webContents.send('client-message', {statusMessage: `Opening world map...`, timeout: 2000});

    if (mapWindow) {
        mapWindow.focus();
        return;
    }

    mapWindow = new BrowserWindow({
        title: 'World Map',
        width: 650,
        height: 542,
        parent: parentWindow,
        resizable: false,
        menuBarVisible: false,
        modal: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload-map.js')
        }
    });

    mapWindow.loadURL('https://2004.lostcity.rs/worldmap');
    mapWindow.setMenu(null);

    mapWindow.once('ready-to-show', () => {
        mapWindow.show();
    });

    mapWindow.on('closed', () => {
        mapWindow = null;
    });

    mapWindow.on('page-title-updated', (event) => {
      event.preventDefault();
    });
}

app.whenReady().then(() => {

  //initialize settings if not already set
  storage.keys(function(error, keys) {
    if (error) throw error;

    currentWorld = keys.includes('savedWorld') ? storage.getSync('savedWorld') : '2';
    if(!keys.includes('savedWorld')) storage.set('savedWorld', currentWorld);

    lowMem = keys.includes('savedLowMem') ? storage.getSync('savedLowMem') : {value: false};
    if(!keys.includes('savedLowMem')) storage.set('savedLowMem', lowMem);

    idleTimer = keys.includes('savedIdleTimer') ? storage.getSync('savedIdleTimer') : {value: 10};
    if(!keys.includes('savedIdleTimer')) storage.set('savedIdleTimer', idleTimer);

    sessionTimer = keys.includes('savedSessionTimer') ? storage.getSync('savedSessionTimer') : {value: 'time'};
    if(!keys.includes('savedSessionTimer')) storage.set('savedSessionTimer', sessionTimer);

    loginMusic = keys.includes('savedLoginMusic') ? storage.getSync('savedLoginMusic') : {value: true};
    if(!keys.includes('savedLoginMusic')) storage.set('savedLoginMusic', loginMusic);

    latencyThreshold = keys.includes('savedLatencyThreshold') ? storage.getSync('savedLatencyThreshold') : {value: 50};
    if(!keys.includes('savedLatencyThreshold')) storage.set('savedLatencyThreshold', latencyThreshold);

    createWindow()
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

function med(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) /2;
}

async function fetchWorlds(mainWindow, worlds) {
  if(lastWorldUpdate && Date.now() - lastWorldUpdate < 5000) return worlds;
  lastWorldUpdate = Date.now();
  try {
    const res = await fetch('https://2004.losthq.rs/pages/api/worlds.php');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const worldsData = await res.json();

    //get latency for all worlds
    for(let server of worldsData){
      server.ms = performance.now();
      await fetch(lowMem.value?server.ld:server.hd, { method: 'HEAD', cache: 'no-store', mode: 'no-cors' });
      server.ms = Math.ceil(performance.now() - server.ms);
    }
    
    //compare current world ping to history to determine spike
    const currentWorldPing = worldsData.find(s => s.world == currentWorld).ms;
    let spike = false;
    if(latencyThreshold.value !== false){
      const max_history = 20;
      if(pingHistory.length >= max_history/2){
        const baseline = med(pingHistory);
        const percentDiff = ((currentWorldPing - baseline) / baseline) * 100;
        if(percentDiff > latencyThreshold.value) spike = true;
      }
      pingHistory.push(currentWorldPing);
      if(pingHistory.length > max_history) pingHistory.shift();
    }
    mainWindow.webContents.send('client-message', {pingUpdate: currentWorldPing, spike});

    return worldsData;
  } catch (err) {
    console.error('Failed to fetch worlds:', err);
    return [];
  }
}

//shows username/password prompt for adding/updating accounts, then calls updateAccount to save changes
function addUpdateAccountPrompt(mainWindow,username) {
  prompt({
    title: username?'Update Account':'Add Account',
    label: '',
    icon: './icon.ico',
    buttonLabels:{ok:username?'Update Account':'Add Account', cancel:'Cancel'},
    width: 400,
    height: 260,
    menuBarVisible: false,
    customStylesheet: path.join(__dirname, 'prompt.css'),
    customScript: path.join(__dirname, 'prompt.js'),
    type: 'multiInput',
    multiInputOptions: [{
      label: 'Username',
      value: username || '',
      inputAttrs: {
        type: 'text',
        required: true,
        placeholder: 'Username'
      }
    },
    {
      label: 'Password',
      inputAttrs: {
        type: 'Password',
        required: true,
        placeholder: 'Password',
        class: 'password-field'
      }
    }]
  },mainWindow)
  .then((r) => {
      if(r === null) console.log('user cancelled');
      else updateAccount(mainWindow, r[0], r[1])
  }).catch(console.error);
}

//create/update/delete account & store encrypted password, then update menu
function updateAccount(mainWindow, username, password, deleteOnly = false) {
  let accounts = storage.getSync('savedAccounts');
  let exists = accounts[username] !== undefined;
  if(exists) delete accounts[username];

  if(!deleteOnly){
    const encryptedBuffer = safeStorage.encryptString(password);
    const encryptedPassword = encryptedBuffer.toString('latin1'); 
    accounts[username] = encryptedPassword;
  }

  storage.set('savedAccounts', accounts, function(error) {
    if (error) throw error;
    createAppMenu(mainWindow);
    mainWindow.webContents.send('client-message', {statusMessage: `Account ${username} ${deleteOnly?'removed':(exists?'updated':'added')}...`});
  });
}

//decrypt password and send to client
function sendClientLogin(mainWindow, username, encryptedPassword) {
  const bufferToDecrypt = Buffer.from(encryptedPassword, 'latin1');
  const decryptedPassword = safeStorage.decryptString(bufferToDecrypt);
  mainWindow.webContents.send('client-login', { username, decryptedPassword });
  mainWindow.webContents.send('client-message', {statusMessage: `Logging in as ${username}...`});
}

//build menu
async function createAppMenu(mainWindow) {
  worlds = await fetchWorlds(mainWindow,worlds);
  currentWorld = storage.getSync('savedWorld');
  lowMem = storage.getSync('savedLowMem');
  idleTimer = storage.getSync('savedIdleTimer');
  sessionTimer = storage.getSync('savedSessionTimer');
  accounts = storage.getSync('savedAccounts');
  latencyThreshold = storage.getSync('savedLatencyThreshold');

  let worldMenu = [{label: "Players Online: " + worlds.reduce((sum, w) => sum + w.count, 0), disabled: true},...worlds.map(world => ({
    label: `World ${world.world} ${world.location} - ${world.ms}ms - ${world.p2p? 'P2P' : 'F2P'} - ${world.count} players`,
    type: 'radio',
    checked: world.world === currentWorld,
    click: () => {
      createAppMenu(mainWindow);

      function doWorldChange(){
        currentWorld = world.world;
        storage.set('savedWorld', currentWorld, function(error) {
          if (error) throw error;
          mainWindow.webContents.send('client-message', {statusMessage: `Switching to World ${world.world}...`});
          mainWindow.loadURL(lowMem.value?world.ld:world.hd);
          mainWindow.title = defaultTitle + `  |  World ${world.world} ${world.location}`;
          createAppMenu(mainWindow);
          pingHistory = [];
        });
      }

      if(loginStatus == true){
        prompt({...warningDefaults,
          description : 'You are currently logged in! Changing worlds now will not log you out and your character will be in game for 60 seconds. Are you sure you want to continue?'
        },mainWindow)
        .then((r) => {
            if(r !== null) doWorldChange()
        }).catch(console.error);
      }else doWorldChange()
    }
  }))];

  function detailSwitch(lm){
    createAppMenu(mainWindow);

    function doChangeMem(lm){
      lowMem = {value: lm===1?true:false};
      storage.set('savedLowMem', lowMem, function(error) {
        if (error) throw error;
        mainWindow.webContents.send('client-message', {statusMessage: `Switching to ${lm===1?'Low':'High'} Detail...`});
        mainWindow.loadURL(mainWindow.webContents.getURL().replace(/lowmem=(\d)/, `lowmem=${lm}`));
        createAppMenu(mainWindow);
        pingHistory = [];
      });
    }

    if(loginStatus == true){
      prompt({...warningDefaults,
        description : 'You are currently logged in! Changing client detail now will not log you out and your character will be in game for 60 seconds. Are you sure you want to continue?'
      },mainWindow)
      .then((r) => {
          if(r !== null) doChangeMem(lm)
      }).catch(console.error);
    }else doChangeMem(lm)
  }

  let accountsMenu = [
    {
      label: '+ Add Account',
      click: () => addUpdateAccountPrompt(mainWindow)
    },
    {
      label: 'Manage Accounts',
      submenu: Object.keys(accounts).map((username) => ({
        label: username,
        submenu: [
        { label: 'Update Account', click: () => addUpdateAccountPrompt(mainWindow, username) },
        { label: 'Remove Account', click: () => updateAccount(mainWindow, username, null, true) }
      ]
      }))
    },
    {
      type: 'separator'
    },

    //if logged in, show message and disable menu, otherwise show accounts to login with
    ...(() => {
      if(loginStatus){
        return [{label: `You're already logged in!`, disabled: true}]
      }else{
        return Object.entries(accounts).map(([username, encryptedPassword]) => ({
          label: username,
          click: () => sendClientLogin(mainWindow, username, encryptedPassword)
        }))
      }
    })()
  ]

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Quit', role: 'quit' }
      ]
    },
    {
      label: 'Options',
      submenu: [
        { label: 'Game Detail', submenu:[
          { label: 'Low Detail', type: 'radio', checked: lowMem.value, click: () => detailSwitch(1)},
          { label: 'High Detail', type: 'radio', checked: !lowMem.value, click: () => detailSwitch(0)}
        ]},
        { label: 'Login Screen Music', submenu:[
          { label: 'Off', value: false },
          { label: 'On', value: true }
        ].map(option => ({
            label: option.label,
            type: 'radio',
            checked: loginMusic.value === option.value,
            click: () => {
              loginMusic = { value: option.value };

              storage.set('savedLoginMusic', loginMusic, function (error) {
                if (error) throw error;
                mainWindow.webContents.send('client-message', {LoginMusic: loginMusic.value});
                createAppMenu(mainWindow);
              });
            }
        }))},
        { label: 'Idle Timer', submenu:[
          { label: 'Off', value: false },
          { label: 'No Warning', value: 0 },
          { label: '5s Warning', value: 5 },
          { label: '10s Warning', value: 10 },
        ].map(option => ({
            label: option.label,
            type: 'radio',
            checked: idleTimer.value === option.value,
            click: () => {
              idleTimer = { value: option.value };

              storage.set('savedIdleTimer', idleTimer, function (error) {
                if (error) throw error;
                mainWindow.webContents.send('client-message', {IdleTimer: option.value});
              });
            }
        }))},
        { label: 'Session Timer', submenu:[
          { label: 'Off', value: false },
          { label: 'Game Ticks', value: 'ticks' },
          { label: 'Login Timer', value: 'time' },
        ].map(option => ({
          label: option.label,
          type: 'radio',
          checked: sessionTimer.value === option.value,
          click: () => {
            sessionTimer = { value: option.value };

            storage.set('savedSessionTimer', sessionTimer, function (error) {
              if (error) throw error;
              mainWindow.webContents.send('client-message', {SessionTimer: option.value});
            });
          }
        }))},
        { label: 'Latency Spike Warnings', submenu:[
          { label: 'Off', value: false },
          { label: '+50% threshold', value: 50 },
          { label: '+75% threshold', value: 75 },
          { label: '+100% threshold', value: 100 },
        ].map(option => ({
            label: option.label,
            type: 'radio',
            checked: latencyThreshold.value === option.value,
            click: () => {
              latencyThreshold = { value: option.value };

              storage.set('savedLatencyThreshold', latencyThreshold, function (error) {
                if (error) throw error;
              });
            }
        }))},
      ]
    },
    {
      label: 'World Select',
      id: 'world-select',
      submenu: worldMenu
    },
    {
      label: 'Accounts',
      id: 'accounts',
      submenu: accountsMenu
    },
    {
      label: 'Take Screenshot',
      click: () => {
        mainWindow.webContents.capturePage().then(image => {
          fs.writeFile(path.join(screenshots, `screenshot-${Date.now()}.png`), image.toPNG(), (err) => {
            if (err) throw err
            mainWindow.webContents.send('client-message', {'playScreenshotAudio': true});
            mainWindow.webContents.send('client-message', {statusMessage: `Screenshot saved!`, timeout: 2000});
          })
        })
      }
    },
    {
      label: 'View',
      submenu: [
        { label: 'Open World Map', click: () => createMapWindow(mainWindow) },
        { label: 'Open Screenshots Folder', click: () => { shell.openPath(screenshots); } },
        { label: 'Open Dev Tools', role: 'toggleDevTools', accelerator: '' },
        { type:  'separator' },
        { label: 'Lost City Website', click: () => { shell.openExternal('https://2004.lostcity.rs/'); } },
        { label: 'Project Github', click: () => { shell.openExternal('https://github.com/Slaying-dev/Entrana-Launcher'); } },
        { type:  'separator' },
        { label: 'Version ' + app.getVersion(), enabled: false }
      ]
    }
  ];
  
  mainWindow.setMenu(Menu.buildFromTemplate(template));
  mainWindow.title = defaultTitle + `  |  World ${currentWorld} ${worlds.find(w=>w.world === currentWorld).location}`;
};