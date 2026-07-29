/* Flasky Notes — Customize appearance (colors, font, custom CSS, AI generate).
   Self-contained: registers its own delegated listeners for data-action=
   "customize-*" / "open-customize" / "save-customize" / etc. so it does not
   need to be wired into app.js's central switch. */
(function() {
    'use strict';

    // ---------- Page data ----------
    var pageDataEl = document.getElementById('app-page-data');
    var pageData = pageDataEl ? JSON.parse(pageDataEl.textContent) : null;
    // Settings page uses a separate data block.
    if (!pageData || pageData.customColors === undefined) {
        var sd = document.getElementById('customize-page-data');
        if (sd) {
            try { pageData = JSON.parse(sd.textContent); } catch(e) { pageData = {}; }
        } else {
            pageData = {};
        }
    }

    var SAVED_COLORS = pageData.customColors || {};
    var SAVED_CSS = pageData.customCss || '';
    var AI_ENABLED = !!pageData.aiEnabled;
    var SAVED_FONT_FAMILY = pageData.fontFamily || '';
    var SAVED_FONT_SIZE = pageData.fontSize || 16;
    var ACTIVE_PRESET = pageData.activePreset || '';
    var ANIMATIONS_ENABLED = pageData.themeAnimationsEnabled !== false;

    // The customizable vars with friendly labels. rgba vars use text input.
    var COLOR_VARS = [
        {var: '--bg-primary',    label: 'Background',      rgba: false},
        {var: '--bg-secondary',  label: 'Secondary bg',    rgba: false},
        {var: '--bg-sidebar',    label: 'Sidebar bg',      rgba: false},
        {var: '--text-primary',  label: 'Text',            rgba: false},
        {var: '--text-secondary',label: 'Secondary text',  rgba: false},
        {var: '--text-muted',    label: 'Muted text',      rgba: false},
        {var: '--accent',        label: 'Accent',          rgba: false},
        {var: '--accent-hover',  label: 'Accent hover',    rgba: false},
        {var: '--border',        label: 'Border',          rgba: true},
        {var: '--border-light',  label: 'Border light',    rgba: true},
        {var: '--accent-dim',    label: 'Accent dim',      rgba: true},
        {var: '--bg-hover',      label: 'Hover bg',        rgba: true},
        {var: '--bg-active',     label: 'Active bg',       rgba: true},
        {var: '--green',         label: 'Green',          rgba: false},
        {var: '--red',           label: 'Red',             rgba: false},
        {var: '--yellow',        label: 'Yellow',          rgba: false}
    ];
    var DEFAULT_COLORS = {
        dark: {
            '--bg-primary': '#1e1e2e', '--bg-secondary': '#181825',
            '--bg-sidebar': '#11111b', '--text-primary': '#cdd6f4',
            '--text-secondary': '#bac2de', '--text-muted': '#585b70',
            '--accent': '#b4befe', '--accent-hover': '#cba6f7',
            '--border': 'rgba(255,255,255,0.06)', '--border-light': 'rgba(255,255,255,0.1)',
            '--accent-dim': 'rgba(180,190,254,0.1)', '--bg-hover': 'rgba(255,255,255,0.05)',
            '--bg-active': 'rgba(255,255,255,0.08)', '--green': '#a6e3a1',
            '--red': '#f38ba8', '--yellow': '#f9e2af'
        },
        light: {
            '--bg-primary': '#f8f9fc', '--bg-secondary': '#eff1f5',
            '--bg-sidebar': '#e6e9ef', '--text-primary': '#1a1a2e',
            '--text-secondary': '#2d2d44', '--text-muted': '#555770',
            '--accent': '#5a6fe0', '--accent-hover': '#7630d4',
            '--border': 'rgba(0,0,0,0.12)', '--border-light': 'rgba(0,0,0,0.18)',
            '--accent-dim': 'rgba(90,111,224,0.16)', '--bg-hover': 'rgba(0,0,0,0.06)',
            '--bg-active': 'rgba(0,0,0,0.10)', '--green': '#2d8a1a',
            '--red': '#c40d33', '--yellow': '#c47a10'
        }
    };

    // Pending (unsaved) state per scope. On open we copy from saved; on save
    // we persist; on cancel we revert.
    var scopes = {};  // {scope: {colors: {...}, css: str, font: str, fontSize: num, activeColorTheme: str}}

    // ---------- One-click theme presets ----------
    // Mirrors flasky/theme_presets.py. Each entry: {id, name, vibe,
    // darkMode (null=leave as-is), font, fontSize, colorsDark, colorsLight,
    // customCss}. Colors only need the vars the preset overrides; missing
    // keys fall through to DEFAULT_COLORS / app.css.
    var THEME_PRESETS = [
        {id:'classic',name:'Classic',vibe:'Default',darkMode:null,font:'',fontSize:16,
         colorsDark:{},colorsLight:{},customCss:''},
        {id:'midnight',name:'Midnight',vibe:'Classy dark',darkMode:true,font:'',fontSize:16,
         colorsDark:{'--bg-primary':'#1e1e2e','--bg-secondary':'#181825','--bg-sidebar':'#11111b','--text-primary':'#cdd6f4','--text-secondary':'#bac2de','--text-muted':'#585b70','--accent':'#b4befe','--accent-hover':'#cba6f7','--border':'rgba(255,255,255,0.06)','--border-light':'rgba(255,255,255,0.1)','--accent-dim':'rgba(180,190,254,0.12)','--bg-hover':'rgba(255,255,255,0.05)','--bg-active':'rgba(255,255,255,0.08)','--green':'#a6e3a1','--red':'#f38ba8','--yellow':'#f9e2af'},
         colorsLight:{'--bg-primary':'#f8f9fc','--bg-secondary':'#eff1f5','--bg-sidebar':'#e6e9ef','--text-primary':'#1a1a2e','--text-secondary':'#2d2d44','--text-muted':'#555770','--accent':'#5a6fe0','--accent-hover':'#7630d4','--border':'rgba(0,0,0,0.12)','--border-light':'rgba(0,0,0,0.18)','--accent-dim':'rgba(90,111,224,0.16)','--bg-hover':'rgba(0,0,0,0.06)','--bg-active':'rgba(0,0,0,0.10)','--green':'#2d8a1a','--red':'#c40d33','--yellow':'#c47a10'},
         customCss:''},
        {id:'tokyo-neon',name:'Tokyo Neon',vibe:'Bold + animated',darkMode:true,font:"'JetBrains Mono', 'Fira Code', monospace",fontSize:15,
         colorsDark:{'--bg-primary':'#0d0221','--bg-secondary':'#10042b','--bg-sidebar':'#08011a','--text-primary':'#e0e0ff','--text-secondary':'#9d8df1','--text-muted':'#5a4e8c','--accent':'#ff2e88','--accent-hover':'#00f0ff','--border':'rgba(255,46,136,0.15)','--border-light':'rgba(0,240,255,0.25)','--accent-dim':'rgba(255,46,136,0.15)','--bg-hover':'rgba(255,46,136,0.08)','--bg-active':'rgba(0,240,255,0.12)','--green':'#00ff9f','--red':'#ff3860','--yellow':'#ffea00'},
         colorsLight:{'--bg-primary':'#f5f0ff','--bg-secondary':'#ebe0ff','--bg-sidebar':'#e0d4ff','--text-primary':'#2d0a4e','--text-secondary':'#4a1a6e','--text-muted':'#7a5a9e','--accent':'#d600a0','--accent-hover':'#0070d6','--border':'rgba(214,0,160,0.15)','--border-light':'rgba(0,112,214,0.25)','--accent-dim':'rgba(214,0,160,0.14)','--bg-hover':'rgba(214,0,160,0.06)','--bg-active':'rgba(0,112,214,0.10)','--green':'#00805a','--red':'#c4003a','--yellow':'#a06800'},
         customCss:'/* Tokyo Neon */\n@keyframes flasky-neon-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,46,136,0)}50%{box-shadow:0 0 8px 1px rgba(255,46,136,0.4)}}\n@keyframes flasky-neon-scan{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}\n.toolbar button:focus,.sidebar-header button:focus{animation:flasky-neon-pulse 3s ease-in-out infinite}\n.toolbar{position:relative;overflow:hidden}\n.toolbar::after{content:\'\';position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,240,255,0.6),transparent);animation:flasky-neon-scan 5s linear infinite}\n@media (prefers-reduced-motion: reduce){.toolbar button:focus,.sidebar-header button:focus{animation:none!important}.toolbar::after{animation:none!important}}'},
        {id:'solar-dawn',name:'Solar Dawn',vibe:'Warm classy',darkMode:false,font:"Georgia, 'Times New Roman', serif",fontSize:16,
         colorsDark:{'--bg-primary':'#2b2620','--bg-secondary':'#241f1a','--bg-sidebar':'#1e1915','--text-primary':'#eee6d3','--text-secondary':'#c8b893','--text-muted':'#8a7a5e','--accent':'#e8a87c','--accent-hover':'#f0b890','--border':'rgba(238,230,211,0.08)','--border-light':'rgba(238,230,211,0.15)','--accent-dim':'rgba(232,168,124,0.15)','--bg-hover':'rgba(238,230,211,0.05)','--bg-active':'rgba(238,230,211,0.08)','--green':'#b5d980','--red':'#e07070','--yellow':'#f0d080'},
         colorsLight:{'--bg-primary':'#fdf6e3','--bg-secondary':'#f5ecd0','--bg-sidebar':'#eee3c4','--text-primary':'#3b3025','--text-secondary':'#5a4a3a','--text-muted':'#8a7a60','--accent':'#cb7e3c','--accent-hover':'#a86520','--border':'rgba(59,48,37,0.10)','--border-light':'rgba(59,48,37,0.18)','--accent-dim':'rgba(203,126,60,0.14)','--bg-hover':'rgba(59,48,37,0.05)','--bg-active':'rgba(59,48,37,0.10)','--green':'#5a8030','--red':'#b03030','--yellow':'#a06820'},
         customCss:''},
        {id:'nordic-frost',name:'Nordic Frost',vibe:'Cool calm',darkMode:true,font:'',fontSize:15,
         colorsDark:{'--bg-primary':'#2e3440','--bg-secondary':'#272c36','--bg-sidebar':'#21262e','--text-primary':'#e5e9f0','--text-secondary':'#c1cce0','--text-muted':'#6b7280','--accent':'#88c0d0','--accent-hover':'#81a1c1','--border':'rgba(229,233,240,0.06)','--border-light':'rgba(229,233,240,0.1)','--accent-dim':'rgba(136,192,208,0.12)','--bg-hover':'rgba(229,233,240,0.04)','--bg-active':'rgba(136,192,208,0.10)','--green':'#a3be8c','--red':'#bf616a','--yellow':'#ebcb8b'},
         colorsLight:{'--bg-primary':'#f0f4f8','--bg-secondary':'#e6ecf2','--bg-sidebar':'#dde4ec','--text-primary':'#2e3440','--text-secondary':'#44546a','--text-muted':'#738090','--accent':'#5e81ac','--accent-hover':'#4c6e8e','--border':'rgba(46,52,64,0.10)','--border-light':'rgba(46,52,64,0.16)','--accent-dim':'rgba(94,129,172,0.14)','--bg-hover':'rgba(46,52,64,0.05)','--bg-active':'rgba(94,129,172,0.10)','--green':'#3f7a3f','--red':'#b04040','--yellow':'#a07020'},
         customCss:''},
        {id:'rose-quartz',name:'Rose Quartz',vibe:'Soft elegant',darkMode:false,font:"'Segoe UI', system-ui, sans-serif",fontSize:16,
         colorsDark:{'--bg-primary':'#2a2329','--bg-secondary':'#221c21','--bg-sidebar':'#1b161a','--text-primary':'#f5e8ee','--text-secondary':'#d4b8c4','--text-muted':'#8a7a82','--accent':'#e8a0bf','--accent-hover':'#d080a0','--border':'rgba(245,232,238,0.06)','--border-light':'rgba(245,232,238,0.1)','--accent-dim':'rgba(232,160,191,0.12)','--bg-hover':'rgba(245,232,238,0.04)','--bg-active':'rgba(232,160,191,0.10)','--green':'#a8c890','--red':'#e08090','--yellow':'#e8c890'},
         colorsLight:{'--bg-primary':'#fdf5f8','--bg-secondary':'#f7ecf2','--bg-sidebar':'#f0e0e8','--text-primary':'#3a2832','--text-secondary':'#5a4050','--text-muted':'#8a7080','--accent':'#c06090','--accent-hover':'#a04070','--border':'rgba(58,40,50,0.10)','--border-light':'rgba(58,40,50,0.16)','--accent-dim':'rgba(192,96,144,0.12)','--bg-hover':'rgba(58,40,50,0.05)','--bg-active':'rgba(192,96,144,0.10)','--green':'#5a8060','--red':'#b04060','--yellow':'#a08040'},
         customCss:''},
        {id:'forest-moss',name:'Forest Moss',vibe:'Earthy',darkMode:true,font:'',fontSize:16,
         colorsDark:{'--bg-primary':'#1c2418','--bg-secondary':'#161e13','--bg-sidebar':'#101709','--text-primary':'#d8e8c8','--text-secondary':'#b0c098','--text-muted':'#6a7a5a','--accent':'#8fa860','--accent-hover':'#a8c878','--border':'rgba(216,232,200,0.06)','--border-light':'rgba(216,232,200,0.1)','--accent-dim':'rgba(143,168,96,0.12)','--bg-hover':'rgba(216,232,200,0.04)','--bg-active':'rgba(143,168,96,0.10)','--green':'#90c060','--red':'#c06060','--yellow':'#d8c060'},
         colorsLight:{'--bg-primary':'#f4f6ee','--bg-secondary':'#eaeede','--bg-sidebar':'#dde4d0','--text-primary':'#2a3020','--text-secondary':'#444a34','--text-muted':'#6a7060','--accent':'#506e30','--accent-hover':'#3a5020','--border':'rgba(42,48,32,0.10)','--border-light':'rgba(42,48,32,0.16)','--accent-dim':'rgba(80,110,48,0.14)','--bg-hover':'rgba(42,48,32,0.05)','--bg-active':'rgba(80,110,48,0.10)','--green':'#3a7030','--red':'#a03030','--yellow':'#806020'},
         customCss:''},
        {id:'sunset-ember',name:'Sunset Ember',vibe:'Bold + animated',darkMode:true,font:'',fontSize:16,
         colorsDark:{'--bg-primary':'#1a0f0a','--bg-secondary':'#241510','--bg-sidebar':'#120906','--text-primary':'#ffe8d0','--text-secondary':'#e8a878','--text-muted':'#8a6048','--accent':'#ff6a3d','--accent-hover':'#ff9040','--border':'rgba(255,106,61,0.12)','--border-light':'rgba(255,144,64,0.2)','--accent-dim':'rgba(255,106,61,0.15)','--bg-hover':'rgba(255,106,61,0.06)','--bg-active':'rgba(255,144,64,0.10)','--green':'#a0d060','--red':'#ff4060','--yellow':'#ffc040'},
         colorsLight:{'--bg-primary':'#fff5ed','--bg-secondary':'#ffead8','--bg-sidebar':'#ffdcc0','--text-primary':'#2a1810','--text-secondary':'#4a2e20','--text-muted':'#806048','--accent':'#e05020','--accent-hover':'#c03010','--border':'rgba(42,24,16,0.10)','--border-light':'rgba(42,24,16,0.18)','--accent-dim':'rgba(224,80,32,0.14)','--bg-hover':'rgba(42,24,16,0.05)','--bg-active':'rgba(224,80,32,0.10)','--green':'#408030','--red':'#c03030','--yellow':'#a06010'},
         customCss:'/* Sunset Ember */\n@keyframes flasky-ember-flow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}\n.toolbar{background:linear-gradient(90deg,rgba(255,106,61,0.5),rgba(255,144,64,0.5),rgba(255,192,64,0.5),rgba(255,106,61,0.5));background-size:300% 100%;animation:flasky-ember-flow 12s ease infinite}\n@media (prefers-reduced-motion: reduce){.toolbar{animation:none!important}}'},
        {id:'graphite',name:'Graphite',vibe:'Monochrome classy',darkMode:true,font:'system-ui, -apple-system, sans-serif',fontSize:15,
         colorsDark:{'--bg-primary':'#1a1a1a','--bg-secondary':'#141414','--bg-sidebar':'#0f0f0f','--text-primary':'#e8e8e8','--text-secondary':'#b0b0b0','--text-muted':'#606060','--accent':'#a0a0a0','--accent-hover':'#c0c0c0','--border':'rgba(255,255,255,0.06)','--border-light':'rgba(255,255,255,0.1)','--accent-dim':'rgba(160,160,160,0.12)','--bg-hover':'rgba(255,255,255,0.05)','--bg-active':'rgba(255,255,255,0.08)','--green':'#909090','--red':'#909090','--yellow':'#909090'},
         colorsLight:{'--bg-primary':'#fafafa','--bg-secondary':'#f0f0f0','--bg-sidebar':'#e8e8e8','--text-primary':'#1a1a1a','--text-secondary':'#3a3a3a','--text-muted':'#808080','--accent':'#505050','--accent-hover':'#303030','--border':'rgba(0,0,0,0.10)','--border-light':'rgba(0,0,0,0.16)','--accent-dim':'rgba(80,80,80,0.14)','--bg-hover':'rgba(0,0,0,0.05)','--bg-active':'rgba(0,0,0,0.10)','--green':'#606060','--red':'#606060','--yellow':'#606060'},
         customCss:''},
        {id:'synthwave',name:'Synthwave',vibe:'Bold animated retro',darkMode:true,font:"'JetBrains Mono', monospace",fontSize:15,
         colorsDark:{'--bg-primary':'#0f0a1e','--bg-secondary':'#160f2a','--bg-sidebar':'#0a0617','--text-primary':'#f0e6ff','--text-secondary':'#c8a0ff','--text-muted':'#7a5a9e','--accent':'#ff006e','--accent-hover':'#8338ec','--border':'rgba(255,0,110,0.12)','--border-light':'rgba(131,56,236,0.2)','--accent-dim':'rgba(255,0,110,0.15)','--bg-hover':'rgba(131,56,236,0.08)','--bg-active':'rgba(255,0,110,0.12)','--green':'#3aff8c','--red':'#ff3860','--yellow':'#ffea00'},
         colorsLight:{'--bg-primary':'#f0e8ff','--bg-secondary':'#e4d4ff','--bg-sidebar':'#d8c4ff','--text-primary':'#2a0a4e','--text-secondary':'#4a1a6e','--text-muted':'#7a5a9e','--accent':'#d600a0','--accent-hover':'#7030d6','--border':'rgba(42,10,78,0.12)','--border-light':'rgba(42,10,78,0.2)','--accent-dim':'rgba(214,0,160,0.12)','--bg-hover':'rgba(42,10,78,0.05)','--bg-active':'rgba(214,0,160,0.10)','--green':'#00805a','--red':'#c4003a','--yellow':'#a06800'},
         customCss:'/* Synthwave */\n@keyframes flasky-synth-grid{0%{background-position:0 0}100%{background-position:40px 40px}}\n@keyframes flasky-synth-scan{0%{top:0}100%{top:100%}}\nbody::before{content:\'\';position:fixed;inset:0;pointer-events:none;z-index:9998;background-image:linear-gradient(rgba(131,56,236,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,0,110,0.06) 1px,transparent 1px);background-size:40px 40px;animation:flasky-synth-grid 8s linear infinite}\nbody::after{content:\'\';position:fixed;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(255,0,110,0.5),transparent);pointer-events:none;z-index:9998;opacity:0.4;animation:flasky-synth-scan 10s linear infinite}\n@media (prefers-reduced-motion: reduce){body::before{animation:none!important}body::after{display:none!important}}'},
         {id:'parchment',name:'Parchment',vibe:'Classy paper',darkMode:false,font:"Georgia, 'Times New Roman', serif",fontSize:16,
          colorsDark:{'--bg-primary':'#2a2520','--bg-secondary':'#241f1a','--bg-sidebar':'#1e1915','--text-primary':'#e8dcc8','--text-secondary':'#c0b098','--text-muted':'#8a7a60','--accent':'#a08050','--accent-hover':'#c0a060','--border':'rgba(232,220,200,0.08)','--border-light':'rgba(232,220,200,0.15)','--accent-dim':'rgba(160,128,80,0.15)','--bg-hover':'rgba(232,220,200,0.05)','--bg-active':'rgba(232,220,200,0.08)','--green':'#90a060','--red':'#b06040','--yellow':'#c0a060'},
          colorsLight:{'--bg-primary':'#f5ecd7','--bg-secondary':'#ede0c0','--bg-sidebar':'#e4d4a8','--text-primary':'#3a2a18','--text-secondary':'#5a4028','--text-muted':'#8a7048','--accent':'#8a5a2a','--accent-hover':'#6a401a','--border':'rgba(58,42,24,0.12)','--border-light':'rgba(58,42,24,0.2)','--accent-dim':'rgba(138,90,42,0.14)','--bg-hover':'rgba(58,42,24,0.05)','--bg-active':'rgba(58,42,24,0.10)','--green':'#4a6a30','--red':'#a04030','--yellow':'#a06820'},
          customCss:'/* Parchment */\nbody::before{content:\'\';position:fixed;inset:0;pointer-events:none;z-index:9998;background-image:radial-gradient(circle at 20% 30%,rgba(138,90,42,0.08) 0%,transparent 50%),radial-gradient(circle at 80% 70%,rgba(138,90,42,0.08) 0%,transparent 50%),radial-gradient(circle at 50% 50%,rgba(138,90,42,0.05) 0%,transparent 70%)}\n.editor-content{font-feature-settings:"liga" 1,"kern" 1}'},
        {id:'cyberpunk',name:'Cyberpunk',vibe:'Videogame + glitch',darkMode:true,font:"'JetBrains Mono', monospace",fontSize:15,
         colorsDark:{'--bg-primary':'#0a0a0f','--bg-secondary':'#12121a','--bg-sidebar':'#06060a','--text-primary':'#fcee0c','--text-secondary':'#c0c0d0','--text-muted':'#5a5a6e','--accent':'#fcee0c','--accent-hover':'#00f0ff','--border':'rgba(252,238,12,0.1)','--border-light':'rgba(0,240,255,0.2)','--accent-dim':'rgba(252,238,12,0.12)','--bg-hover':'rgba(252,238,12,0.06)','--bg-active':'rgba(0,240,255,0.1)','--green':'#00ff88','--red':'#ff003c','--yellow':'#fcee0c'},
         colorsLight:{'--bg-primary':'#f8f8f0','--bg-secondary':'#eeee00','--bg-sidebar':'#e0e0d0','--text-primary':'#0a0a0f','--text-secondary':'#3a3a4e','--text-muted':'#808090','--accent':'#e0b000','--accent-hover':'#0090d0','--border':'rgba(10,10,15,0.12)','--border-light':'rgba(10,10,15,0.2)','--accent-dim':'rgba(224,176,0,0.14)','--bg-hover':'rgba(10,10,15,0.05)','--bg-active':'rgba(224,176,0,0.10)','--green':'#00805a','--red':'#c00030','--yellow':'#a08010'},
         customCss:'/* Cyberpunk */\n@keyframes flasky-cp-glitch{0%,100%{opacity:1;transform:translateX(0)}20%{opacity:0.92;transform:translateX(-1px)}21%{opacity:1;transform:translateX(1px)}22%{transform:translateX(0)}40%{opacity:0.95;transform:translateX(-1px)}41%{opacity:1;transform:translateX(1px)}42%{transform:translateX(0)}}\n.editor-content h1,.editor-title{animation:flasky-cp-glitch 5s steps(1) infinite}\n@keyframes flasky-cp-scan{0%{top:-100%}100%{top:100%}}\nbody::after{content:\'\';position:fixed;left:0;right:0;height:40%;background:linear-gradient(transparent,rgba(252,238,12,0.04),transparent);pointer-events:none;z-index:9998;animation:flasky-cp-scan 8s linear infinite}\n@media (prefers-reduced-motion: reduce){.editor-content h1,.editor-title{animation:none!important}body::after{display:none!important}}'},
        {id:'matrix',name:'Matrix',vibe:'Videogame + code rain',darkMode:true,font:"'JetBrains Mono', 'Courier New', monospace",fontSize:15,
         colorsDark:{'--bg-primary':'#000000','--bg-secondary':'#030a03','--bg-sidebar':'#000000','--text-primary':'#00ff41','--text-secondary':'#00cc33','--text-muted':'#008822','--accent':'#00ff41','--accent-hover':'#33ff66','--border':'rgba(0,255,65,0.1)','--border-light':'rgba(0,255,65,0.2)','--accent-dim':'rgba(0,255,65,0.12)','--bg-hover':'rgba(0,255,65,0.06)','--bg-active':'rgba(0,255,65,0.1)','--green':'#00ff41','--red':'#ff2040','--yellow':'#ccff00'},
         colorsLight:{'--bg-primary':'#f0fff0','--bg-secondary':'#e0ffe0','--bg-sidebar':'#d0f0d0','--text-primary':'#0a1a0a','--text-secondary':'#2a4a2a','--text-muted':'#5a7a5a','--accent':'#008822','--accent-hover':'#006611','--border':'rgba(10,26,10,0.10)','--border-light':'rgba(10,26,10,0.18)','--accent-dim':'rgba(0,136,34,0.14)','--bg-hover':'rgba(10,26,10,0.05)','--bg-active':'rgba(0,136,34,0.10)','--green':'#008822','--red':'#c03030','--yellow':'#808020'},
         customCss:'/* Matrix */\n@keyframes flasky-matrix-rain{0%{background-position:0 0}100%{background-position:0 -600px}}\nbody::before{content:\'\';position:fixed;inset:0;pointer-events:none;z-index:9998;background-image:repeating-linear-gradient(0deg,rgba(0,255,65,0.05) 0px,transparent 2px,rgba(0,255,65,0.05) 4px,transparent 6px,rgba(0,255,65,0.08) 8px,transparent 12px);animation:flasky-matrix-rain 10s linear infinite}\n@media (prefers-reduced-motion: reduce){body::before{animation:none!important}}'},
        {id:'retro-arcade',name:'Retro Arcade',vibe:'Videogame + CRT scanlines',darkMode:true,font:"'Press Start 2P', 'Courier New', monospace",fontSize:14,
         colorsDark:{'--bg-primary':'#1a0633','--bg-secondary':'#240844','--bg-sidebar':'#120422','--text-primary':'#ff6ec7','--text-secondary':'#c0a0e0','--text-muted':'#7060a0','--accent':'#ff6ec7','--accent-hover':'#00ffff','--border':'rgba(255,110,199,0.12)','--border-light':'rgba(0,255,255,0.2)','--accent-dim':'rgba(255,110,199,0.14)','--bg-hover':'rgba(255,110,199,0.06)','--bg-active':'rgba(0,255,255,0.1)','--green':'#00ff7f','--red':'#ff3060','--yellow':'#ffcc00'},
         colorsLight:{'--bg-primary':'#f8f0ff','--bg-secondary':'#f0e0ff','--bg-sidebar':'#e8d4ff','--text-primary':'#2a0a44','--text-secondary':'#4a1a6e','--text-muted':'#7a5a9e','--accent':'#d620a0','--accent-hover':'#0090d0','--border':'rgba(42,10,68,0.12)','--border-light':'rgba(42,10,68,0.2)','--accent-dim':'rgba(214,32,160,0.12)','--bg-hover':'rgba(42,10,68,0.05)','--bg-active':'rgba(214,32,160,0.10)','--green':'#00805a','--red':'#c4003a','--yellow':'#a06800'},
         customCss:'/* Retro Arcade */\n@keyframes flasky-arcade-flicker{0%,100%{opacity:1}50%{opacity:0.97}}\nbody{animation:flasky-arcade-flicker 0.25s steps(1) infinite}\nbody::before{content:\'\';position:fixed;inset:0;pointer-events:none;z-index:9998;background:repeating-linear-gradient(0deg,rgba(0,0,0,0.12) 0px,rgba(0,0,0,0.12) 1px,transparent 1px,transparent 3px)}\nbody::after{content:\'\';position:fixed;inset:0;pointer-events:none;z-index:9998;background:radial-gradient(ellipse at center,transparent 65%,rgba(26,6,51,0.3) 100%)}\n@media (prefers-reduced-motion: reduce){body{animation:none!important}}'},
        {id:'tron-grid',name:'Tron Grid',vibe:'Videogame + glowing grid',darkMode:true,font:"'Orbitron', 'JetBrains Mono', monospace",fontSize:15,
         colorsDark:{'--bg-primary':'#050510','--bg-secondary':'#0a0a18','--bg-sidebar':'#020208','--text-primary':'#d0e0ff','--text-secondary':'#80a0d0','--text-muted':'#405070','--accent':'#00d4ff','--accent-hover':'#ff9900','--border':'rgba(0,212,255,0.15)','--border-light':'rgba(255,153,0,0.2)','--accent-dim':'rgba(0,212,255,0.12)','--bg-hover':'rgba(0,212,255,0.08)','--bg-active':'rgba(255,153,0,0.1)','--green':'#00ff88','--red':'#ff4060','--yellow':'#ffcc00'},
         colorsLight:{'--bg-primary':'#eef4ff','--bg-secondary':'#e0eaf8','--bg-sidebar':'#d4e0f0','--text-primary':'#0a1428','--text-secondary':'#2a3a50','--text-muted':'#607090','--accent':'#0090d4','--accent-hover':'#cc6600','--border':'rgba(10,20,40,0.12)','--border-light':'rgba(10,20,40,0.2)','--accent-dim':'rgba(0,144,212,0.14)','--bg-hover':'rgba(10,20,40,0.05)','--bg-active':'rgba(0,144,212,0.10)','--green':'#00805a','--red':'#c03030','--yellow':'#a06010'},
         customCss:'/* Tron Grid */\n@keyframes flasky-tron-pulse{0%,100%{opacity:0.2}50%{opacity:0.4}}\nbody::before{content:\'\';position:fixed;inset:0;pointer-events:none;z-index:9998;background-image:linear-gradient(rgba(0,212,255,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,0.08) 1px,transparent 1px);background-size:30px 30px;animation:flasky-tron-pulse 6s ease-in-out infinite}\n.toolbar{border-bottom:1px solid var(--accent);box-shadow:0 0 8px rgba(0,212,255,0.25)}\n@media (prefers-reduced-motion: reduce){body::before{animation:none!important}}'}
    ];
    var PRESET_MAP = {};
    THEME_PRESETS.forEach(function(p){ PRESET_MAP[p.id] = p; });

    function initScope(name) {
        scopes[name] = {
            colors: JSON.parse(JSON.stringify(SAVED_COLORS)),
            css: SAVED_CSS,
            font: SAVED_FONT_FAMILY,
            fontSize: SAVED_FONT_SIZE,
            activeColorTheme: 'dark'
        };
    }

    function getScope(name) {
        if (!scopes[name]) initScope(name);
        return scopes[name];
    }

    // ---------- Live preview helpers ----------
    // Live <style> blocks (appended to <head>) mirror what the server-rendered
    // #custom-theme-override block emits. Once live overrides are in place we
    // blank the server block so stale rules from a previous theme don't bleed
    // through (e.g. body::before animation from theme A persisting under theme B).
    function neutralizeServerOverride() {
        var srv = document.getElementById('custom-theme-override');
        if (srv) srv.textContent = '';
    }

    function buildColorsCss(st) {
        var lines = [];
        ['dark', 'light'].forEach(function(mode) {
            var modeColors = st.colors[mode];
            if (!modeColors || Object.keys(modeColors).length === 0) return;
            var selector = mode === 'dark' ? ':root' : '[data-theme="light"]';
            lines.push(selector + ' {');
            COLOR_VARS.forEach(function(c) {
                var val = modeColors[c.var];
                if (val !== undefined && val !== '') {
                    lines.push('  ' + c.var + ': ' + val + ';');
                }
            });
            lines.push('}');
        });
        return lines.join('\n');
    }

    function applyColorsLive(scopeName) {
        var st = getScope(scopeName);
        var css = buildColorsCss(st);
        var el = document.getElementById('custom-colors-live');
        if (!el) {
            el = document.createElement('style');
            el.id = 'custom-colors-live';
            document.head.appendChild(el);
        }
        el.textContent = css;
        neutralizeServerOverride();
    }

    function applyCssLive(scopeName) {
        var st = getScope(scopeName);
        var el = document.getElementById('custom-css-live');
        if (!el) {
            el = document.createElement('style');
            el.id = 'custom-css-live';
            document.head.appendChild(el);
        }
        el.textContent = st.css || '';
        neutralizeServerOverride();
    }

    function applyFontLive(scopeName) {
        var st = getScope(scopeName);
        if (st.font) {
            document.documentElement.style.setProperty('--editor-font', st.font);
        } else {
            document.documentElement.style.removeProperty('--editor-font');
        }
        if (st.fontSize) {
            document.documentElement.style.setProperty('--font-size', st.fontSize + 'px');
        }
    }

    function revertAll(scopeName) {
        // Restore from saved state
        initScope(scopeName);
        applyColorsLive(scopeName);
        applyCssLive(scopeName);
        applyFontLive(scopeName);
    }

    // ---------- Preset picker ----------
    function buildPresetGrid(scopeName) {
        var grid = document.getElementById('theme-presets-' + scopeName);
        if (!grid) return;
        grid.innerHTML = '';
        THEME_PRESETS.forEach(function(p) {
            var card = document.createElement('div');
            card.className = 'theme-preset-card';
            card.dataset.action = 'apply-preset';
            card.dataset.preset = p.id;
            card.dataset.scope = scopeName;
            if (p.id === ACTIVE_PRESET) card.classList.add('active');
            var sw = document.createElement('div');
            sw.className = 'theme-preset-swatch';
            var darkBg = p.colorsDark['--bg-primary'] || DEFAULT_COLORS.dark['--bg-primary'];
            var darkAcc = p.colorsDark['--accent'] || DEFAULT_COLORS.dark['--accent'];
            var lightBg = p.colorsLight['--bg-primary'] || DEFAULT_COLORS.light['--bg-primary'];
            var lightAcc = p.colorsLight['--accent'] || DEFAULT_COLORS.light['--accent'];
            if (p.id === 'classic') {
                darkBg = DEFAULT_COLORS.dark['--bg-primary'];
                darkAcc = DEFAULT_COLORS.dark['--accent'];
                lightBg = DEFAULT_COLORS.light['--bg-primary'];
                lightAcc = DEFAULT_COLORS.light['--accent'];
            }
            var half1 = document.createElement('div');
            half1.className = 'theme-preset-swatch-half';
            half1.style.background = 'linear-gradient(135deg,' + darkBg + ' 50%,' + darkAcc + ' 50%)';
            sw.appendChild(half1);
            var half2 = document.createElement('div');
            half2.className = 'theme-preset-swatch-half';
            half2.style.background = 'linear-gradient(135deg,' + lightBg + ' 50%,' + lightAcc + ' 50%)';
            sw.appendChild(half2);
            card.appendChild(sw);
            var body = document.createElement('div');
            body.className = 'theme-preset-body';
            var nm = document.createElement('span');
            nm.className = 'theme-preset-name';
            nm.textContent = p.name;
            body.appendChild(nm);
            var vb = document.createElement('span');
            vb.className = 'theme-preset-vibe';
            vb.textContent = p.vibe;
            body.appendChild(vb);
            card.appendChild(body);
            grid.appendChild(card);
        });
    }

    function refreshPresetHighlight(scopeName) {
        var grid = document.getElementById('theme-presets-' + scopeName);
        if (!grid) return;
        grid.querySelectorAll('.theme-preset-card').forEach(function(c) {
            c.classList.toggle('active', c.dataset.preset === ACTIVE_PRESET);
        });
    }

    function clearActivePreset() {
        if (!ACTIVE_PRESET) return;
        ACTIVE_PRESET = '';
        fetch('/api/save_appearance', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
            body: JSON.stringify({active_preset: ''})
        }).catch(function(){});
        ['settings', 'modal'].forEach(function(s) {
            if (document.querySelector('[data-customize-scope="' + s + '"]')) {
                refreshPresetHighlight(s);
            }
        });
    }

    function toggleAnimations(scopeName, enabled) {
        ANIMATIONS_ENABLED = !!enabled;
        ['settings', 'modal'].forEach(function(s) {
            var cb = document.getElementById('theme-animations-' + s);
            if (cb) cb.checked = ANIMATIONS_ENABLED;
        });
        if (ACTIVE_PRESET && PRESET_MAP[ACTIVE_PRESET]) {
            var p = PRESET_MAP[ACTIVE_PRESET];
            var raw = p.customCss || '';
            var st = getScope(scopeName);
            st.css = ANIMATIONS_ENABLED ? raw : stripAnimations(raw);
            applyCssLive(scopeName);
            populateFields(scopeName);
            var payload = {
                css: st.css || '',
                theme_animations_enabled: ANIMATIONS_ENABLED ? 1 : 0,
            };
            fetch('/api/save_appearance', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
                body: JSON.stringify(payload)
            }).then(function() {
                SAVED_CSS = st.css || '';
            }).catch(function(){});
        } else {
            fetch('/api/save_appearance', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
                body: JSON.stringify({theme_animations_enabled: ANIMATIONS_ENABLED ? 1 : 0})
            }).catch(function(){});
        }
    }

    function stripAnimations(css) {
        if (!css) return '';
        var out = css.replace(/@keyframes[^{]*\{[^@]*?\}\s*/g, '');
        out = out.replace(/animation\s*:[^;}]*;?/g, '');
        out = out.replace(/@media\s*\(prefers-reduced-motion[^{]*\{[^}]*\}/g, '');
        return out.trim();
    }

    function applyPreset(scopeName, presetId) {
        var p = PRESET_MAP[presetId];
        if (!p) return;
        var st = getScope(scopeName);
        st.colors = {
            dark: JSON.parse(JSON.stringify(p.colorsDark)),
            light: JSON.parse(JSON.stringify(p.colorsLight))
        };
        var raw = p.customCss || '';
        st.css = ANIMATIONS_ENABLED ? raw : stripAnimations(raw);
        st.font = p.font || '';
        st.fontSize = p.fontSize || 16;
        applyColorsLive(scopeName);
        applyCssLive(scopeName);
        applyFontLive(scopeName);
        // Sync DOM input fields now so an early Save click flushes correct values.
        populateFields(scopeName);
        ACTIVE_PRESET = presetId;
        refreshPresetHighlight(scopeName);
        buildColorGrid(scopeName);
        // Single batch POST — avoids the read-modify-write race that
        // concurrent single-key endpoints caused.
        var payload = {
            colors: st.colors,
            css: st.css || '',
            font: st.font || '',
            font_size: st.fontSize,
            active_preset: presetId,
        };
        if (p.darkMode !== null) {
            var wantDark = !!p.darkMode;
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark !== wantDark) {
                document.documentElement.setAttribute('data-theme', wantDark ? 'dark' : 'light');
                var hljsDark = document.getElementById('hljs-dark');
                var hljsLight = document.getElementById('hljs-light');
                if (hljsDark) hljsDark.disabled = !wantDark;
                if (hljsLight) hljsLight.disabled = wantDark;
                payload.dark_mode = wantDark ? 1 : 0;
            }
        }
        fetch('/api/save_appearance', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
            body: JSON.stringify(payload)
        }).then(function() {
            SAVED_COLORS = JSON.parse(JSON.stringify(st.colors));
            SAVED_CSS = st.css || '';
            SAVED_FONT_FAMILY = st.font || '';
            SAVED_FONT_SIZE = st.fontSize;
            if (scopeName === 'modal') showStatus(scopeName, 'Theme applied');
        }).catch(function(){});
    }

    // ---------- Color picker grid build ----------
    function buildColorGrid(scopeName) {
        var grid = document.getElementById('color-grid-' + scopeName);
        if (!grid) return;
        var st = getScope(scopeName);
        var mode = st.activeColorTheme;
        grid.innerHTML = '';
        COLOR_VARS.forEach(function(c) {
            var row = document.createElement('div');
            row.className = 'color-picker-row';
            var label = document.createElement('span');
            label.className = 'color-picker-label';
            label.textContent = c.label;
            row.appendChild(label);
            var ctrl = document.createElement('div');
            ctrl.className = 'color-picker-control';
            if (c.rgba) {
                var txt = document.createElement('input');
                txt.type = 'text';
                txt.className = 'customize-input color-text-input';
                txt.dataset.colorVar = c.var;
                txt.value = (st.colors[mode] && st.colors[mode][c.var]) || '';
                txt.placeholder = DEFAULT_COLORS[mode][c.var];
                ctrl.appendChild(txt);
            } else {
                var inp = document.createElement('input');
                inp.type = 'color';
                inp.className = 'color-input';
                inp.dataset.colorVar = c.var;
                var cur = (st.colors[mode] && st.colors[mode][c.var]) || DEFAULT_COLORS[mode][c.var];
                inp.value = toHexColor(cur);
                ctrl.appendChild(inp);
            }
            var reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'color-reset-btn';
            reset.dataset.action = 'reset-color';
            reset.dataset.colorVar = c.var;
            reset.dataset.scope = scopeName;
            reset.title = 'Reset';
            reset.innerHTML = '&#8617;';
            ctrl.appendChild(reset);
            row.appendChild(ctrl);
            grid.appendChild(row);
        });
    }

    function toHexColor(v) {
        // Best-effort: if it's already #hex, return; else try to convert.
        if (!v) return '#000000';
        if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
        if (/^#[0-9a-fA-F]{3}$/.test(v)) {
            return '#' + v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
        }
        // rgba/rgb or named → attempt via a temporary canvas/style trick
        var s = document.createElement('span');
        s.style.color = v;
        document.body.appendChild(s);
        var computed = getComputedStyle(s).color;
        document.body.removeChild(s);
        var m = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
            return '#' + (+m[1]).toString(16).padStart(2,'0')
                       + (+m[2]).toString(16).padStart(2,'0')
                       + (+m[3]).toString(16).padStart(2,'0');
        }
        return '#000000';
    }

    // ---------- CSRF ----------
    function getCSRF() {
        var m = document.cookie.match(/X-CSRF-Token=([^;]+)/);
        return m ? m[1] : '';
    }

    // ---------- Persistence ----------
    // Single batch POST to avoid the read-modify-write race that the old
    // 4-concurrent-fetch approach caused (last-write-wins clobbered css/colors).
    function saveAll(scopeName) {
        var st = getScope(scopeName);
        var payload = {
            colors: st.colors,
            css: st.css || '',
            font: st.font || '',
            font_size: st.fontSize,
        };
        return fetch('/api/save_appearance', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
            body: JSON.stringify(payload)
        }).then(function(r) { return r.json(); }).then(function() {
            SAVED_COLORS = JSON.parse(JSON.stringify(st.colors));
            SAVED_CSS = st.css || '';
            SAVED_FONT_FAMILY = st.font || '';
            SAVED_FONT_SIZE = st.fontSize;
        });
    }

    // ---------- AI generate CSS ----------
    // Fetched lazily on first AI tab open per scope. Cached after first load.
    var aiModels = null;
    var aiModelsLoading = false;
    var aiDefaultModel = pageData.aiModel || '';

    function loadAiModels(scopeName, selectEl) {
        if (aiModels) {
            populateModelSelect(selectEl, aiModels);
            return;
        }
        if (aiModelsLoading) return;
        aiModelsLoading = true;
        fetch('/ai/api/models', {headers: {'X-CSRFToken': getCSRF()}})
            .then(function(r) { return r.json(); })
            .then(function(data) {
                aiModels = (data && data.models) || [];
                aiModelsLoading = false;
                populateModelSelect(selectEl, aiModels);
            }).catch(function() { aiModelsLoading = false; });
    }

    function populateModelSelect(selectEl, models) {
        if (!selectEl || !models || !models.length) return;
        var prev = selectEl.value || aiDefaultModel || '';
        selectEl.innerHTML = '';
        models.forEach(function(m) {
            var opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            if (m === prev) opt.selected = true;
            selectEl.appendChild(opt);
        });
        if (!selectEl.value && aiDefaultModel) selectEl.value = aiDefaultModel;
    }

    function aiGenerate(scopeName) {
        var promptEl = document.getElementById('ai-css-prompt-' + scopeName);
        var resultEl = document.getElementById('ai-css-result-' + scopeName);
        var statusEl = document.getElementById('ai-css-status-' + scopeName);
        var outputEl = document.getElementById('ai-css-output-' + scopeName);
        var applyBtn = document.getElementById('apply-ai-css-btn-' + scopeName);
        var modelEl = document.getElementById('ai-css-model-' + scopeName);
        var includeCssEl = document.getElementById('ai-css-include-css-' + scopeName);
        var includeColorsEl = document.getElementById('ai-css-include-colors-' + scopeName);
        if (!promptEl || !resultEl || !statusEl || !outputEl || !applyBtn) return;
        var prompt = promptEl.value.trim();
        if (!prompt) { statusEl.textContent = 'Please enter a prompt.'; resultEl.hidden = false; return; }
        if (!AI_ENABLED) { statusEl.textContent = 'AI is not enabled.'; resultEl.hidden = false; return; }
        statusEl.textContent = 'Generating...';
        resultEl.hidden = false;
        outputEl.value = '';
        applyBtn.disabled = true;
        var st = getScope(scopeName);
        var payload = {
            prompt: prompt,
            theme: st.activeColorTheme,
            include_current_css: !!(includeCssEl && includeCssEl.checked),
            include_color_overrides: !!(includeColorsEl && includeColorsEl.checked),
        };
        if (modelEl && modelEl.value) payload.model = modelEl.value;
        fetch('/ai/api/generate_css', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRF()},
            body: JSON.stringify(payload)
        }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.error) {
                statusEl.textContent = data.error;
                statusEl.className = 'ai-css-status ai-css-error';
                return;
            }
            outputEl.value = data.css || '';
            if (data.valid) {
                statusEl.textContent = 'Generated. Review and copy/apply.';
                statusEl.className = 'ai-css-status ai-css-ok';
                applyBtn.disabled = false;
            } else {
                statusEl.textContent = 'Generated, but may contain invalid CSS. Review carefully.';
                statusEl.className = 'ai-css-status ai-css-warn';
                applyBtn.disabled = false;
            }
        }).catch(function(err) {
            statusEl.textContent = 'Request failed: ' + err.message;
            statusEl.className = 'ai-css-status ai-css-error';
        });
    }

    function copyAiCss(scopeName) {
        var outputEl = document.getElementById('ai-css-output-' + scopeName);
        if (!outputEl) return;
        outputEl.select();
        try { document.execCommand('copy'); } catch(e) {}
        if (navigator.clipboard) {
            navigator.clipboard.writeText(outputEl.value).catch(function(){});
        }
    }

    function applyAiCss(scopeName) {
        var outputEl = document.getElementById('ai-css-output-' + scopeName);
        var cssTabBtn = document.querySelector('[data-action="customize-tab"][data-scope="' + scopeName + '"][data-tab="css"]');
        var cssInput = document.getElementById('cust-css-input-' + scopeName);
        if (!outputEl || !cssInput) return;
        var gen = outputEl.value.trim();
        if (!gen) return;
        var modeEl = document.querySelector('.ai-css-apply-mode[name="ai-css-apply-mode-' + scopeName + '"]:checked');
        var mode = modeEl ? modeEl.value : 'append';
        // Switch to CSS tab
        if (cssTabBtn) cssTabBtn.click();
        var existing = cssInput.value.trim();
        if (mode === 'replace') {
            cssInput.value = '/* AI generated */\n' + gen;
        } else {
            cssInput.value = existing ? existing + '\n\n/* AI generated */\n' + gen : '/* AI generated */\n' + gen;
        }
        // Live apply
        var st = getScope(scopeName);
        st.css = cssInput.value;
        applyCssLive(scopeName);
    }

    // ---------- Tab switching within a scope ----------
    function switchTab(scopeName, tab) {
        var scope = document.querySelector('[data-customize-scope="' + scopeName + '"]');
        if (!scope) return;
        scope.querySelectorAll('.customize-tab-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.tab === tab);
        });
        scope.querySelectorAll('.customize-panel').forEach(function(p) {
            var name = p.dataset.customizePanel;
            p.hidden = (name !== scopeName + '-' + tab);
        });
        if (tab === 'ai' && AI_ENABLED) {
            var selectEl = document.getElementById('ai-css-model-' + scopeName);
            if (selectEl) loadAiModels(scopeName, selectEl);
        }
    }

    function switchColorTheme(scopeName, theme) {
        var st = getScope(scopeName);
        st.activeColorTheme = theme;
        var scope = document.querySelector('[data-customize-scope="' + scopeName + '"]');
        if (!scope) return;
        scope.querySelectorAll('.customize-theme-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.theme === theme);
        });
        buildColorGrid(scopeName);
    }

    // ---------- Reset helpers ----------
    function resetColor(scopeName, varName) {
        var st = getScope(scopeName);
        var mode = st.activeColorTheme;
        if (st.colors[mode]) delete st.colors[mode][varName];
        applyColorsLive(scopeName);
        buildColorGrid(scopeName);
        clearActivePreset();
    }

    function resetAllColors(scopeName) {
        var st = getScope(scopeName);
        var mode = st.activeColorTheme;
        if (st.colors[mode]) {
            delete st.colors[mode];
        }
        applyColorsLive(scopeName);
        buildColorGrid(scopeName);
        clearActivePreset();
    }

    // ---------- Modal open/close ----------
    function openModal() {
        var o = document.getElementById('customize-overlay');
        if (!o) return;
        initScope('modal');
        populateFields('modal');
        o.classList.add('visible');
    }
    function closeModal() {
        var o = document.getElementById('customize-overlay');
        if (!o) return;
        o.classList.remove('visible');
        revertAll('modal');
    }

    // ---------- Populate UI fields from scope state ----------
    function populateFields(scopeName) {
        var st = getScope(scopeName);
        // Presets
        buildPresetGrid(scopeName);
        // Animations checkbox
        var animCb = document.getElementById('theme-animations-' + scopeName);
        if (animCb) animCb.checked = ANIMATIONS_ENABLED;
        // Colors
        buildColorGrid(scopeName);
        // Theme subtab
        var scope = document.querySelector('[data-customize-scope="' + scopeName + '"]');
        if (scope) {
            scope.querySelectorAll('.customize-theme-btn').forEach(function(b) {
                b.classList.toggle('active', b.dataset.theme === st.activeColorTheme);
            });
        }
        // Font
        var ff = document.getElementById('cust-font-family-' + scopeName);
        if (ff) ff.value = st.font || '';
        var fs = document.getElementById('cust-font-size-' + scopeName);
        if (fs) fs.value = st.fontSize;
        // CSS
        var css = document.getElementById('cust-css-input-' + scopeName);
        if (css) css.value = st.css || '';
        // Reset AI tab
        var aiResult = document.getElementById('ai-css-result-' + scopeName);
        if (aiResult) aiResult.hidden = true;
        var aiPrompt = document.getElementById('ai-css-prompt-' + scopeName);
        if (aiPrompt) aiPrompt.value = '';
    }

    // ---------- Save handler ----------
    // Flush pending DOM values into the scope state before persisting. The
    // input listener debounces CSS textarea updates (300ms), so if the user
    // types and immediately clicks Save the scope state would be stale. This
    // reads the live values from the DOM so Save always persists what's on
    // screen.
    function flushScope(scopeName) {
        var st = getScope(scopeName);
        var cssEl = document.getElementById('cust-css-input-' + scopeName);
        if (cssEl) st.css = cssEl.value;
        var ffEl = document.getElementById('cust-font-family-' + scopeName);
        if (ffEl) st.font = ffEl.value;
        var fsEl = document.getElementById('cust-font-size-' + scopeName);
        if (fsEl) {
            var v = parseInt(fsEl.value, 10);
            if (v >= 8 && v <= 40) st.fontSize = v;
        }
        // Colors are updated synchronously on input (no debounce), so st.colors
        // is already current — no flush needed.
    }

    function handleSave(scopeName) {
        flushScope(scopeName);
        saveAll(scopeName).then(function() {
            applyColorsLive(scopeName);
            applyCssLive(scopeName);
            applyFontLive(scopeName);
            if (scopeName === 'modal') closeModal();
            showStatus(scopeName, 'Saved');
        }).catch(function() {
            showStatus(scopeName, 'Save failed');
        });
    }
    function showStatus(scopeName, msg) {
        if (scopeName === 'modal') {
            var footer = document.querySelector('#customize-overlay .customize-modal-footer');
            if (footer) {
                var span = footer.querySelector('.customize-save-status');
                if (!span) {
                    span = document.createElement('span');
                    span.className = 'customize-save-status';
                    footer.insertBefore(span, footer.firstChild);
                }
                span.textContent = msg;
                setTimeout(function() { if (span) span.textContent = ''; }, 2000);
            }
        } else {
            // Settings scope: show a temporary status next to the Save button
            var saveBtn = document.querySelector('[data-action="save-customize"][data-scope="' + scopeName + '"]');
            if (saveBtn && saveBtn.parentElement) {
                var span2 = saveBtn.parentElement.querySelector('.customize-save-status');
                if (!span2) {
                    span2 = document.createElement('span');
                    span2.className = 'customize-save-status';
                    saveBtn.parentElement.insertBefore(span2, saveBtn);
                }
                span2.textContent = msg;
                setTimeout(function() { if (span2) span2.textContent = ''; }, 2000);
            }
        }
    }

    // ---------- Delegated listeners ----------
    document.addEventListener('click', function(e) {
        var el = e.target.closest ? e.target.closest('[data-action]') : _findActionCompat(e.target);
        if (!el || !el.dataset) return;
        var action = el.dataset.action;
        var scope = el.dataset.scope;
        switch (action) {
            case 'open-customize': openModal(); break;
            case 'close-customize-modal': closeModal(); break;
            case 'customize-tab':
                if (scope) switchTab(scope, el.dataset.tab);
                break;
            case 'customize-color-theme':
                if (scope) switchColorTheme(scope, el.dataset.theme);
                break;
            case 'reset-color':
                if (scope) resetColor(scope, el.dataset.colorVar);
                break;
            case 'reset-all-colors':
                if (scope) resetAllColors(scope);
                break;
            case 'apply-custom-css': {
                if (!scope) break;
                var cssEl = document.getElementById('cust-css-input-' + scope);
                if (cssEl) {
                    getScope(scope).css = cssEl.value;
                    applyCssLive(scope);
                }
                break;
            }
            case 'ai-generate-css':
                if (scope) aiGenerate(scope);
                break;
            case 'copy-ai-css':
                if (scope) copyAiCss(scope);
                break;
            case 'apply-ai-css':
                if (scope) applyAiCss(scope);
                break;
            case 'save-customize':
                if (scope) handleSave(scope);
                break;
            case 'apply-preset':
                if (scope) applyPreset(scope, el.dataset.preset);
                break;
            case 'toggle-theme-animations':
                if (scope) toggleAnimations(scope, el.checked);
                break;
        }
    });

    // Live input/change for color + font fields (scoped by data-customize-scope)
    document.addEventListener('input', function(e) {
        var el = e.target;
        if (!el.dataset) return;
        var scope = _scopeOf(el);
        if (!scope) return;
        // Color inputs (type=color)
        if (el.type === 'color' && el.dataset.colorVar) {
            var st = getScope(scope);
            var mode = st.activeColorTheme;
            if (!st.colors[mode]) st.colors[mode] = {};
            st.colors[mode][el.dataset.colorVar] = el.value;
            applyColorsLive(scope);
            clearActivePreset();
            return;
        }
        // Color text inputs (rgba vars)
        if (el.classList && el.classList.contains('color-text-input') && el.dataset.colorVar) {
            var st2 = getScope(scope);
            var mode2 = st2.activeColorTheme;
            if (!st2.colors[mode2]) st2.colors[mode2] = {};
            var v = el.value.trim();
            if (v) st2.colors[mode2][el.dataset.colorVar] = v;
            else delete st2.colors[mode2][el.dataset.colorVar];
            applyColorsLive(scope);
            clearActivePreset();
            return;
        }
        // Custom CSS textarea (debounced)
        if (el.id === 'cust-css-input-' + scope) {
            clearTimeout(el._debounce);
            el._debounce = setTimeout(function() {
                getScope(scope).css = el.value;
                applyCssLive(scope);
                clearActivePreset();
            }, 300);
            return;
        }
        // Font family
        if (el.id === 'cust-font-family-' + scope) {
            getScope(scope).font = el.value;
            applyFontLive(scope);
            clearActivePreset();
            return;
        }
    });
    document.addEventListener('change', function(e) {
        var el = e.target;
        if (!el.dataset) return;
        var scope = _scopeOf(el);
        if (!scope) return;
        if (el.id === 'cust-font-size-' + scope) {
            var v = parseInt(el.value, 10);
            if (v >= 8 && v <= 40) {
                getScope(scope).fontSize = v;
                applyFontLive(scope);
                clearActivePreset();
            }
        }
    });

    function _scopeOf(el) {
        var wrap = el.closest ? el.closest('[data-customize-scope]') : null;
        return wrap ? wrap.dataset.customizeScope : null;
    }
    function _findActionCompat(el) {
        while (el && el !== document.body) {
            if (el.dataset && el.dataset.action) return el;
            el = el.parentElement;
        }
        return null;
    }

    // Esc to close modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var o = document.getElementById('customize-overlay');
            if (o && o.classList.contains('visible')) { e.preventDefault(); closeModal(); }
        }
    });

    // ---------- Init ----------
    // On the settings page there's no modal; the "settings" scope is always
    // present in the DOM (inside the Customize tab). Initialize it.
    function initSettingsScope() {
        if (document.querySelector('[data-customize-scope="settings"]')) {
            initScope('settings');
            populateFields('settings');
        }
    }
    initSettingsScope();

    // Expose a refresh hook for SPA fragment swaps (settings-view.js injects
    // the Customize tab after customize.js has already loaded). Without this
    // the preset grid / color grid stay empty until a full page reload.
    window.FlaskyCustomize = window.FlaskyCustomize || {};
    window.FlaskyCustomize.refresh = function(scopeName) {
        scopeName = scopeName || 'settings';
        if (document.querySelector('[data-customize-scope="' + scopeName + '"]')) {
            initScope(scopeName);
            populateFields(scopeName);
        }
    };
    window.FlaskyCustomize.refreshSettings = function() {
        initSettingsScope();
    };
})();
