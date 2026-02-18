const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('node:path')
const os = require('os');
const fs = require('fs');
const storage = require('electron-json-storage');
const windowStateKeeper = require('electron-window-state');

storage.setDataPath(os.tmpdir());
let screenshots = path.join(os.tmpdir(), 'EntranaScreenshots');
if (!fs.existsSync(screenshots)){
    fs.mkdirSync(screenshots);
}

const defaultTitle = "Entrana  |  Lost City Launcher";
let worlds = [], loginStatus = false;

let currentWorld = storage.getSync('savedWorld');
currentWorld = Object.keys(currentWorld).length ? currentWorld : '2';
storage.set('savedWorld', currentWorld);

let lowMem = storage.getSync('savedLowMem');
lowMem = Object.keys(lowMem).length ? lowMem : {value: false};
storage.set('savedLowMem', lowMem);

let idleTimer = storage.getSync('savedIdleTimer');
idleTimer = Object.keys(idleTimer).length ? idleTimer : {value: 10};
storage.set('savedIdleTimer', idleTimer);

let sessionTimer = storage.getSync('savedSessionTimer');
sessionTimer = Object.keys(sessionTimer).length ? sessionTimer : {value: 'time'};
storage.set('savedSessionTimer', sessionTimer);

function createWindow () {

  let mainWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 580
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
  let refreshMenuInterval = setInterval(() => {
    createAppMenu(mainWindow);
  }, 10 * 1000);

  ipcMain.on('resize-to-client', (event, windowHeight, canvasHeight) => {
    var size = mainWindow.getSize();
    let offset_win = windowHeight - canvasHeight;
    mainWindow.setSize(size[0], size[1]-offset_win);
  });

  ipcMain.on('send-stored-values', (event) => {
    mainWindow.webContents.send('client-message', {'IdleTimer': idleTimer.value});
    mainWindow.webContents.send('client-message', {'SessionTimer': sessionTimer.value});
  });

  ipcMain.on('client-logged-in', (event, loggedIn) => {
    loginStatus = loggedIn;
  });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  mainWindow.on('close', function(e){
    if(loginStatus == true){
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Continue'],
        defaultId: 0,
        cancelId: 0,
        title: 'Warning',
        noLink: true,
        message: 'You are currently logged in. Closing the client will not log you out for 60 seconds. Are you sure you want to continue?'
      });
      if (choice === 0) e.preventDefault();
    }
  });

}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

async function fetchWorlds() {
  try {
    const res = await fetch('https://2004.losthq.rs/pages/api/worlds.php');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch worlds:', err);
    return [];
  }
}

async function createAppMenu(mainWindow) {
  worlds = await fetchWorlds();
  currentWorld = storage.getSync('savedWorld');
  lowMem = storage.getSync('savedLowMem');
  idleTimer = storage.getSync('savedIdleTimer');
  sessionTimer = storage.getSync('savedSessionTimer');

  let worldMenu = [{label: "Players Online: " + worlds.reduce((sum, w) => sum + w.count, 0), disabled: true},...worlds.map(world => ({
    label: `World ${world.world} ${world.location} (${world.p2p? 'P2P' : 'F2P'}) (${world.count} players)`,
    type: 'radio',
    checked: world.world === currentWorld,
    click: () => {
      createAppMenu(mainWindow); // Refresh menu to update checkmarks

      function doWorldChange(){
        currentWorld = world.world;
        storage.set('savedWorld', currentWorld, function(error) {
          if (error) throw error;
        });
        mainWindow.loadURL(lowMem.value?world.ld:world.hd);
        mainWindow.title = defaultTitle + `  |  World ${world.world} ${world.location}`;
      }

      if(loginStatus == true){
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'warning',
          buttons: ['Cancel', 'Continue'],
          defaultId: 0,
          cancelId: 0,
          title: 'Warning',
          noLink: true,
          message: 'You are currently logged in. Changing worlds now will not log you out and your character will be in game for 60 seconds. Are you sure you want to continue?'
        });
        if (choice === 0) return; // Cancelled
        else doWorldChange();
      }else{
        doWorldChange()
      }
    }
  }))];

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
          { label: 'Low Detail', type: 'radio', checked: lowMem.value, click: () => {
            function doChangeMem(){
              lowMem = {value: true};
              storage.set('savedLowMem', lowMem, function(error) {
                if (error) throw error;
              });
              mainWindow.loadURL(mainWindow.webContents.getURL().replace(/lowmem=(\d)/, 'lowmem=1'));
            }

            if(loginStatus == true){
              const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'warning',
                buttons: ['Cancel', 'Continue'],
                defaultId: 0,
                cancelId: 0,
                title: 'Warning',
                noLink: true,
                message: 'You are currently logged in. Changing client detail now will not log you out and your character will be in game for 60 seconds. Are you sure you want to continue?'
              });
              if (choice === 0) return; // Cancelled
              else doChangeMem();
            }else{
              doChangeMem()
            }
          } },
          { label: 'High Detail', type: 'radio', checked: !lowMem.value, click: () => {
            function doChangeMem(){
              lowMem = {value: false};
              storage.set('savedLowMem', lowMem, function(error) {
                if (error) throw error;
              });
              mainWindow.loadURL(mainWindow.webContents.getURL().replace(/lowmem=(\d)/, 'lowmem=0'));
            }
            if(loginStatus == true){
              const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'warning',
                buttons: ['Cancel', 'Continue'],
                defaultId: 0,
                cancelId: 0,
                title: 'Warning',
                noLink: true,
                message: 'You are currently logged in. Changing client detail now will not log you out and your character will be in game for 60 seconds. Are you sure you want to continue?'
              });
              if (choice === 0) return; // Cancelled
              else doChangeMem();
            }else{
              doChangeMem()
            }
          }}
        ]},
        { label: 'Idle Timer', submenu:[
          { label: 'Off', type: 'radio', checked: idleTimer.value === false, click: () => {
            idleTimer = {value: false};
            storage.set('savedIdleTimer', idleTimer, function(error) {
              if (error) throw error;
            });
            mainWindow.webContents.send('client-message', {'IdleTimer': false});
          }},
          { label: 'No Warning', type: 'radio', checked: idleTimer.value === 0, click: () => {
            idleTimer = {value: 0};
            storage.set('savedIdleTimer', idleTimer, function(error) {
              if (error) throw error;
            });
            mainWindow.webContents.send('client-message', {'IdleTimer': 0});
          }},
          { label: '5s Warning', type: 'radio', checked: idleTimer.value === 5, click: () => {
            idleTimer = {value: 5};
            storage.set('savedIdleTimer', idleTimer, function(error) {
              if (error) throw error;
            });
            mainWindow.webContents.send('client-message', {'IdleTimer': 5});
          }},
          { label: '10s Warning', type: 'radio', checked: idleTimer.value === 10, click: () => {
            idleTimer = {value: 10};
            storage.set('savedIdleTimer', idleTimer, function(error) {
              if (error) throw error;
            });
            mainWindow.webContents.send('client-message', {'IdleTimer': 10});
          }}
        ]},
        { label: 'Session Timer', submenu:[
          { label: 'Off', type: 'radio', checked: sessionTimer.value === false, click: () => {
            sessionTimer = {value: false};
            storage.set('savedSessionTimer', sessionTimer, function(error) {
              if (error) throw error;
            });
            mainWindow.webContents.send('client-message', {'SessionTimer': false});
          }},
          { label: 'Game Ticks', type: 'radio', checked: sessionTimer.value === 'ticks', click: () => {
            sessionTimer = {value: 'ticks'};
            storage.set('savedSessionTimer', sessionTimer, function(error) {
              if (error) throw error;
            });
            mainWindow.webContents.send('client-message', {'SessionTimer': 'ticks'});
          }},
          { label: 'Login Timer', type: 'radio', checked: sessionTimer.value === 'time', click: () => {
            sessionTimer = {value: 'time'};
            storage.set('savedSessionTimer', sessionTimer, function(error) {
              if (error) throw error;
            });
            mainWindow.webContents.send('client-message', {'SessionTimer': 'time'});
          }}
        ]}
      ]
    },
    {
      label: 'World Select',
      id: 'world-select',
      submenu: worldMenu
    },
    {
      label: 'Take Screenshot',
      click: () => {
        mainWindow.webContents.capturePage().then(image => {
          fs.writeFile(path.join(screenshots, `screenshot-${Date.now()}.png`), image.toPNG(), (err) => {
            if (err) throw err
            mainWindow.webContents.send('client-message', {'screenshotPlayer': true});
          })
        })
      }
    },
    {
      label: 'View',
      submenu: [
        { label: 'Github', click: () => { shell.openExternal('https://github.com/Slaying-dev/Entrana-Launcher'); } },
        { label: 'Open Screenshots Folder', click: () => { shell.openPath(screenshots); } },
        { label: 'Open Dev Tools', role: 'toggleDevTools', accelerator: '' }
      ]
    }
  ];
  
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  mainWindow.title = defaultTitle + `  |  World ${currentWorld} ${worlds.find(w=>w.world === currentWorld).location}`;
};



//TODO
//add world map?
//login music toggle?
//store accounts for fast login? not sure if this is allowed and not sure if i wanna deal with the security implications of storing login info even if its encrypted
//clean up the whole damn thing its a mess