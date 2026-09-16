// 旧版本安装包清理脚本：每次打包后只保留「本次版本」的安装包，删掉目录里其它版本的 exe / msi
// 用法:
//   node scripts/clean-old-bundles.mjs                 # 保留 src-tauri/tauri.conf.json 里的版本
//   node scripts/clean-old-bundles.mjs --keep 1.7.1    # 显式指定要保留的版本（package.bat 传当前打包版本）
//   node scripts/clean-old-bundles.mjs --dry-run       # 只列出会被删掉哪些文件，不实际删
//   node scripts/clean-old-bundles.mjs --dir <目录>     # 换一个 bundle 根目录扫描（测试用）
// 说明: 只删「文件名里带版本号的安装包」（形如 轻记_1.7.0_x64-setup.exe / *_x64_en-US.msi）；
//       目录里不带版本号的文件（如 src-tauri/target/release/light-notes.exe 原始二进制）一律不碰。
//       安全阀: 若整个 bundle 目录里找不到「要保留的版本」的任何产物，则一个文件都不删——
//       避免将来打包命名规则变化时，把唯一的产物误删成空。
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const argValue = name => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

// 文件名里带版本号的安装包：<名称>_<x.y.z>_<目标>.<exe|msi>
// 例：轻记_1.7.0_x64-setup.exe → 名称=轻记 版本=1.7.0 目标=x64-setup 扩展名=exe
//     MSI 的目标段自带下划线（x64_en-US），故目标段不能再排除 "_"；靠 group1 的贪婪匹配锁定
//     最后一个「版本样」片段，不会把名称里的数字错当版本号。
const INSTALLER_RE = /^(.+)_(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-+]*)?)_([^\\/]+)\.(exe|msi)$/i;

const dryRun = args.includes('--dry-run');

function confVersion() {
    return String(JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version);
}

const keepArg = argValue('--keep');
let keep;
try {
    keep = String(keepArg || confVersion()).trim();
} catch (err) {
    console.error(`[clean-bundles] 读取 src-tauri/tauri.conf.json 失败：${err.message}`);
    process.exit(1);
}
if (!/^\d+\.\d+\.\d+/.test(keep)) {
    console.error(`[clean-bundles] 版本号不可用：${keep}`);
    process.exit(1);
}

const dirArg = argValue('--dir');
const bundleRoot = dirArg
    ? resolve(process.cwd(), dirArg)
    : join(root, 'src-tauri', 'target', 'release', 'bundle');

// 递归收集文件（只读目录，不跟随符号链接目录）
function walk(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.isFile()) out.push(p);
    }
    return out;
}

// 兜底：只允许删 bundleRoot 之内的文件（本脚本自己 walk 出来的路径，仍做一次前缀校验）
function insideBundle(p) {
    const rel = relative(bundleRoot, p);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

if (!existsSync(bundleRoot)) {
    console.log(`[clean-bundles] 未找到 bundle 目录（可能还没打过包），无需清理：${bundleRoot}`);
    process.exit(0);
}

const installers = [];
const skipped = [];
for (const p of walk(bundleRoot)) {
    const name = basename(p);
    const m = INSTALLER_RE.exec(name);
    if (m) installers.push({ path: p, name, version: m[2], ext: m[4].toLowerCase() });
    else skipped.push(name);
}

console.log(`[clean-bundles] 保留版本 ${keep}，扫描目录：${bundleRoot}`);

if (!installers.length) {
    console.log('  目录内没有任何带版本号的安装包，无需清理。');
    if (skipped.length) console.log(`  （未匹配命名规则的文件 ${skipped.length} 个，一律不动：${skipped.join('、')}）`);
    process.exit(0);
}

const kept = installers.filter(i => i.version === keep);
const stale = installers.filter(i => i.version !== keep);

// 安全阀：本次版本的产物一个都没找到时，不删任何东西
if (!kept.length) {
    console.log(`  [警告] 目录内没有版本 ${keep} 的安装包，为免误删已跳过清理。现有安装包：`);
    for (const i of installers) console.log(`    - ${i.name}`);
    process.exit(0);
}

if (!stale.length) {
    console.log(`  没有需要清理的旧版本安装包（保留：${kept.map(i => i.name).join('、')}）。`);
    process.exit(0);
}

console.log(`  ${dryRun ? '将删除' : '已删除'}旧版本安装包 ${stale.length} 个：`);
let failed = 0;
for (const i of stale) {
    if (dryRun) {
        console.log(`    - ${i.name}（${i.version}）`);
        continue;
    }
    if (!insideBundle(i.path)) {
        console.log(`    - ${i.name}：跳过（不在 bundle 目录内）`);
        failed += 1;
        continue;
    }
    try {
        unlinkSync(i.path);
        console.log(`    - ${i.name}（${i.version}）`);
    } catch (err) {
        console.log(`    - ${i.name}：删除失败（${err.code || err.message}）——文件可能正被占用，关掉安装包窗口后重跑本脚本`);
        failed += 1;
    }
}
console.log(`  保留本次版本：${kept.map(i => i.name).join('、')}`);
if (skipped.length) console.log(`  （未匹配命名规则的文件 ${skipped.length} 个，一律不动：${skipped.join('、')}）`);

if (dryRun) console.log('  --dry-run：未实际删除任何文件。');
process.exit(failed ? 1 : 0);
