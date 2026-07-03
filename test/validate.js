'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = [
  'manifest.json',
  'content/content.js',
  'background/service-worker.js',
  'popup/popup.html',
  'popup/popup.js',
  'popup/popup.css',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

let ok = true;
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.error('MISSING:', file);
    ok = false;
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) {
  console.error('manifest_version must be 3');
  ok = false;
}
if (manifest.content_scripts) {
  console.error('不应包含全局 content_scripts（轻量按需注入）');
  ok = false;
}

const jsFiles = ['content/content.js', 'background/service-worker.js', 'popup/popup.js'];
let totalJs = 0;
for (const file of jsFiles) {
  totalJs += fs.statSync(path.join(root, file)).size;
}

console.log('JS 总体积:', totalJs, 'bytes');
if (totalJs > 20480) {
  console.warn('WARN: JS 超过 20KB 目标');
}

console.log(ok ? 'VALIDATION PASSED' : 'VALIDATION FAILED');
process.exit(ok ? 0 : 1);
