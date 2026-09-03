"""One-click theme presets.

Each preset is a named bundle of {dark_mode, font, font_size, colors, custom_css}
applied through the existing customize machinery (custom_colors / custom_css /
font / font_size / dark_mode settings). Applying a preset just pre-fills those
same fields — the user can keep tweaking afterward. "Classic" clears all
overrides and reverts to the app.css defaults.

Palettes define BOTH dark and light modes so toggling stays coherent. Animated
presets ship a self-contained custom_css snippet (scoped keyframes, no global
selectors) that respects prefers-reduced-motion. Preset CSS is injected into a
<style> tag the same way user-pasted custom_css is, so no new XSS surface is
introduced; snippets are kept free of </style> and <script>.
"""
from dataclasses import dataclass, field
from typing import Optional

@dataclass(frozen=True)
class ThemePreset:
    id: str
    name: str
    vibe: str
    dark_mode: Optional[bool]
    font: str
    font_size: int
    colors_dark: dict
    colors_light: dict
    custom_css: str = ""

_ANIM_REDUCE = (
    "@media (prefers-reduced-motion: reduce){"
    "[data-flasky-anim]{animation:none!important;}"
    "}"
)

_PRESETS = [
    ThemePreset(
        id="classic",
        name="Classic",
        vibe="Default",
        dark_mode=None,
        font="",
        font_size=16,
        colors_dark={},
        colors_light={},
        custom_css="",
    ),
    ThemePreset(
        id="midnight",
        name="Midnight",
        vibe="Classy dark",
        dark_mode=True,
        font="",
        font_size=16,
        colors_dark={
            "--bg-primary": "#16161e", "--bg-secondary": "#1c1c26",
            "--bg-sidebar": "#101018", "--bg-input": "#1a1a23",
            "--text-primary": "#dde1f2",
            "--text-secondary": "#b6bcd2", "--text-muted": "#6d7288",
            "--accent": "#a5b4fc", "--accent-hover": "#c4b5fd",
            "--border": "rgba(255,255,255,0.07)",
            "--border-light": "rgba(255,255,255,0.13)",
            "--accent-dim": "rgba(165,180,252,0.12)",
            "--bg-hover": "rgba(255,255,255,0.055)",
            "--bg-active": "rgba(255,255,255,0.09)",
            "--green": "#86d69c", "--red": "#f28ba4",
            "--yellow": "#f2d99c",
        },
        colors_light={
            "--bg-primary": "#faf9f7", "--bg-secondary": "#f2f0ec",
            "--bg-sidebar": "#e9e7e2", "--bg-input": "#ffffff",
            "--text-primary": "#211f26",
            "--text-secondary": "#3d3a45", "--text-muted": "#6e6a78",
            "--accent": "#5b5bd6", "--accent-hover": "#7c3aed",
            "--border": "rgba(33,31,38,0.10)",
            "--border-light": "rgba(33,31,38,0.16)",
            "--accent-dim": "rgba(91,91,214,0.12)",
            "--bg-hover": "rgba(33,31,38,0.06)",
            "--bg-active": "rgba(33,31,38,0.10)",
            "--green": "#2f8a4c", "--red": "#d1344b",
            "--yellow": "#b97d10",
        },
        custom_css="",
    ),
    ThemePreset(
        id="tokyo-neon",
        name="Tokyo Neon",
        vibe="Bold + animated",
        dark_mode=True,
        font="'JetBrains Mono', 'Fira Code', monospace",
        font_size=15,
        colors_dark={
            "--bg-primary": "#0d0221", "--bg-secondary": "#10042b",
            "--bg-sidebar": "#08011a", "--bg-input": "#0d0221",
            "--text-primary": "#e0e0ff",
            "--text-secondary": "#9d8df1", "--text-muted": "#5a4e8c",
            "--accent": "#ff2e88", "--accent-hover": "#00f0ff",
            "--border": "rgba(255,46,136,0.15)",
            "--border-light": "rgba(0,240,255,0.25)",
            "--accent-dim": "rgba(255,46,136,0.15)",
            "--bg-hover": "rgba(255,46,136,0.08)",
            "--bg-active": "rgba(0,240,255,0.12)",
            "--green": "#00ff9f", "--red": "#ff3860",
            "--yellow": "#ffea00",
        },
        colors_light={
            "--bg-primary": "#f5f0ff", "--bg-secondary": "#ebe0ff",
            "--bg-sidebar": "#e0d4ff", "--bg-input": "#ffffff",
            "--text-primary": "#2d0a4e",
            "--text-secondary": "#4a1a6e", "--text-muted": "#7a5a9e",
            "--accent": "#d600a0", "--accent-hover": "#0070d6",
            "--border": "rgba(214,0,160,0.15)",
            "--border-light": "rgba(0,112,214,0.25)",
            "--accent-dim": "rgba(214,0,160,0.14)",
            "--bg-hover": "rgba(214,0,160,0.06)",
            "--bg-active": "rgba(0,112,214,0.10)",
            "--green": "#00805a", "--red": "#c4003a",
            "--yellow": "#a06800",
        },
        custom_css=(
            "/* Tokyo Neon — animated accent glow */\n"
            "@keyframes flasky-neon-pulse{"
            "0%,100%{box-shadow:0 0 0 0 rgba(255,46,136,0)}"
            "50%{box-shadow:0 0 8px 1px rgba(255,46,136,0.4)}"
            "}\n"
            "@keyframes flasky-neon-scan{"
            "0%{transform:translateX(-100%)}100%{transform:translateX(100%)}"
            "}\n"
            ".toolbar button:focus,.sidebar-header button:focus{"
            "animation:flasky-neon-pulse 3s ease-in-out infinite"
            "}\n"
            ".toolbar{position:relative;overflow:hidden}\n"
            ".toolbar::after{"
            "content:'';position:absolute;left:0;right:0;bottom:0;height:1px;"
            "background:linear-gradient(90deg,transparent,rgba(0,240,255,0.6),transparent);"
            "animation:flasky-neon-scan 5s linear infinite"
            "}\n" + _ANIM_REDUCE
        ),
    ),
    ThemePreset(
        id="solar-dawn",
        name="Solar Dawn",
        vibe="Warm classy",
        dark_mode=False,
        font="Georgia, 'Times New Roman', serif",
        font_size=16,
        colors_dark={
            "--bg-primary": "#2b2620", "--bg-secondary": "#241f1a",
            "--bg-sidebar": "#1e1915", "--bg-input": "#2b2620",
            "--text-primary": "#eee6d3",
            "--text-secondary": "#c8b893", "--text-muted": "#8a7a5e",
            "--accent": "#e8a87c", "--accent-hover": "#f0b890",
            "--border": "rgba(238,230,211,0.08)",
            "--border-light": "rgba(238,230,211,0.15)",
            "--accent-dim": "rgba(232,168,124,0.15)",
            "--bg-hover": "rgba(238,230,211,0.05)",
            "--bg-active": "rgba(238,230,211,0.08)",
            "--green": "#b5d980", "--red": "#e07070",
            "--yellow": "#f0d080",
        },
        colors_light={
            "--bg-primary": "#fdf6e3", "--bg-secondary": "#f5ecd0",
            "--bg-sidebar": "#eee3c4", "--bg-input": "#ffffff",
            "--text-primary": "#3b3025",
            "--text-secondary": "#5a4a3a", "--text-muted": "#8a7a60",
            "--accent": "#cb7e3c", "--accent-hover": "#a86520",
            "--border": "rgba(59,48,37,0.10)",
            "--border-light": "rgba(59,48,37,0.18)",
            "--accent-dim": "rgba(203,126,60,0.14)",
            "--bg-hover": "rgba(59,48,37,0.05)",
            "--bg-active": "rgba(59,48,37,0.10)",
            "--green": "#5a8030", "--red": "#b03030",
            "--yellow": "#a06820",
        },
        custom_css="",
    ),
    ThemePreset(
        id="nordic-frost",
        name="Nordic Frost",
        vibe="Cool calm",
        dark_mode=True,
        font="",
        font_size=15,
        colors_dark={
            "--bg-primary": "#2e3440", "--bg-secondary": "#272c36",
            "--bg-sidebar": "#21262e", "--bg-input": "#2e3440",
            "--text-primary": "#e5e9f0",
            "--text-secondary": "#c1cce0", "--text-muted": "#6b7280",
            "--accent": "#88c0d0", "--accent-hover": "#81a1c1",
            "--border": "rgba(229,233,240,0.06)",
            "--border-light": "rgba(229,233,240,0.1)",
            "--accent-dim": "rgba(136,192,208,0.12)",
            "--bg-hover": "rgba(229,233,240,0.04)",
            "--bg-active": "rgba(136,192,208,0.10)",
            "--green": "#a3be8c", "--red": "#bf616a",
            "--yellow": "#ebcb8b",
        },
        colors_light={
            "--bg-primary": "#f0f4f8", "--bg-secondary": "#e6ecf2",
            "--bg-sidebar": "#dde4ec", "--bg-input": "#ffffff",
            "--text-primary": "#2e3440",
            "--text-secondary": "#44546a", "--text-muted": "#738090",
            "--accent": "#5e81ac", "--accent-hover": "#4c6e8e",
            "--border": "rgba(46,52,64,0.10)",
            "--border-light": "rgba(46,52,64,0.16)",
            "--accent-dim": "rgba(94,129,172,0.14)",
            "--bg-hover": "rgba(46,52,64,0.05)",
            "--bg-active": "rgba(94,129,172,0.10)",
            "--green": "#3f7a3f", "--red": "#b04040",
            "--yellow": "#a07020",
        },
        custom_css="",
    ),
    ThemePreset(
        id="rose-quartz",
        name="Rose Quartz",
        vibe="Soft elegant",
        dark_mode=False,
        font="'Segoe UI', system-ui, sans-serif",
        font_size=16,
        colors_dark={
            "--bg-primary": "#2a2329", "--bg-secondary": "#221c21",
            "--bg-sidebar": "#1b161a", "--bg-input": "#2a2329",
            "--text-primary": "#f5e8ee",
            "--text-secondary": "#d4b8c4", "--text-muted": "#8a7a82",
            "--accent": "#e8a0bf", "--accent-hover": "#d080a0",
            "--border": "rgba(245,232,238,0.06)",
            "--border-light": "rgba(245,232,238,0.1)",
            "--accent-dim": "rgba(232,160,191,0.12)",
            "--bg-hover": "rgba(245,232,238,0.04)",
            "--bg-active": "rgba(232,160,191,0.10)",
            "--green": "#a8c890", "--red": "#e08090",
            "--yellow": "#e8c890",
        },
        colors_light={
            "--bg-primary": "#fdf5f8", "--bg-secondary": "#f7ecf2",
            "--bg-sidebar": "#f0e0e8", "--bg-input": "#ffffff",
            "--text-primary": "#3a2832",
            "--text-secondary": "#5a4050", "--text-muted": "#8a7080",
            "--accent": "#c06090", "--accent-hover": "#a04070",
            "--border": "rgba(58,40,50,0.10)",
            "--border-light": "rgba(58,40,50,0.16)",
            "--accent-dim": "rgba(192,96,144,0.12)",
            "--bg-hover": "rgba(58,40,50,0.05)",
            "--bg-active": "rgba(192,96,144,0.10)",
            "--green": "#5a8060", "--red": "#b04060",
            "--yellow": "#a08040",
        },
        custom_css="",
    ),
    ThemePreset(
        id="forest-moss",
        name="Forest Moss",
        vibe="Earthy",
        dark_mode=True,
        font="",
        font_size=16,
        colors_dark={
            "--bg-primary": "#1c2418", "--bg-secondary": "#161e13",
            "--bg-sidebar": "#101709", "--bg-input": "#1c2418",
            "--text-primary": "#d8e8c8",
            "--text-secondary": "#b0c098", "--text-muted": "#6a7a5a",
            "--accent": "#8fa860", "--accent-hover": "#a8c878",
            "--border": "rgba(216,232,200,0.06)",
            "--border-light": "rgba(216,232,200,0.1)",
            "--accent-dim": "rgba(143,168,96,0.12)",
            "--bg-hover": "rgba(216,232,200,0.04)",
            "--bg-active": "rgba(143,168,96,0.10)",
            "--green": "#90c060", "--red": "#c06060",
            "--yellow": "#d8c060",
        },
        colors_light={
            "--bg-primary": "#f4f6ee", "--bg-secondary": "#eaeede",
            "--bg-sidebar": "#dde4d0", "--bg-input": "#ffffff",
            "--text-primary": "#2a3020",
            "--text-secondary": "#444a34", "--text-muted": "#6a7060",
            "--accent": "#506e30", "--accent-hover": "#3a5020",
            "--border": "rgba(42,48,32,0.10)",
            "--border-light": "rgba(42,48,32,0.16)",
            "--accent-dim": "rgba(80,110,48,0.14)",
            "--bg-hover": "rgba(42,48,32,0.05)",
            "--bg-active": "rgba(80,110,48,0.10)",
            "--green": "#3a7030", "--red": "#a03030",
            "--yellow": "#806020",
        },
        custom_css="",
    ),
    ThemePreset(
        id="sunset-ember",
        name="Sunset Ember",
        vibe="Bold + animated",
        dark_mode=True,
        font="",
        font_size=16,
        colors_dark={
            "--bg-primary": "#1a0f0a", "--bg-secondary": "#241510",
            "--bg-sidebar": "#120906", "--bg-input": "#1a0f0a",
            "--text-primary": "#ffe8d0",
            "--text-secondary": "#e8a878", "--text-muted": "#8a6048",
            "--accent": "#ff6a3d", "--accent-hover": "#ff9040",
            "--border": "rgba(255,106,61,0.12)",
            "--border-light": "rgba(255,144,64,0.2)",
            "--accent-dim": "rgba(255,106,61,0.15)",
            "--bg-hover": "rgba(255,106,61,0.06)",
            "--bg-active": "rgba(255,144,64,0.10)",
            "--green": "#a0d060", "--red": "#ff4060",
            "--yellow": "#ffc040",
        },
        colors_light={
            "--bg-primary": "#fff5ed", "--bg-secondary": "#ffead8",
            "--bg-sidebar": "#ffdcc0", "--bg-input": "#ffffff",
            "--text-primary": "#2a1810",
            "--text-secondary": "#4a2e20", "--text-muted": "#806048",
            "--accent": "#e05020", "--accent-hover": "#c03010",
            "--border": "rgba(42,24,16,0.10)",
            "--border-light": "rgba(42,24,16,0.18)",
            "--accent-dim": "rgba(224,80,32,0.14)",
            "--bg-hover": "rgba(42,24,16,0.05)",
            "--bg-active": "rgba(224,80,32,0.10)",
            "--green": "#408030", "--red": "#c03030",
            "--yellow": "#a06010",
        },
        custom_css=(
            "/* Sunset Ember — animated gradient accent */\n"
            "@keyframes flasky-ember-flow{"
            "0%{background-position:0% 50%}"
            "50%{background-position:100% 50%}"
            "100%{background-position:0% 50%}"
            "}\n"
            ".toolbar{"
            "background:linear-gradient(90deg,rgba(255,106,61,0.5),rgba(255,144,64,0.5),"
            "rgba(255,192,64,0.5),rgba(255,106,61,0.5));"
            "background-size:300% 100%;"
            "animation:flasky-ember-flow 12s ease infinite;"
            "}\n" + _ANIM_REDUCE
        ),
    ),
    ThemePreset(
        id="graphite",
        name="Graphite",
        vibe="Monochrome classy",
        dark_mode=True,
        font="system-ui, -apple-system, sans-serif",
        font_size=15,
        colors_dark={
            "--bg-primary": "#1a1a1a", "--bg-secondary": "#141414",
            "--bg-sidebar": "#0f0f0f", "--bg-input": "#1a1a1a",
            "--text-primary": "#e8e8e8",
            "--text-secondary": "#b0b0b0", "--text-muted": "#606060",
            "--accent": "#a0a0a0", "--accent-hover": "#c0c0c0",
            "--border": "rgba(255,255,255,0.06)",
            "--border-light": "rgba(255,255,255,0.1)",
            "--accent-dim": "rgba(160,160,160,0.12)",
            "--bg-hover": "rgba(255,255,255,0.05)",
            "--bg-active": "rgba(255,255,255,0.08)",
            "--green": "#909090", "--red": "#909090",
            "--yellow": "#909090",
        },
        colors_light={
            "--bg-primary": "#fafafa", "--bg-secondary": "#f0f0f0",
            "--bg-sidebar": "#e8e8e8", "--bg-input": "#ffffff",
            "--text-primary": "#1a1a1a",
            "--text-secondary": "#3a3a3a", "--text-muted": "#808080",
            "--accent": "#505050", "--accent-hover": "#303030",
            "--border": "rgba(0,0,0,0.10)",
            "--border-light": "rgba(0,0,0,0.16)",
            "--accent-dim": "rgba(80,80,80,0.14)",
            "--bg-hover": "rgba(0,0,0,0.05)",
            "--bg-active": "rgba(0,0,0,0.10)",
            "--green": "#606060", "--red": "#606060",
            "--yellow": "#606060",
        },
        custom_css="",
    ),
    ThemePreset(
        id="synthwave",
        name="Synthwave",
        vibe="Bold animated retro",
        dark_mode=True,
        font="'JetBrains Mono', monospace",
        font_size=15,
        colors_dark={
            "--bg-primary": "#0f0a1e", "--bg-secondary": "#160f2a",
            "--bg-sidebar": "#0a0617", "--bg-input": "#0f0a1e",
            "--text-primary": "#f0e6ff",
            "--text-secondary": "#c8a0ff", "--text-muted": "#7a5a9e",
            "--accent": "#ff006e", "--accent-hover": "#8338ec",
            "--border": "rgba(255,0,110,0.12)",
            "--border-light": "rgba(131,56,236,0.2)",
            "--accent-dim": "rgba(255,0,110,0.15)",
            "--bg-hover": "rgba(131,56,236,0.08)",
            "--bg-active": "rgba(255,0,110,0.12)",
            "--green": "#3aff8c", "--red": "#ff3860",
            "--yellow": "#ffea00",
        },
        colors_light={
            "--bg-primary": "#f0e8ff", "--bg-secondary": "#e4d4ff",
            "--bg-sidebar": "#d8c4ff", "--bg-input": "#ffffff",
            "--text-primary": "#2a0a4e",
            "--text-secondary": "#4a1a6e", "--text-muted": "#7a5a9e",
            "--accent": "#d600a0", "--accent-hover": "#7030d6",
            "--border": "rgba(42,10,78,0.12)",
            "--border-light": "rgba(42,10,78,0.2)",
            "--accent-dim": "rgba(214,0,160,0.12)",
            "--bg-hover": "rgba(42,10,78,0.05)",
            "--bg-active": "rgba(214,0,160,0.10)",
            "--green": "#00805a", "--red": "#c4003a",
            "--yellow": "#a06800",
        },
        custom_css=(
            "/* Synthwave — animated grid + scanline overlay */\n"
            "@keyframes flasky-synth-grid{"
            "0%{background-position:0 0}100%{background-position:40px 40px}"
            "}\n"
            "@keyframes flasky-synth-scan{"
            "0%{top:0}100%{top:100%}"
            "}\n"
            "body::before{"
            "content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;"
            "background-image:"
            "linear-gradient(rgba(131,56,236,0.06) 1px,transparent 1px),"
            "linear-gradient(90deg,rgba(255,0,110,0.06) 1px,transparent 1px);"
            "background-size:40px 40px;"
            "animation:flasky-synth-grid 8s linear infinite"
            "}\n"
            "body::after{"
            "content:'';position:fixed;left:0;right:0;height:2px;"
            "background:linear-gradient(90deg,transparent,rgba(255,0,110,0.5),transparent);"
            "pointer-events:none;z-index:9998;opacity:0.4;"
            "animation:flasky-synth-scan 10s linear infinite"
            "}\n" + _ANIM_REDUCE
        ),
    ),
    ThemePreset(
        id="parchment",
        name="Parchment",
        vibe="Classy paper",
        dark_mode=False,
        font="Georgia, 'Times New Roman', serif",
        font_size=16,
        colors_dark={
            "--bg-primary": "#2a2520", "--bg-secondary": "#241f1a",
            "--bg-sidebar": "#1e1915", "--bg-input": "#2a2520",
            "--text-primary": "#e8dcc8",
            "--text-secondary": "#c0b098", "--text-muted": "#8a7a60",
            "--accent": "#a08050", "--accent-hover": "#c0a060",
            "--border": "rgba(232,220,200,0.08)",
            "--border-light": "rgba(232,220,200,0.15)",
            "--accent-dim": "rgba(160,128,80,0.15)",
            "--bg-hover": "rgba(232,220,200,0.05)",
            "--bg-active": "rgba(232,220,200,0.08)",
            "--green": "#90a060", "--red": "#b06040",
            "--yellow": "#c0a060",
        },
        colors_light={
            "--bg-primary": "#f5ecd7", "--bg-secondary": "#ede0c0",
            "--bg-sidebar": "#e4d4a8", "--bg-input": "#ffffff",
            "--text-primary": "#3a2a18",
            "--text-secondary": "#5a4028", "--text-muted": "#8a7048",
            "--accent": "#8a5a2a", "--accent-hover": "#6a401a",
            "--border": "rgba(58,42,24,0.12)",
            "--border-light": "rgba(58,42,24,0.2)",
            "--accent-dim": "rgba(138,90,42,0.14)",
            "--bg-hover": "rgba(58,42,24,0.05)",
            "--bg-active": "rgba(58,42,24,0.10)",
            "--green": "#4a6a30", "--red": "#a04030",
            "--yellow": "#a06820",
        },
        custom_css=(
            "/* Parchment — paper texture overlay */\n"
            "body::before{"
            "content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;"
            "background-image:"
            "radial-gradient(circle at 20% 30%,rgba(138,90,42,0.08) 0%,transparent 50%),"
            "radial-gradient(circle at 80% 70%,rgba(138,90,42,0.08) 0%,transparent 50%),"
            "radial-gradient(circle at 50% 50%,rgba(138,90,42,0.05) 0%,transparent 70%)"
            "}\n"
            ".editor-content{font-feature-settings:\"liga\" 1,\"kern\" 1}"
        ),
    ),
    ThemePreset(
        id="cyberpunk",
        name="Cyberpunk",
        vibe="Videogame + glitch",
        dark_mode=True,
        font="'JetBrains Mono', monospace",
        font_size=15,
        colors_dark={
            "--bg-primary": "#0a0a0f", "--bg-secondary": "#12121a",
            "--bg-sidebar": "#06060a", "--bg-input": "#0a0a0f",
            "--text-primary": "#fcee0c",
            "--text-secondary": "#c0c0d0", "--text-muted": "#5a5a6e",
            "--accent": "#fcee0c", "--accent-hover": "#00f0ff",
            "--border": "rgba(252,238,12,0.1)",
            "--border-light": "rgba(0,240,255,0.2)",
            "--accent-dim": "rgba(252,238,12,0.12)",
            "--bg-hover": "rgba(252,238,12,0.06)",
            "--bg-active": "rgba(0,240,255,0.1)",
            "--green": "#00ff88", "--red": "#ff003c",
            "--yellow": "#fcee0c",
        },
        colors_light={
            "--bg-primary": "#f8f8f0", "--bg-secondary": "#eeee00",
            "--bg-sidebar": "#e0e0d0", "--bg-input": "#ffffff",
            "--text-primary": "#0a0a0f",
            "--text-secondary": "#3a3a4e", "--text-muted": "#808090",
            "--accent": "#e0b000", "--accent-hover": "#0090d0",
            "--border": "rgba(10,10,15,0.12)",
            "--border-light": "rgba(10,10,15,0.2)",
            "--accent-dim": "rgba(224,176,0,0.14)",
            "--bg-hover": "rgba(10,10,15,0.05)",
            "--bg-active": "rgba(224,176,0,0.10)",
            "--green": "#00805a", "--red": "#c00030",
            "--yellow": "#a08010",
        },
        custom_css=(
            "/* Cyberpunk — glitch flicker */\n"
            "@keyframes flasky-cp-glitch{"
            "0%,100%{opacity:1;transform:translateX(0)}"
            "20%{opacity:0.92;transform:translateX(-1px)}"
            "21%{opacity:1;transform:translateX(1px)}"
            "22%{transform:translateX(0)}"
            "40%{opacity:0.95;transform:translateX(-1px)}"
            "41%{opacity:1;transform:translateX(1px)}"
            "42%{transform:translateX(0)}"
            "}\n"
            ".editor-content h1,.editor-title{"
            "animation:flasky-cp-glitch 5s steps(1) infinite"
            "}\n"
            "@keyframes flasky-cp-scan{"
            "0%{top:-100%}100%{top:100%}"
            "}\n"
            "body::after{"
            "content:'';position:fixed;left:0;right:0;height:40%;"
            "background:linear-gradient(transparent,rgba(252,238,12,0.04),transparent);"
            "pointer-events:none;z-index:9998;"
            "animation:flasky-cp-scan 8s linear infinite"
            "}\n" + _ANIM_REDUCE
        ),
    ),
    ThemePreset(
        id="matrix",
        name="Matrix",
        vibe="Videogame + code rain",
        dark_mode=True,
        font="'JetBrains Mono', 'Courier New', monospace",
        font_size=15,
        colors_dark={
            "--bg-primary": "#000000", "--bg-secondary": "#030a03",
            "--bg-sidebar": "#000000", "--bg-input": "#000000",
            "--text-primary": "#00ff41",
            "--text-secondary": "#00cc33", "--text-muted": "#008822",
            "--accent": "#00ff41", "--accent-hover": "#33ff66",
            "--border": "rgba(0,255,65,0.1)",
            "--border-light": "rgba(0,255,65,0.2)",
            "--accent-dim": "rgba(0,255,65,0.12)",
            "--bg-hover": "rgba(0,255,65,0.06)",
            "--bg-active": "rgba(0,255,65,0.1)",
            "--green": "#00ff41", "--red": "#ff2040",
            "--yellow": "#ccff00",
        },
        colors_light={
            "--bg-primary": "#f0fff0", "--bg-secondary": "#e0ffe0",
            "--bg-sidebar": "#d0f0d0", "--bg-input": "#ffffff",
            "--text-primary": "#0a1a0a",
            "--text-secondary": "#2a4a2a", "--text-muted": "#5a7a5a",
            "--accent": "#008822", "--accent-hover": "#006611",
            "--border": "rgba(10,26,10,0.10)",
            "--border-light": "rgba(10,26,10,0.18)",
            "--accent-dim": "rgba(0,136,34,0.14)",
            "--bg-hover": "rgba(10,26,10,0.05)",
            "--bg-active": "rgba(0,136,34,0.10)",
            "--green": "#008822", "--red": "#c03030",
            "--yellow": "#808020",
        },
        custom_css=(
            "/* Matrix — falling code rain */\n"
            "@keyframes flasky-matrix-rain{"
            "0%{background-position:0 0}100%{background-position:0 -600px}"
            "}\n"
            "body::before{"
            "content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;"
            "background-image:"
            "repeating-linear-gradient(0deg,"
            "rgba(0,255,65,0.05) 0px,transparent 2px,"
            "rgba(0,255,65,0.05) 4px,transparent 6px,"
            "rgba(0,255,65,0.08) 8px,transparent 12px);"
            "animation:flasky-matrix-rain 10s linear infinite"
            "}\n" + _ANIM_REDUCE
        ),
    ),
    ThemePreset(
        id="retro-arcade",
        name="Retro Arcade",
        vibe="Videogame + CRT scanlines",
        dark_mode=True,
        font="'Press Start 2P', 'Courier New', monospace",
        font_size=14,
        colors_dark={
            "--bg-primary": "#1a0633", "--bg-secondary": "#240844",
            "--bg-sidebar": "#120422", "--bg-input": "#1a0633",
            "--text-primary": "#ff6ec7",
            "--text-secondary": "#c0a0e0", "--text-muted": "#7060a0",
            "--accent": "#ff6ec7", "--accent-hover": "#00ffff",
            "--border": "rgba(255,110,199,0.12)",
            "--border-light": "rgba(0,255,255,0.2)",
            "--accent-dim": "rgba(255,110,199,0.14)",
            "--bg-hover": "rgba(255,110,199,0.06)",
            "--bg-active": "rgba(0,255,255,0.1)",
            "--green": "#00ff7f", "--red": "#ff3060",
            "--yellow": "#ffcc00",
        },
        colors_light={
            "--bg-primary": "#f8f0ff", "--bg-secondary": "#f0e0ff",
            "--bg-sidebar": "#e8d4ff", "--bg-input": "#ffffff",
            "--text-primary": "#2a0a44",
            "--text-secondary": "#4a1a6e", "--text-muted": "#7a5a9e",
            "--accent": "#d620a0", "--accent-hover": "#0090d0",
            "--border": "rgba(42,10,68,0.12)",
            "--border-light": "rgba(42,10,68,0.2)",
            "--accent-dim": "rgba(214,32,160,0.12)",
            "--bg-hover": "rgba(42,10,68,0.05)",
            "--bg-active": "rgba(214,32,160,0.10)",
            "--green": "#00805a", "--red": "#c4003a",
            "--yellow": "#a06800",
        },
        custom_css=(
            "/* Retro Arcade — CRT scanlines + flicker */\n"
            "@keyframes flasky-arcade-flicker{"
            "0%,100%{opacity:1}50%{opacity:0.97}"
            "}\n"
            "body{animation:flasky-arcade-flicker 0.25s steps(1) infinite}\n"
            "body::before{"
            "content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;"
            "background:repeating-linear-gradient("
            "0deg,rgba(0,0,0,0.12) 0px,rgba(0,0,0,0.12) 1px,"
            "transparent 1px,transparent 3px)"
            "}\n"
            "body::after{"
            "content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;"
            "background:radial-gradient(ellipse at center,"
            "transparent 65%,rgba(26,6,51,0.3) 100%)"
            "}\n" + _ANIM_REDUCE
        ),
    ),
    ThemePreset(
        id="tron-grid",
        name="Tron Grid",
        vibe="Videogame + glowing grid",
        dark_mode=True,
        font="'Orbitron', 'JetBrains Mono', monospace",
        font_size=15,
        colors_dark={
            "--bg-primary": "#050510", "--bg-secondary": "#0a0a18",
            "--bg-sidebar": "#020208", "--bg-input": "#050510",
            "--text-primary": "#d0e0ff",
            "--text-secondary": "#80a0d0", "--text-muted": "#405070",
            "--accent": "#00d4ff", "--accent-hover": "#ff9900",
            "--border": "rgba(0,212,255,0.15)",
            "--border-light": "rgba(255,153,0,0.2)",
            "--accent-dim": "rgba(0,212,255,0.12)",
            "--bg-hover": "rgba(0,212,255,0.08)",
            "--bg-active": "rgba(255,153,0,0.1)",
            "--green": "#00ff88", "--red": "#ff4060",
            "--yellow": "#ffcc00",
        },
        colors_light={
            "--bg-primary": "#eef4ff", "--bg-secondary": "#e0eaf8",
            "--bg-sidebar": "#d4e0f0", "--bg-input": "#ffffff",
            "--text-primary": "#0a1428",
            "--text-secondary": "#2a3a50", "--text-muted": "#607090",
            "--accent": "#0090d4", "--accent-hover": "#cc6600",
            "--border": "rgba(10,20,40,0.12)",
            "--border-light": "rgba(10,20,40,0.2)",
            "--accent-dim": "rgba(0,144,212,0.14)",
            "--bg-hover": "rgba(10,20,40,0.05)",
            "--bg-active": "rgba(0,144,212,0.10)",
            "--green": "#00805a", "--red": "#c03030",
            "--yellow": "#a06010",
        },
        custom_css=(
            "/* Tron Grid — glowing perspective grid */\n"
            "@keyframes flasky-tron-pulse{"
            "0%,100%{opacity:0.2}50%{opacity:0.4}"
            "}\n"
            "body::before{"
            "content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;"
            "background-image:"
            "linear-gradient(rgba(0,212,255,0.08) 1px,transparent 1px),"
            "linear-gradient(90deg,rgba(0,212,255,0.08) 1px,transparent 1px);"
            "background-size:30px 30px;"
            "animation:flasky-tron-pulse 6s ease-in-out infinite"
            "}\n"
            ".toolbar{"
            "border-bottom:1px solid var(--accent);"
            "box-shadow:0 0 8px rgba(0,212,255,0.25)"
            "}\n" + _ANIM_REDUCE
        ),
    ),
]

PRESET_MAP = {p.id: p for p in _PRESETS}
PRESETS = list(_PRESETS)


def get_preset(preset_id):
    """Return the ThemePreset with the given id, or None."""
    return PRESET_MAP.get(preset_id)


def is_valid_preset_id(preset_id):
    """True if preset_id is '' (none) or a known preset id."""
    return preset_id == "" or preset_id in PRESET_MAP