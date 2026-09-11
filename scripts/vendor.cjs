const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
for (const [source, target] of [
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
  ['dompurify/LICENSE', 'DOMPurify-LICENSE'],
  ['quill/dist/quill.js', 'quill.js'],
  ['quill/dist/quill.snow.css', 'quill.snow.css'],
  ['quill/LICENSE', 'Quill-LICENSE']
]) fs.copyFileSync(path.join(root, 'node_modules', source), path.join(root, 'vendor', target));
