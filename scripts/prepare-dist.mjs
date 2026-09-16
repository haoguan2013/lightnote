// 打包前准备：把单文件前端 notes.html 复制到 dist/
// 目的：tauri 只内嵌 frontendDist 目录（../dist），避免把 node_modules / src-tauri/target 打进安装包
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
mkdirSync(distDir, { recursive: true });
copyFileSync(join(root, 'notes.html'), join(distDir, 'notes.html'));
console.log('[prepare-dist] notes.html -> dist/notes.html');
