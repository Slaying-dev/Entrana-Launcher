//add map MapView global
const observer = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(addedNode) {
        if(addedNode.nodeName === 'HEAD'){
            //hide scrollbars
            const style = document.createElement('style');
            style.textContent = `
                html, body {
                    height: 100%;
                    margin: 0;
                    overflow: hidden !important;
                    background: #000
                }
            `;
            document.head.appendChild(style);
        }

        if(addedNode.innerText && addedNode.innerText.includes('MapView')) {
        addedNode.innerText = addedNode.innerText.replace('new MapView(','window.LCMapView = new MapView({shouldDrawMultimap:true}').replace(/[\r\n]/g, '');
        observer.disconnect();
        }
    });
  });
});
observer.observe(document, { childList: true, subtree: true });

window.addEventListener('DOMContentLoaded', () => {
    //isolate canvas
    let canvas = document.querySelector('canvas');
    let table = document.querySelector('table');
    table.before(canvas);
    table.remove();

    //add scroll wheel zoom
    let zoomLevel = [3,4,6,8], zoom = 1;
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoom = Math.min(zoomLevel.length - 1,Math.max(0, zoom + (e.deltaY < 0 ? 1 : -1)))
        window.LCMapView.targetZoom = zoomLevel[zoom]
    }, { passive: false });
});