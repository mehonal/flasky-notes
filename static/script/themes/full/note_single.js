// Full Theme — Modernized JS with AJAX save, marked.js, search

var title = document.getElementById('title');
var content = document.getElementById('content');
var contentMarkdown = document.getElementById('content-markdown');
var menuOverlay = document.getElementById('menu-overlay');
var menuToggle = document.getElementById('menu-toggle');
var categoriesInput = document.getElementById('categories-input');
var category = document.getElementById('category');
var noteIdEl = document.getElementById('note-id');
var noteId = noteIdEl ? parseInt(noteIdEl.value) : 0;
var darkModeOn = false;
var titleVisible = true;
var markdownVisible = false;

// Toast notification
function fullToast(msg, type) {
    var el = document.getElementById('fullToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'fullToast';
        el.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 20px;border-radius:8px;color:#fff;font-size:14px;z-index:10000;opacity:0;transition:opacity 0.3s;pointer-events:none;';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = type === 'error' ? '#f38ba8' : '#a6e3a1';
    el.style.color = type === 'error' ? '#fff' : '#1c1c1e';
    el.style.opacity = '1';
    setTimeout(function() { el.style.opacity = '0'; }, 2500);
}

function toggleMenu(){
    menuOverlay.style.display = menuOverlay.style.display === "flex" ? "none" : "flex";
}

// AJAX save
function saveNote(){
    syncCategory();
    fetch('/api/save_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            noteId: noteId,
            title: title.value,
            content: content.value,
            category: category.value
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success) {
            if (noteId === 0 && data.note && data.note.id) {
                noteId = data.note.id;
                noteIdEl.value = noteId;
                window.history.replaceState(null, '', '/note/' + noteId);
            }
        } else {
            fullToast('Save failed: ' + (data.reason || 'Unknown error'), 'error');
        }
    })
    .catch(function() { fullToast('Network error during save', 'error'); });
}

function toggleTitle(){
    if (titleVisible){
        title.style.display = "none";
        content.style.height = (innerWidth > 600) ? "calc(100vh - 50px)" :  "calc(100vh - 76px)";
        contentMarkdown.style.height = (innerWidth > 600) ? "calc(100vh - 50px)" :  "calc(100vh - 76px)";
    }
    else{
        title.style.display = "block";
        content.style.height = (innerWidth > 600) ? "calc(90vh - 50px)" :  "calc(90vh - 76px)";
        contentMarkdown.style.height = (innerWidth > 600) ? "calc(90vh - 50px)" :  "calc(90vh - 76px)";
    }
    titleVisible = !titleVisible;
}

function increaseFontSize(){
    var newFontSize = (parseInt(content.style.fontSize) + 1);
    content.style.fontSize = newFontSize + "px";
    fetch('/api/save_font_size/' + newFontSize).then(function(r) { return r.json(); });
}

function decreaseFontSize(){
    var newFontSize = (parseInt(content.style.fontSize) - 1);
    content.style.fontSize = newFontSize + "px";
    fetch('/api/save_font_size/' + newFontSize).then(function(r) { return r.json(); });
}

function navigateToNotes(){
    window.location.href = "/notes";
}

function navigateToCategories(){
    window.location.href = "/categories";
}

function addNewNote(){
    window.location.href = "/note/0";
}

function navigateToSettings(){
    window.location.href = "/settings";
}

// Markdown toggle using marked.js
function toggleMarkdown(){
    markdownVisible = !markdownVisible;
    if (markdownVisible){
        var html = marked(content.value);
        html = FlaskyMarkdown.processCallouts(html);
        if (typeof resolveWikiLinks === 'function') html = resolveWikiLinks(html);
        contentMarkdown.innerHTML = html;
        hljs.highlightAll();
        content.style.display = "none";
        contentMarkdown.style.display = "block";
    } else {
        content.style.display = "block";
        contentMarkdown.style.display = "none";
    }
}

function toggleDarkMode(){
    darkModeOn = !darkModeOn;
    document.body.classList.toggle('dark-mode', darkModeOn);
    fetch('/api/save_dark_mode/' + (darkModeOn ? 1 : 0)).then(function(r) { return r.json(); });
}

function deleteNote(){
    if (window.confirm("Are you sure you want to delete this note?")){
        fetch('/api/delete_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId: noteId })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) window.location.href = '/notes';
            else fullToast(data.reason || 'Delete failed', 'error');
        })
        .catch(function() { fullToast('Network error', 'error'); });
    }
}

function revertNote(){
    if (!window.confirm("Are you sure you want to revert to the last version?")) return;
    fetch('/api/revert_note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: noteId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.success && data.note) {
            content.value = data.note.content || '';
            if (markdownVisible) toggleMarkdown();
        } else {
            fullToast(data.reason || 'Revert failed', 'error');
        }
    })
    .catch(function() { fullToast('Network error during revert', 'error'); });
}

function changeFont(){
    var newFont = document.getElementById('font-select').value;
    updateFont(newFont);
    fetch('/api/save_font', {method: 'POST', body: newFont});
}

function updateFont(newFont){
    content.style.fontFamily = newFont;
    contentMarkdown.style.fontFamily = newFont;
}

function syncCategory(){
    category.value = categoriesInput.value;
}

document.addEventListener('keydown', function(e){
    if (e.ctrlKey && e.key === "s"){
        e.preventDefault();
        saveNote();
    }
    else if (e.ctrlKey && e.key === "k"){
        e.preventDefault();
        FlaskySearch.open();
    }
    else if (e.ctrlKey && e.key === "l"){
        e.preventDefault();
        toggleTitle();
    }
    else if (e.ctrlKey && e.key === "m"){
        e.preventDefault();
        toggleMenu();
    }
    else if (e.ctrlKey && e.key === "ArrowUp"){
        e.preventDefault();
        increaseFontSize();
    }
    else if (e.ctrlKey && e.key === "ArrowDown"){
        e.preventDefault();
        decreaseFontSize();
    }
    else if (e.ctrlKey && e.key === "e"){
        e.preventDefault();
        navigateToNotes();
    }
    else if (e.ctrlKey && e.key === "d"){
        e.preventDefault();
        deleteNote();
    }
    else if (e.ctrlKey && e.key === "y"){
        e.preventDefault();
        navigateToSettings();
    }
    else if (e.ctrlKey && e.key === ","){
        e.preventDefault();
        toggleMarkdown();
    }
    else if (e.ctrlKey && e.key === " "){
        e.preventDefault();
        toggleDarkMode();
    }
    else if (e.ctrlKey && e.key === "Enter"){
        e.preventDefault();
        addNewNote();
    }
    else if (e.ctrlKey && e.key === "Delete"){
        e.preventDefault();
        revertNote();
    }
});
