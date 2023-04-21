// for making the text area larger as more text gets added
function textAreaAdjust(element) {
maxWidth = document.body.scrollWidth;
maxHeight = document.body.scrollHeight;
if (maxWidth < 600){
    maxHeight /= 3;
}
else{
    maxHeight /= 1.7;
}
element.style.height = "1px";
if (element.scrollHeight < maxHeight){
element.style.height = (25+element.scrollHeight)+"px";
}
else{
    element.style.height = (maxHeight)+"px";
}
}

element = document.getElementById('post-content');
textAreaAdjust(element);

function changeFontSize(){
document.getElementById('post-content').style.fontSize = document.getElementById('custom_font_size').value + "px";
}

