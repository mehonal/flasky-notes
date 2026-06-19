const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/flasky-editor.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'FlaskyEditor',
  outfile: '../../static/script/codemirror6.bundle.js',
}).then(() => {
  console.log('Bundle built successfully.');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
