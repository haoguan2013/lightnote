// 版本号统一提升脚本：一次同步 package.json / package-lock.json / tauri.conf.json / Cargo.toml / Cargo.lock
// 用法:
//   node scripts/bump-version.mjs [major|minor|patch]              # 提升版本号（默认 patch），同步 5 处
//   node scripts/bump-version.mjs [major|minor|patch] --dry-run    # 只打印提升后的版本号（供 package.bat 取用），不写文件
//   node scripts/bump-version.mjs check                            # 校验 5 处版本号是否一致（一致退出码 0，不一致 1）
// 说明: 每次发布新版（更新安装包）前先执行本脚本再运行 package.bat，
//       产出带新版本号的 setup.exe，旧版机器双击即覆盖升级且本地数据不受影响。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const part = (args.find(a => !a.startsWith('--')) || 'patch').toLowerCase();

const read = p => readFileSync(join(root, p), 'utf8');
const write = (p, s) => writeFileSync(join(root, p), s);

// 读取 5 处版本号（tauri.conf.json 为唯一事实来源）
function readVersions() {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    const cargoToml = (/^version = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml')) || [])[1];
    const cargoLock = (/name = "light-notes"\nversion = "([^"]+)"/.exec(read('src-tauri/Cargo.lock')) || [])[1];
    return {
        conf,
        pkg,
        lock,
        entries: [
            ['src-tauri/tauri.conf.json', conf.version],
            ['package.json', pkg.version],
            ['package-lock.json', lock.version],
            ['package-lock.json packages[""]', lock.packages && lock.packages[''] ? lock.packages[''].version : undefined],
            ['src-tauri/Cargo.toml', cargoToml],
            ['src-tauri/Cargo.lock', cargoLock]
        ]
    };
}

// ---- check：校验一致性 ----
if (part === 'check') {
    const { entries } = readVersions();
    const base = entries[0][1];
    const bad = entries.filter(([, v]) => v !== base);
    if (bad.length) {
        console.error(`[bump-version] 版本号不一致，以 ${entries[0][0]} 的 ${base} 为准：`);
        for (const [f, v] of entries) console.error(`  ${f}: ${v === undefined ? '(未找到)' : v}`);
        console.error('  修复：node scripts/bump-version.mjs patch');
        process.exit(1);
    }
    console.log(`[bump-version] 五处版本号一致：${base}`);
    process.exit(0);
}

if (!['major', 'minor', 'patch'].includes(part)) {
    console.error('用法: node scripts/bump-version.mjs [major|minor|patch] [--dry-run] | check');
    process.exit(1);
}

const { conf, pkg, lock } = readVersions();
const from = String(conf.version);
const [maj, min, pat] = from.split('.').map(Number);
let next;
if (part === 'major') next = `${maj + 1}.0.0`;
else if (part === 'minor') next = `${maj}.${min + 1}.0`;
else next = `${maj}.${min}.${pat + 1}`;

// 预演：只输出目标版本号（供 package.bat 组装选项文案），不改任何文件
if (dryRun) {
    console.log(next);
    process.exit(0);
}

// 1. tauri.conf.json
conf.version = next;
write('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');

// 2. package.json（保序重写）
pkg.version = next;
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

// 3. package-lock.json（根与 packages[""] 两处）
lock.version = next;
if (lock.packages && lock.packages['']) lock.packages[''].version = next;
write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

// 4. Cargo.toml / Cargo.lock
write('src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').replace(/^version = "[^"]+"$/m, `version = "${next}"`));
write('src-tauri/Cargo.lock', read('src-tauri/Cargo.lock').replace(/(name = "light-notes"\nversion = ")[^"]+(")/, `$1${next}$2`));

console.log(`[bump-version] ${from} -> ${next}（${part}）：已同步 5 处版本号`);
console.log('下一步：运行 package.bat（或 npm run build），产物即为可覆盖升级旧版的更新安装包。');
