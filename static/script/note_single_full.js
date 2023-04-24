title = document.getElementById('title');
content = document.getElementById('content');
contentMarkdown = document.getElementById('content-markdown');
noteForm = document.getElementById('note-form');
mobileMenu = document.getElementById('mobile-menu');

function toggleMobileMenu(){
    mobileMenu.style.display == "flex" ? mobileMenu.style.display = "none" : mobileMenu.style.display = "flex";
    console.log("Toggled mobile menu");
}

function submitForm(){
    console.log("Submitting form.");
    noteForm.submit();
}

function toggleTitle(){
    title.style.display == "none" ? title.style.display = "block" : title.style.display = "none";
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

function navigateToNotes(){
    window.location.href = "/notes/fullscreen";
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

document.addEventListener('keydown', e =>{
    if (e.ctrlKey && e.key == "s"){
        e.preventDefault();
        submitForm();
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
        navigateToNotes();
    }
    else if (e.ctrlKey && e.key == ","){
        e.preventDefault();
        toggleMarkdown();
    }
})