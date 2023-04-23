title = document.getElementById('title');
content = document.getElementById('content');
contentMarkdown = document.getElementById('content-markdown');
noteForm = document.getElementById('note-form');
mobileMenu = document.getElementById('mobile-menu');

function toggleMobileMenu(){
    mobileMenu.style.display == "block" ? mobileMenu.style.display = "none" : mobileMenu.style.display = "block";
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
    content.style.fontSize = (parseInt(content.style.fontSize) + 1) + "px";
    console.log("Increased font size. New font size: " + (parseInt(content.style.fontSize) + 1) + "px.");
}

function decreaseFontSize(){
    content.style.fontSize = (parseInt(content.style.fontSize) - 1) + "px";
    console.log("Decreased font size. New font size: " + (parseInt(content.style.fontSize) - 1) + "px.");
}

function navigateToNotes(){
    window.location.href = "/notes/fullscreen";
}

function toggleMarkdown(){
    contentMarkdown.innerHTML = "";
    lines = content.value.split("\n");
    lines.forEach(l =>{
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
        else {
            contentMarkdown.innerHTML += `<p>${l}</p>`;
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