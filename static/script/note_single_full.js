title = document.getElementById('title');
content = document.getElementById('content');
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
})