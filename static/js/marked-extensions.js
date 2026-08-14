(function () {
  if (typeof marked === 'undefined') return;

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  marked.use({ tokenizer: {
    inlineText: function (src, inRawBlock, smartypants) {
      var hlIdx = src.indexOf('==');
      if (hlIdx > 0) {
        var after = src.slice(hlIdx);
        var match = /^==((?:[^=]|=(?!=))+)(?<!\s)==/.exec(after);
        if (match) {
          var text = src.slice(0, hlIdx);
          return { type: 'text', raw: text, text: text };
        }
      }
      var match2 = /^==((?:[^=]|=(?!=))+)(?<!\s)==/.exec(src);
      if (match2) {
        return { type: 'text', raw: match2[0], text: '<mark>' + escapeHtml(match2[1]) + '</mark>' };
      }
      return false;
    }
  }});
})();