module.exports = () => {
    //add note about password storage
    let note = document.createElement('div');
    note.id = 'note';
    note.innerText = 'Note: Account information is stored locally on your machine and encrypted, but use at your own risk.';
    document.querySelector('#data-container').appendChild(note);

    //focus first empty input
    [...document.querySelectorAll('input')].find(input => input.type != 'hidden' && input.value == '').focus();
};