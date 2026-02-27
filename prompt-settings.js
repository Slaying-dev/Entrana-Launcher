const { ipcRenderer } = require('electron');
const Binding = require('./node_modules/electron-plugin-prompts/lib/page/keybind');

module.exports = () => {
    
    //this whole thing is basically to fix a janky prompt library that i should have just not used for the settings
    //the keybind lib they have works well though so its fine we make due

    //fix janky prompt library that uses non unique ids...
    document.querySelector('#buttons').classList.add('buttons')

    //run through inputs and replace keybind type inputs with the keybind lib fields
    let container = document.querySelector('#data-container');
    let splitContainer1 = document.createElement('div');
    let splitContainer2 = document.createElement('div');
    container.before(splitContainer1,splitContainer2);

    [...container.querySelectorAll('input[type="keybind"]')].forEach(el => {
        let kb_container = document.createElement('div');
        el.before(kb_container);

        Binding([{ value: el.name, label: el.name, default: el.value }], kb_container);
        el.remove()
    });

    [...document.querySelectorAll('input[readonly]')].forEach(el=>{
        el.id = 'data';
        el.classList.add('bind-input')

        //if another binding is the same, it removes the conflict and flashes red
        el.addEventListener('keydown', (e) => {
            let conflict = [...document.querySelectorAll('input[readonly]')].find(bind => bind !== el && bind.value == el.value);
            if(conflict){
                conflict.value = '';
                conflict.classList.add('has-conflict')
                setTimeout(() => conflict.classList.remove('has-conflict'), 750)
            }
        })
    });

    //this is only currently used for PrintScreen events because windows disables it as a binding
    ipcRenderer.on('force-event', function (event, key) {
        let el = document.activeElement;
        if(el && el.classList.contains('bind-input')){
            const forcedEvent = new KeyboardEvent('keydown', {
                key: key,
                code: key
            });

            el.dispatchEvent(forcedEvent);
        }
    });

    //reformat clear buttons to be times X and add title for clarification
    [...document.querySelectorAll('.btn-clear')].forEach(el=>{
        el.textContent = '×';
        el.title = 'Clear keybind'
    });

    //remove keybind libs labels and use our own
    [...document.querySelectorAll('.keybindLabel')].forEach(el=>el.remove());


    //setup directory prompt ui
    [...container.querySelectorAll('input[type="directoryChoose"]')].forEach(el => {
        el.setAttribute( 'readonly', true );
        let dir_container = document.createElement('div');
        dir_container.classList.add('dir-container');
        el.before(dir_container);
        dir_container.append(el);

        let browse = document.createElement( 'button' );
        browse.classList.add('btn-browse');
        browse.textContent = '...';
        browse.title = 'Choose a directory';
        dir_container.append(browse);

        browse.addEventListener('click', (e) => {
            e.preventDefault();
            ipcRenderer.send('prompt-for-directory', {name: el.name, current: el.value});
        })
    });

    //set values of returned directory after chosen
    ipcRenderer.on('update-directory', function (event, directoryData) {
        if(directoryData.dir !== false){
            container.querySelector(`input[name='${directoryData.name}']`).value = directoryData.dir;
        }
    });

    //split settings into 2 columns
    let children = document.querySelectorAll('#data-container > *');
    splitContainer2.append(...[...children].slice(-10));
    children = document.querySelectorAll('#data-container > *');
    splitContainer1.append(...children);
    container.append(splitContainer1,splitContainer2);


    //range input label updates
    [...container.querySelectorAll('input[type=range]')].forEach(el => {
        if(el.dataset.value) el.value = el.dataset.value; //fix for >100 values, not sure why this isnt working

        function setLabel(t){
            t.previousElementSibling.textContent = `${t.previousElementSibling.textContent.split(' - ')[0]} - ${t.dataset.prefix||''}${t.value}${t.dataset.suffix||''}`
        }

        el.addEventListener('input', (e) => {
            setLabel(e.target);

            //we want to update the client with the new volume settings before actually closing the settings window
            //so you can actually hear the volume change in real time
            if(e.target.name.startsWith('vol_')){
                ipcRenderer.send('volume-change', {name: e.target.name, value: parseInt(e.target.value)}); 
            }
        });
        setLabel(el);
    });

};