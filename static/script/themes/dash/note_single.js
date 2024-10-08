body = document.querySelector('body');
title = document.getElementById('title');
content = document.getElementById('content');
contentMarkdown = document.getElementById('content-markdown');
noteForm = document.getElementById('note-form');
noteSaveBtn = document.getElementById('note-save-btn');
noteDeleteBtn = document.getElementById('note-delete-btn');
noteContent = document.getElementById('note-content');
notes = document.getElementById('notes');
menu = document.getElementById('menu');
notesVisible = true;
darkModeOn = false;
titleVisible = true;

function submitForm(){
    console.log("Submitting form.");
    noteSaveBtn.click();
}

function toggleTitle(){
    if (innerWidth > 600){
        if (titleVisible){
            title.style.display = "none";
            content.style.height = "calc(100vh - 80px)";
            contentMarkdown.style.height = "calc(100vh - 80px)";
        }
        else{
            title.style.display = "block";
            content.style.height = "calc(90vh - 80px)";
            contentMarkdown.style.height = "calc(90vh - 80px)";
        }
    }
    else{
        if (titleVisible){
            title.style.display = "none";
            content.style.height = "calc(100vh - " + (menu.offsetHeight + 40) + "px)";
            contentMarkdown.style.height = "calc(100vh - " + (menu.offsetHeight + 40) + "px)";
        }
        else{
            title.style.display = "block";
            content.style.height = "calc(90vh - " + (menu.offsetHeight + 40) + "px)";
            contentMarkdown.style.height = "calc(90vh - " + (menu.offsetHeight + 40) + "px)";
        }
    }
    titleVisible = !titleVisible;
    console.log("Toggled title");
}

function increaseFontSize(){
    newFontSize = (parseInt(content.style.fontSize) + 1);
    content.style.fontSize =  newFontSize + "px";
    console.log("Increased font size. New font size: " + newFontSize + "px");
    fetch('/api/save_font_size/' + newFontSize)
    .then( response => response.json() )
}

function decreaseFontSize(){
    newFontSize = (parseInt(content.style.fontSize) - 1);
    content.style.fontSize = newFontSize + "px";
    console.log("Decreased font size. New font size: " + newFontSize + "px.");
    fetch('/api/save_font_size/' + newFontSize)
    .then( response => response.json() )
}

function addNewNote(){
    window.location.href = "/note/0/dash";
}

function navigateToSettings(){
    window.location.href = "/settings";
}

function toggleMarkdown(){
    contentMarkdown.innerHTML = "";
    lines = content.value.split("\n");
    lines.forEach(l =>{
        // checking for bold
        arr = l.split("**");
        if (arr.length > 2){
            bold = true;
            newLine = "";
            arr.forEach((el, i) =>{
                bold == false ? newLine += "<b>" + el : newLine += "</b>" + el;
                bold = !bold;
            })
            l = newLine;
        }
        // checking for code
        arr = l.split("`");
        if (arr.length > 2){
            code = true;
            newLine = "";
            arr.forEach((el, i) =>{
                code == false ? newLine += "<span class='code'>" + el : newLine += "</span>" + el;
                code = !code;
            })
            l = newLine;
        }
        if (l.slice(0,6) == "######"){
            contentMarkdown.innerHTML += `<h6>${l.slice(6)}</h6>`;
        }
        else if (l.slice(0,5) == "#####"){
            contentMarkdown.innerHTML += `<h5>${l.slice(5)}</h5>`;
        }   
        else if (l.slice(0,4) == "####"){
            contentMarkdown.innerHTML += `<h4>${l.slice(4)}</h4>`;
        }
        else if (l.slice(0,3) == "###"){
            contentMarkdown.innerHTML += `<h3>${l.slice(3)}</h3>`;
        }
        else if (l.slice(0,2) == "##"){
            contentMarkdown.innerHTML += `<h2>${l.slice(2)}</h2>`;
        }
        else if (l[0] == "#"){
            contentMarkdown.innerHTML += `<h1>${l.slice(1)}</h1>`;
        }
        else if (l[0] == ">"){
            contentMarkdown.innerHTML += `<div class="callout">${l.slice(1)}</div>`;
        }
        else if (l == "---"){
            contentMarkdown.innerHTML += "<hr>";
        }
        else if (l.slice(0,2) == "!["){
            imageLink = l.slice(0,-1).split("(")[1];
            contentMarkdown.innerHTML += `<img src="${imageLink}">`;
        }
        else if (l.slice(0,1) == "["){
            linkText = l.slice(1).split("]")[0];
            linkUrl = l.slice(0,-1).split("]")[1].slice(1);
            contentMarkdown.innerHTML += `<a href="${linkUrl}">${linkText}</a>`;
        }
        else {
            if (l.length != 0) contentMarkdown.innerHTML += `<p>${l}</p>`;
        }
    })

    if (content.style.display == "none"){
        content.style.display = "block";
        contentMarkdown.style.display = "none";
    }
    else{
        content.style.display = "none";
        contentMarkdown.style.display = "block";
    }
}

function toggleDarkMode(){
    if (darkModeOn){
        title.style.backgroundColor = "white";
        title.style.color = "black";
        content.style.backgroundColor = "white";
        content.style.color = "black";
        contentMarkdown.style.backgroundColor = "white";
        contentMarkdown.style.color = "black";
        body.style.backgroundColor = "white";
    }
    else{
        title.style.backgroundColor = "black";
        title.style.color = "white";
        content.style.backgroundColor = "black";
        content.style.color = "white";
        contentMarkdown.style.backgroundColor = "black";
        contentMarkdown.style.color = "white";
        body.style.backgroundColor = "black";
    }
    darkModeOn = !darkModeOn;
    fetch('/api/save_dark_mode/' + (darkModeOn ? 1 : 0))
    .then( response => response.json() )
}

function deleteNote(){
    if (window.confirm("Are you sure you want to delete this note?")){
        noteDeleteBtn.click();
    }
}

function toggleNotes(){
    if (innerWidth > 600){
        if (notesVisible){
            notes.style.display = "none";
            noteContent.style.width = "100vw";
        }
        else{
            notes.style.display = "block";
            noteContent.style.width = "calc(100vw - 200px)";
        }
    }
    else{
        if (notesVisible){
            notes.style.display = "none";
            noteContent.style.width = "100vw";
        }
        else{
            notes.style.display = "block";
            noteContent.style.width = "100vw";
        }
    }
    notesVisible = !notesVisible;
}

document.addEventListener('keydown', e =>{
    if (e.ctrlKey && e.key == "s"){
        e.preventDefault();
        submitForm();
    }
    else if (e.ctrlKey && e.key == "d"){
        e.preventDefault();
        deleteNote();
    }
    else if (e.ctrlKey && e.key == "l"){
        e.preventDefault();
        toggleTitle();
    }
    else if (e.ctrlKey && e.key == "ArrowUp"){
        e.preventDefault();
        increaseFontSize();
    }
    else if (e.ctrlKey && e.key == "ArrowDown"){
        e.preventDefault();
        decreaseFontSize();
    }
    else if (e.ctrlKey && e.key == "e"){
        e.preventDefault();
        addNewNote();
    }
    else if (e.ctrlKey && e.key == "y"){
        e.preventDefault();
        navigateToSettings();
    }
    else if (e.ctrlKey && e.key == ","){
        e.preventDefault();
        toggleMarkdown();
    }
    else if (e.ctrlKey && e.key == " "){
        e.preventDefault();
        toggleDarkMode();
    }
    else if (e.ctrlKey && e.key == "Enter"){
        e.preventDefault();
        toggleNotes();
    }
})

function changeFont(){
    newFont = document.getElementById('font-select').value;
    updateFont(newFont);
    fetch('/api/save_font', {method: 'POST', body: newFont});
}

function updateFont(newFont){
    content.style.fontFamily = newFont;
    noteContent.style.fontFamily = newFont;
    contentMarkdown.style.fontFamily = newFont;
}

function optimizeForMobile(){
    menu.style.position = "fixed";
    noteContent.style.position = "fixed";
    noteContent.style.top = menu.offsetHeight + "px";
    noteContent.style.height = "calc(100vh - " + menu.offsetHeight + "px)";
    content.style.height = "calc(100vh - " + (menu.offsetHeight + title.offsetHeight + 40) + "px)";
}

function initRun(){
    if (innerWidth < 600){
        toggleNotes();
        optimizeForMobile();
    }
}

initRun();
