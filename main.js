const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage, globalShortcut, dialog } = require('electron');
const path = require('node:path')
const os = require('os');
const fs = require('fs');
const storage = require('electron-json-storage');
const windowStateKeeper = require('electron-window-state');
const Prompt = require('electron-plugin-prompts');

//establish storage path for settings - may want to make this a setting?
let storagePath = path.join(os.tmpdir(), 'EntranaLauncher');
if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath);
storage.setDataPath(storagePath);

const defaultTitle = "Entrana  |  Lost City Launcher";
let mainWindow, mapWindow, worlds = [], loginStatus = false, accounts = {}, settings = {}, lastWorldUpdate = 0, pingHistory = [], pkg = { lastcall:0 }, registeredShortcuts = {}, settingsOpen;

const settingDefaults = {
  world: '2',
  lowMem: false,
  idleTimer: true,
  idleTimerThreshold: 10,
  sessionTimer: 'time',
  loginMusic: true,
  latencyWarning: true,
  latencyWarningThreshold: 100,
  screenshotsPath: path.join(storagePath, 'Screenshots'),
  kb_screenshot: 'Ctrl+PrintScreen',
  kb_quickLogin: 'Home',
  kb_worldMap: 'Ctrl+M',
  kb_refresh: 'Ctrl+Shift+Alt+R', //want this default to be hard to accidentally press since it purposely doesnt check for login
  vol_music: 5,
  vol_sfx: 10,
  vol_entrana: 40,
  ssc_level: true,
  ssc_treasure: true,
  ssc_quest: true,
  ssc_death: true
}

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

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    backgroundColor: '#000000',
    title: defaultTitle,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      backgroundThrottling: false
    }
  })

  mainWindowState.manage(mainWindow);
  
  mainWindow.loadURL(`https://w${settings.world}-2004.lostcity.rs/rs2.cgi?plugin=0&world=${settings.world}&lowmem=${settings.lowMem?1:0}`);
  
  //show blank menu until our menu is created. otherwise we see electron default menu
  mainWindow.setMenu(Menu.buildFromTemplate([{label:'',disabled:true}]));
  
  createAppMenu();
  setInterval(() => createAppMenu(), 10*1000); //update player counts/latency

  ipcMain.on('resize-to-client', (_, windowHeight, canvasHeight) => {
    const statusBarHeight = 28;
    const size = mainWindow.getSize();
    const offset_win = windowHeight - canvasHeight;
    mainWindow.setSize(size[0], (size[1]-offset_win)+statusBarHeight);
  });

  //send stored settings to client on request
  ipcMain.on('send-stored-values', () => {
    mainWindow.webContents.send('client-message', settings);
  });

  ipcMain.on('client-logged-in', (_, loggedIn) => {
    loginStatus = loggedIn;
    createAppMenu();
  });

  ipcMain.on('take-category-screenshot', (_, data) => {
    if(settings[`ssc_${data.category}`]) takeScreenshot(data);
  });

  ipcMain.on('volume-change', (_, data) => {
    mainWindow.webContents.send('client-message', {[data.name] : data.value});
  });

  ipcMain.on('chat-logger', (_, entry) => {
    let chatLogPath = path.join(storagePath, [1,2].includes(entry.type)?'publicChat.log':'privateChat.log');
    let user = entry.user.startsWith('@cr') ? `[${entry.user.startsWith('@cr1')?'MOD':'ADMIN'}}] ${entry.user.substring(5)}` : entry.user;
    if(entry.type == 6) user = `To ${user}`; if(entry.type == 3 || entry.type == 7) user = `From ${user}`;
    fs.appendFile(chatLogPath, `${new Date().toISOString()} | ${user}: ${entry.message}\n`, (err) => {
      if (err) {
        console.error('Error writing file:', err);
        return;
      }
    });
  })

  ipcMain.on('prompt-for-directory', async(_, {name, current}) => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win, {defaultPath: current, properties: ['openDirectory'] });
    win.webContents.send('update-directory', {name: name, dir: res.canceled ? false : res.filePaths[0]});
  });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  //disable history
  mainWindow.webContents.on('update-target-url', () => {
    mainWindow.webContents.navigationHistory.clear();
  })

  //warn user before closing if they are logged in
  mainWindow.on('close', (e) => {
    if(loginStatus == true){
      Prompt({...warningDefaults,
        description : 'You are currently logged in! Closing the launcher now will not log you out for 60 seconds. Are you sure you want to continue?'
      },mainWindow)
      .then((r) => {
          if(r !== null) app.exit(0);
      }).catch(console.error);
      e.preventDefault();
    }
  });

  //register keybinds
  registerUpdateShortcut('kb_screenshot',settings.kb_screenshot, takeScreenshot);
  registerUpdateShortcut('kb_worldMap',settings.kb_worldMap, createMapWindow);
  registerUpdateShortcut('kb_refresh',settings.kb_refresh, () => {
    mainWindow.loadURL(mainWindow.webContents.getURL());
  });
  registerUpdateShortcut('kb_quickLogin',settings.kb_quickLogin, () => {
    if(accounts.lastLogin && accounts[accounts.lastLogin] && loginStatus==false){
      sendClientLogin(accounts.lastLogin, accounts[accounts.lastLogin])
    }
  });

}

function createMapWindow() {
  
  if (mapWindow) {
    mapWindow.close()
    return;
  }

  mainWindow.webContents.send('client-message', {statusMessage: `Opening world map...`, timeout: 2000});

  mapWindow = new BrowserWindow({
      title: 'World Map',
      width: 650,
      height: 542,
      parent: mainWindow,
      resizable: false,
      minimizable: false,
      maximizable: false,
      menuBarVisible: false,
      backgroundColor: '#000000',
      modal: false,
      show: true,
      webPreferences: {
          preload: path.join(__dirname, 'preload-map.js'),
          contextIsolation: false
      }
  });

  mapWindow.loadURL('https://2004.lostcity.rs/worldmap');
  mapWindow.setMenu(null);

  mapWindow.on('closed', () => {
      mapWindow = null;
  });

  mapWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
}

app.whenReady().then(() => {
  
  //load stored data and set defaults
  accounts = storage.getSync('savedAccounts');
  settings = {...settingDefaults, ...storage.getSync('savedSettings')};
  storage.set('savedSettings', settings, (error) => {
    if (error) throw error;
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('browser-window-focus', () => {
  if(!settingsOpen) restoreAllBindings()
});

app.on('browser-window-blur', () => {
  if(!settingsOpen) globalShortcut.unregisterAll()
});

function registerUpdateShortcut(name, accelerator, callback){
  if(accelerator && accelerator.length && globalShortcut.isRegistered(accelerator)){
    //already taken
  }else{
    if(registeredShortcuts[name] && registeredShortcuts[name].accelerator) globalShortcut.unregister(registeredShortcuts[name].accelerator);

    callback = callback || registeredShortcuts[name].callback;
    accelerator = accelerator || (accelerator==''?'':registeredShortcuts[name].accelerator);

    if(accelerator.length){ //if accelerator blank, unregister previous but dont register the blank shortcut
      let r = globalShortcut.register(accelerator, callback);
      if(!r) console.log(`error registering shortcut '${name}' to '${accelerator}'`);
      else registeredShortcuts[name] = {callback, accelerator};
    } else registeredShortcuts[name] = {callback, accelerator};
  }
}

function restoreAllBindings(){
  Object.keys(registeredShortcuts).forEach((binding) => {
    registerUpdateShortcut(binding, settings[binding])
  })
}

function openSettingsPrompt(){
  settingsOpen = true;
  settings = storage.getSync('savedSettings');

  //disable keybinds while settings open
  globalShortcut.unregisterAll();

  //need to register PrintScreen globally while bindings window is open so that we can use it on windows, theres probably a better way to do this
  let allPSlol = ['PrintScreen','CommandOrControl+PrintScreen','Shift+PrintScreen','Alt+PrintScreen','CommandOrControl+Shift+PrintScreen','CommandOrControl+Alt+PrintScreen','CommandOrControl+Shift+Alt+PrintScreen','Shift+Alt+PrintScreen'];
  globalShortcut.registerAll(allPSlol, () => {
    BrowserWindow.getFocusedWindow().webContents.send('force-event', 'PrintScreen');
  });

  globalShortcut.register('Ctrl+Shift+I', () => {
    BrowserWindow.getFocusedWindow().webContents.openDevTools()
  })

  Prompt({
    title: 'Entrana Settings',
    label: '',
    icon: './icon.ico',
    buttonLabels:{ok:'Save Settings', cancel:'Cancel'},
    width: 800,
    height: 500,
    menuBarVisible: false,
    customStylesheet: path.join(__dirname, 'prompt.css'),
    customScript: path.join(__dirname, 'prompt-settings.js'),
    type: 'multiInput',
    multiInputOptions: [{
      label: 'Game Music Volume',
      value: settings.vol_music,
      inputAttrs: {
        type: 'range',
        name: 'vol_music',
        'data-suffix': '%'
      }
    },{
      label: 'Game Effects Volume',
      value: settings.vol_sfx,
      inputAttrs: {
        type: 'range',
        name: 'vol_sfx',
        'data-suffix': '%'
      }
    },{
      label: 'Entrana Warnings Volume',
      value: settings.vol_entrana,
      inputAttrs: {
        type: 'range',
        name: 'vol_entrana',
        'data-suffix': '%'
      }
    },{
      label: 'Idle Warning Threshold',
      value: settings.idleTimerThreshold,
      inputAttrs: {
        type: 'range',
        name: 'idleTimerThreshold',
        min: 0,
        max: 89,
        'data-suffix': 'sec'
      }
    },{
      label: 'Latency Spike Threshold',
      inputAttrs: {
        type: 'range',
        name: 'latencyWarningThreshold',
        min: 25,
        max: 500,
        step: 25,
        'data-value': settings.latencyWarningThreshold,
        'data-suffix': '% ms',
        'data-prefix': '+'
      }
    },{
      label: 'Screenshot Save Directory',
      value: settings.screenshotsPath,
      inputAttrs: {
        type: 'directoryChoose',
        name: 'screenshotDir'
      }
    },{
      label: 'Screenshot Keybind',
      value: settings.kb_screenshot,
      inputAttrs: {
        type: 'keybind',
        name: 'kb_screenshot'
      }
    },{
      label: 'Quick Login Keybind',
      value: settings.kb_quickLogin,
      inputAttrs: {
        type: 'keybind',
        name: 'kb_quickLogin'
      }
    },{
      label: 'World Map Keybind',
      value: settings.kb_worldMap,
      inputAttrs: {
        type: 'keybind',
        name: 'kb_worldMap'
      }
    },{
      label: 'Reload Client Keybind',
      value: settings.kb_refresh,
      inputAttrs: {
        type: 'keybind',
        name: 'kb_refresh'
      }
    }]
  },mainWindow)
  .then((r) => {
    settingsOpen = false;

    //unregister all those PrintScreen globals again
    globalShortcut.unregisterAll();

    //update bindings and restore
    if(r === null) restoreAllBindings();
    else {
      settings = {...settings, ...{
        vol_music: r[0],
        vol_sfx: r[1],
        vol_entrana: r[2],
        idleTimerThreshold: r[3],
        latencyWarningThreshold: r[4],
        screenshotsPath: r[5],
        kb_screenshot: r[6].replaceAll( ' ', '' ),
        kb_quickLogin: r[7].replaceAll( ' ', '' ),
        kb_worldMap: r[8].replaceAll( ' ', '' ),
        kb_refresh: r[9].replaceAll( ' ', '' )
      }};

      storage.set('savedSettings', settings, (error) => {
        if (error) throw error;
        restoreAllBindings();
        mainWindow.webContents.send('client-message', {...settings, statusMessage: `Bindings updated...`, timeout: 1000});
        createAppMenu();
      });        
    }
  }).catch(console.error);
}

function med(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) /2;
}

async function fetchWorlds(worlds) {
  if(lastWorldUpdate && Date.now() - lastWorldUpdate < 5000) return worlds;
  lastWorldUpdate = Date.now();
  try {
    const res = await fetch('https://2004.losthq.rs/pages/api/worlds.php');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const worldsData = await res.json();

    //get latency for all worlds
    for(let server of worldsData){
      server.ms = performance.now();
      await fetch(settings.lowMem?server.ld:server.hd, { method: 'HEAD', cache: 'no-store', mode: 'no-cors' });
      server.ms = Math.ceil(performance.now() - server.ms);
    }
    
    //compare current world ping to history to determine spike
    const currentWorldPing = worldsData.find(s => s.world == settings.world).ms;
    let spike = false;
    if(settings.latencyWarning !== false){
      const max_history = 20;
      if(pingHistory.length >= max_history/2){
        const baseline = med(pingHistory);
        const percentDiff = ((currentWorldPing - baseline) / baseline) * 100;
        if(percentDiff > parseInt(settings.latencyWarningThreshold)) spike = true;
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

//get current version
async function fetchPKG() {
  if(pkg.lastcall && Date.now() - pkg.lastcall < (1000*60*10)) return pkg;
  pkg.lastcall = Date.now();
  let res = await fetch('https://raw.githubusercontent.com/Slaying-dev/Entrana-Launcher/master/package.json')
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  data.lastcall = pkg.lastcall;
  return data
}

//shows username/password prompt for adding/updating accounts, then calls updateAccount to save changes
function addUpdateAccountPrompt(username) {
  Prompt({
    title: username?'Update Account':'Add Account',
    label: '',
    icon: './icon.ico',
    buttonLabels:{ok:username?'Update Account':'Add Account', cancel:'Cancel'},
    width: 400,
    height: 260,
    menuBarVisible: false,
    customStylesheet: path.join(__dirname, 'prompt.css'),
    customScript: path.join(__dirname, 'prompt-account.js'),
    type: 'multiInput',
    multiInputOptions: [{
      label: 'Username',
      value: username || '',
      inputAttrs: {
        type: 'text',
        required: true,
        placeholder: 'Username',
        class: 'username-field'
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
      else updateAccount(r[0], r[1])
  }).catch(console.error);
}

//create/update/delete account & store encrypted password, then update menu
function updateAccount(username, password, deleteOnly = false) {
  let accounts = storage.getSync('savedAccounts');
  let exists = accounts[username] !== undefined;
  if(exists) delete accounts[username];

  if(!deleteOnly){
    const encryptedBuffer = safeStorage.encryptString(password);
    const encryptedPassword = encryptedBuffer.toString('latin1'); 
    accounts[username] = encryptedPassword;
  }

  storage.set('savedAccounts', accounts, (error) => {
    if (error) throw error;
    createAppMenu();
    mainWindow.webContents.send('client-message', {statusMessage: `Account ${username} ${deleteOnly?'removed':(exists?'updated':'added')}...`});
  });
}

//decrypt password and send to client
function sendClientLogin(username, encryptedPassword) {
  const bufferToDecrypt = Buffer.from(encryptedPassword, 'latin1');
  const decryptedPassword = safeStorage.decryptString(bufferToDecrypt);
  mainWindow.webContents.send('client-login', { username, decryptedPassword });
  accounts.lastLogin = username;

  storage.set('savedAccounts', accounts, (error) => {
    if (error) throw error;
    createAppMenu();
  });
}

//capture screenshot of mainWindow
function takeScreenshot(data){
  mainWindow.webContents.capturePage().then(image => {
    if (!fs.existsSync(settings.screenshotsPath)) fs.mkdirSync(settings.screenshotsPath);

    let savePath = path.join(settings.screenshotsPath, `screenshot-${Date.now()}.png`);
    if(data && data.category && !fs.existsSync(path.join(settings.screenshotsPath, data.category))) fs.mkdirSync(path.join(settings.screenshotsPath, data.category));
    if(data && data.category) savePath = path.join(settings.screenshotsPath, data.category, `screenshot-${Date.now()}.png`);
    if(data && data.category && data.skill) savePath = path.join(settings.screenshotsPath, data.category, `screenshot-${data.skill.replaceAll(' ','')}-${Date.now()}.png`);

    fs.writeFile(savePath, image.toPNG(), (err) => {
      if (err) throw err
      mainWindow.webContents.send('client-message', {'playScreenshotAudio': true});
      mainWindow.webContents.send('client-message', {statusMessage: `Screenshot saved!`, timeout: 2000});
    })
  })
}

//build menu
async function createAppMenu() {
  worlds = await fetchWorlds(worlds);
  pkg = await fetchPKG();
  settings = storage.getSync('savedSettings');
  accounts = storage.getSync('savedAccounts');

  let worldMenu = [{label: "Players Online: " + worlds.reduce((sum, w) => sum + w.count, 0), disabled: true},...worlds.map(world => ({
    label: `World ${world.world} ${world.location} - ${world.ms}ms - ${world.p2p? 'P2P' : 'F2P'} - ${world.count} players`,
    type: 'radio',
    checked: world.world === settings.world,
    click: () => {
      createAppMenu();

      function doWorldChange(){
        settings.world = world.world;
        storage.set('savedSettings', settings, (error) => {
          if (error) throw error;
          mainWindow.webContents.send('client-message', {statusMessage: `Switching to World ${world.world}...`});
          mainWindow.loadURL(settings.lowMem?world.ld:world.hd);
          mainWindow.title = defaultTitle + `  |  World ${world.world} ${world.location}`;
          createAppMenu();
          pingHistory = [];
        });
      }

      if(loginStatus == true){
        Prompt({...warningDefaults,
          description : 'You are currently logged in! Changing worlds now will not log you out and your character will be in game for 60 seconds. Are you sure you want to continue?'
        },mainWindow)
        .then((r) => {
            if(r !== null) doWorldChange()
        }).catch(console.error);
      }else doWorldChange()
    }
  }))];

  function detailSwitch(lm){
    createAppMenu();

    function doChangeMem(lm){
      settings.lowMem = lm===1?true:false;
      storage.set('savedSettings', settings, (error) => {
        if (error) throw error;
        mainWindow.webContents.send('client-message', {statusMessage: `Switching to ${lm===1?'Low':'High'} Detail...`});
        mainWindow.loadURL(mainWindow.webContents.getURL().replace(/lowmem=(\d)/, `lowmem=${lm}`));
        createAppMenu();
        pingHistory = [];
      });
    }

    if(loginStatus == true){
      Prompt({...warningDefaults,
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
      click: () => addUpdateAccountPrompt()
    },
    {
      label: 'Manage Accounts',
      submenu: Object.keys(accounts).filter((u)=>u!=='lastLogin').map((username) => ({
        label: username,
        submenu: [
        { label: 'Update Account', click: () => addUpdateAccountPrompt( username) },
        { label: 'Remove Account', click: () => updateAccount(username, null, true) }
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
        let lastLogin = accounts.lastLogin && accounts[accounts.lastLogin] ? [{
          label: `Quick Login: \n${accounts.lastLogin}`,
          accelerator: settings.kb_quickLogin,
          click: () => sendClientLogin(accounts.lastLogin, accounts[accounts.lastLogin])
        },{type: 'separator'}] : [];

        return [...lastLogin, ...Object.entries(accounts).filter(([u])=>u!=='lastLogin').map(([username, encryptedPassword]) => ({
          label: username,
          click: () => sendClientLogin(username, encryptedPassword)
        }))];
      }
    })()
  ];

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
          { label: 'Low Detail', type: 'radio', checked: settings.lowMem, click: () => detailSwitch(1)},
          { label: 'High Detail', type: 'radio', checked: !settings.lowMem, click: () => detailSwitch(0)}
        ]},
        { label: 'Login Screen Music', submenu:[
          { label: 'Off', value: false },
          { label: 'On', value: true }
        ].map(option => ({
            label: option.label,
            type: 'radio',
            checked: settings.loginMusic === option.value,
            click: () => {
              settings.loginMusic = option.value;

              storage.set('savedSettings', settings, (error) => {
                if (error) throw error;
                mainWindow.webContents.send('client-message', settings);
                createAppMenu();
              });
            }
        }))},
        { label: 'Idle Timer', submenu:[
          { label: 'Off', value: false },
          { label: 'On', value: true }
        ].map(option => ({
            label: option.label,
            type: 'radio',
            checked: settings.idleTimer === option.value,
            click: () => {
              settings.idleTimer = option.value;

              storage.set('savedSettings', settings, (error) => {
                if (error) throw error;
                mainWindow.webContents.send('client-message', settings);
                createAppMenu();
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
          checked: settings.sessionTimer === option.value,
          click: () => {
            settings.sessionTimer = option.value;

            storage.set('savedSettings', settings, (error) => {
              if (error) throw error;
              mainWindow.webContents.send('client-message', settings);
            });
          }
        }))},
        { label: 'Latency Spike Warnings', submenu:[
          { label: 'Off', value: false },
          { label: 'On', value: true }
        ].map(option => ({
            label: option.label,
            type: 'radio',
            checked: settings.latencyWarning === option.value,
            click: () => {
              settings.latencyWarning = option.value;

              storage.set('savedSettings', settings, (error) => {
                if (error) throw error;
                mainWindow.webContents.send('client-message', settings);
                createAppMenu();
              });
            }
        }))},
      {
        label: 'Auto-Screenshots',
        submenu: [...Object.entries(settings).filter(([key]) => key.startsWith('ssc_')).map(([key,value]) => {
          let labels = {'level':'Level Ups','treasure':'Treasure Trail Complete','quest':'Quest Complete','death':'Deaths'}
          return {
            label: labels[key.split('_')[1]],
            type: 'checkbox',
            checked: settings[key],
            click: (item) => {
              settings[key] = item.checked;

              storage.set('savedSettings', settings, (error) => {
                if (error) throw error;
              });
            }
          }
        })]
      },
      {
        type: 'separator'
      },{
        label: 'Settings',
        click: () => openSettingsPrompt()
      }]
    },
    {
      label: 'World Select',
      id: 'world-select',
      submenu: worlds.length ? worldMenu : [{label: 'No world data found...', disabled: true}]
    },
    {
      label: 'Accounts',
      id: 'accounts',
      submenu: accountsMenu
    },
    {
      label: 'Take Screenshot',
      accelerator: settings.kb_screenshot,
      click: () => takeScreenshot()
    },
    {
      label: 'View',
      submenu: [
        { label: 'Open World Map', accelerator: settings.kb_worldMap, click: () => createMapWindow() },
        { label: 'Open Screenshots Folder', click: () => { shell.openPath(settings.screenshotsPath); } },
        { label: 'Open Settings/Logs Folder', click: () => { shell.openPath(storagePath); } },
        { label: 'Open Dev Tools', role: 'toggleDevTools', accelerator: '' },
        { label: 'Reload Client', accelerator: settings.kb_refresh, click: () => mainWindow.loadURL(mainWindow.webContents.getURL())},
        { type:  'separator' },
        { label: 'Lost City Website', click: () => { shell.openExternal('https://2004.lostcity.rs/'); } },
        { label: 'Project Github', click: () => { shell.openExternal('https://github.com/Slaying-dev/Entrana-Launcher'); } },
        { type:  'separator' },
        { label: 'Version ' + app.getVersion(), enabled: false },
        ...(()=>{
          if(app.getVersion() !== pkg.version) return [{
            label: `Version ${pkg.version} available!`,
            click: () => { shell.openExternal('https://github.com/Slaying-dev/Entrana-Launcher/releases/latest'); }
          }]; else return []
        })()
      ]
    }
  ];
  
  mainWindow.setMenu(Menu.buildFromTemplate(template));
  mainWindow.title = defaultTitle + `  |  World ${settings.world} ${worlds.length?worlds.find(w=>w.world === settings.world).location:''}`;
};