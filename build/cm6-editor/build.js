const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/obsidified-editor.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'ObsidifiedEditor',
  outfile: '../../static/script/themes/obsidified/codemirror6.bundle.js',
}).then(() => {
  console.log('Bundle built successfully.');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
