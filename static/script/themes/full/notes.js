numberOfRows = 3;
rowHeight = 150;
noteDivs = document.querySelectorAll(".note-div");
mobileMenu = document.getElementById('mobile-menu');
mobileMenuToggle = document.getElementById('mobile-menu-toggle');

function toggleMobileMenu(){
    mobileMenu.style.display == "flex" ? mobileMenu.style.display = "none" : mobileMenu.style.display = "flex";
    console.log("Toggled mobile menu");
}

function addNewNote(){
    window.location.href = "/note/0/full";
}

function navigateToSettings(){
    window.location.href = "/settings";
}

function navigateToAllNotes(){
    window.location.href = "/notes/full";
}

function navigateToCategories(){
    window.location.href = "/categories/full";
}

function tweakRows(){
    if (window.innerWidth > 600){
        if (numberOfRows == 1){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(100% - 40px)";
                el.style.padding = "20px";
            })
        }
        else if (numberOfRows == 2){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(50% - 40px)";
                el.style.padding = "20px";
            })
        }
        else if (numberOfRows == 3){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(33.33% - 40px)";
                el.style.padding = "20px";
            })
        }
        else if (numberOfRows == 4){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(25% - 30px)";
                el.style.padding = "15px";
            })
        }
        else if (numberOfRows == 5){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(20% - 30px)";
                el.style.padding = "15px";
            })
        }
        else if (numberOfRows == 6){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(16.666% - 24px)";
                el.style.padding = "12px";
            })
        }
        else if (numberOfRows == 7){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(14.2857% - 20px)";
                el.style.padding = "10px";
            })
        }
        else if (numberOfRows == 8){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(12.5% - 20px)";
                el.style.padding = "10px";
            })
        }
        else if (numberOfRows == 9){
            noteDivs.forEach((el)=>{
                el.style.width = "calc(11.111% - 20px)";
                el.style.padding = "10px";
            })
        }
    }
    else{
        noteDivs.forEach((el)=>{
            el.style.width = "calc(100% - 40px)";
            el.style.padding = "20px";
        })
    }
}

function decreaseNotesPerRow(){
    numberOfRows--;
    tweakRows();
    saveNotesPerRow();
}

function increaseNotesPerRow(){
    numberOfRows++;
    tweakRows();
    saveNotesPerRow();
}

function saveNotesPerRow(){
    fetch('/api/save_notes_row_count/' + numberOfRows)
    .then( response => response.json() )
}

function decreaseRowHeight(){
    rowHeight -= 10;
    tweakRowHeight();
    saveRowHeight();
}

function increaseRowHeight(){
    rowHeight += 10;
    tweakRowHeight();
    saveRowHeight();
}

function saveRowHeight(){
    fetch('/api/save_notes_height/' + rowHeight)
    .then( response => response.json() )
}

function tweakRowHeight(){
    noteDivs.forEach((el)=>{
        el.style.height = rowHeight + "px";
    })
}

document.addEventListener('keydown', e =>{
    if (e.ctrlKey && e.key == "e"){
        e.preventDefault();
        addNewNote();
    }
    else if (e.ctrlKey && e.key == "ArrowRight"){
        e.preventDefault();
        increaseNotesPerRow();
    }
    else if (e.ctrlKey && e.key == "ArrowLeft"){
        e.preventDefault();
        decreaseNotesPerRow();
    }
    else if (e.ctrlKey && e.key == "ArrowUp"){
        e.preventDefault();
        increaseRowHeight();
    }
    else if (e.ctrlKey && e.key == "ArrowDown"){
        e.preventDefault();
        decreaseRowHeight();
    }
})