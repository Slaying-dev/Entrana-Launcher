window.addEventListener('DOMContentLoaded', () => {
    //isolate canvas
    let canvas = document.querySelector('canvas');
    let table = document.querySelector('table');
    table.before(canvas);
    table.remove();

    //hide scrollbars
    let style = document.createElement('style');
    style.textContent = `
        html, body {
            height: 100%;
            margin: 0;
            overflow: hidden !important;
        }
    `;
    document.head.appendChild(style);
});