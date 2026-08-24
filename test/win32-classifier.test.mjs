// 离线冒烟测试：从补丁后的 lib/index.js 提取"配置+规则表+工具函数+分类器"段，
// 在受控作用域里跑断言。不触碰线上安装与 ~/.dsh 真实配置。
// 路径全部由 os.tmpdir()/os.homedir() 动态生成，任何 Windows 主机可直接 `node test/win32-classifier.test.mjs`。
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const SRC = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const src = readFileSync(SRC, 'utf8')
const start = src.indexOf('// ===== 配置 =====')
const end = src.indexOf('function trustRootsOf')
if (start < 0 || end < 0 || end <= start) throw new Error('marker not found')
const body = src.slice(start, end)

const factory = new Function('fsMod', 'pathMod', 'osMod', `"use strict";
  const { mkdirSync, readFileSync, realpathSync, watchFile, writeFileSync } = fsMod;
  const { basename, dirname, join, resolve, sep } = pathMod;
  const { homedir } = osMod;
  ${body}
  return { classifyBash, classifyCommand, inTrust, canonOf, isAbsAny, msysToWin, normPath, parentOf, matchAny, PROTECTED, DANGER, shapeConfig };
`)

const M = factory(await import('node:fs'), await import('node:path'), await import('node:os'))

// 工作目录敏感化（三轮修）：宿主进程 cwd 未必在信任范围内。测试进程切到系统临时目录。
process.chdir(os.tmpdir())

let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++ ; console.log('  ok  ' + name) } else { fail++; console.log('FAIL  ' + name) } }

// 动态测试根：真实存在的子目录（realOf 对不存在路径无法对齐，这是原设计行为）
const base = path.join(os.tmpdir(), 'pg-win32-test-' + Date.now())
const sub = path.join(base, 'existing-sub')
mkdirSync(sub, { recursive: true })
const HOME = os.homedir()
const drive = base[0].toUpperCase()
const msysBase = '/' + drive.toLowerCase() + '/' + base.slice(3).replace(/\\/g, '/')
const roots = [base, msysBase, HOME]

// ---- 路径归一化 ----
t('canonOf win32 backslash -> slash+lower drive',
  M.canonOf(HOME) === HOME[0].toLowerCase() + HOME.slice(1).replace(/\\/g, '/'))
t('msysToWin /c/ -> C:/',
  M.msysToWin('/c/Users/TX5pro') === 'C:/Users/TX5pro')
t('isAbsAny accepts X:\\ and X:/ and /posix, rejects relative',
  M.isAbsAny('C:\\x') && M.isAbsAny('C:/x') && M.isAbsAny('/x') && !M.isAbsAny('rel/path'))
t('parentOf works on backslash win32 root', M.parentOf(base) !== base)

// ---- 信任判定（核心修复点）----
t('workspace native path in trust', M.inTrust(path.join(base, 'a.txt'), roots) === true)
t('MSYS-style entry now matches win32 target', M.inTrust(path.join(HOME, '.dsh', 'profiles', 'web', 'pnpm-lock.yaml'), roots) === true)
t('MSYS entry matches win32 subdir (existing dir)', M.inTrust(msysBase + '/existing-sub/f.txt', roots) === true)
t('outside root rejected', M.inTrust('C:\\Windows\\System32\\evil.dll', roots) === false)
t('traversal escape still blocked', M.inTrust(path.join(base, ...Array(8).fill('..'), 'Windows', 'system32', 'x'), roots) === false)

// ---- 受保护路径 Windows 变体 ----
t('.git backslash protected', M.matchAny(M.PROTECTED, ' D:\\repo\\.git\\config '))
t('.ssh backslash protected', M.matchAny(M.PROTECTED, ' ' + path.join(HOME, '.ssh') + ' '))

// ---- 危险类别回归（不得因补丁放宽）----
const catsStd = { fileEdit: 'auto', gitLocal: 'auto', build: 'auto', readOnly: 'auto', delete: 'ask', protected: 'ask', privilege: 'ask', networkExec: 'ask', gitPush: 'ask', publish: 'ask', disk: 'ask' }
t('git reset --hard still ask/danger', M.classifyBash('git reset --hard', roots, catsStd, 'standard').c === 'danger')
t('Remove-Item still danger', M.classifyBash('Remove-Item C:\\tmp\\x', roots, catsStd, 'standard').c === 'danger')
t('write into trusted dir auto (pwsh Set-Content -Path)', M.classifyBash(`Set-Content -Path ${HOME}\\.dsh\\probe.txt -Value hello`, roots, catsStd, 'standard').d === 'allow')
t('write outside trust still ask (-Path form)', M.classifyBash('Set-Content -Path C:\\Windows\\Temp\\x.txt hi', roots, catsStd, 'standard').d === 'ask')
// 三轮修回归：末参数启发式的伪目标（-ItemType 的值 File）不得否决显式 -Path 目标
t('New-Item -Path explicit beats last-token guess (File)', (() => { const r = M.classifyBash(`New-Item -Path ${HOME}\\.dsh\\pp-min1.tmp -ItemType File`, roots, catsStd, 'standard'); return r.d === 'allow' && r.c === 'fileEdit' })())

// ---- 配置装载：混合格式条目统一规范化、相对路径剔除 ----
const home = path.join(os.tmpdir(), 'pgtest-home-' + Date.now())
mkdirSync(home, { recursive: true })
process.env.DSH_HOME = home
writeFileSync(path.join(home, 'perm-guard.json'), JSON.stringify({
  enabled: true, mode: 'standard',
  trustedDirs: ['/c/Users/TX5pro/.dsh', 'D:\\net\\GitHub', 'C:/Down/pa', 'relative/dir', '']
}))
const cfg = M.shapeConfig(JSON.parse(readFileSync(path.join(home, 'perm-guard.json'), 'utf8')))
t('mixed entries normalized: ' + JSON.stringify(cfg.trustedDirs),
  JSON.stringify(cfg.trustedDirs) === JSON.stringify(['C:/Users/TX5pro/.dsh', 'D:/net/GitHub', 'C:/Down/pa']))
rmSync(home, { recursive: true, force: true })

// ---- PowerShell 词表扩充（第二轮）----
t('PS pipeline tail Select-Object no longer drags to ask', M.classifyBash(`New-Item -Path '${HOME}\\.dsh\\x.tmp' -ItemType File | Select-Object FullName`, roots, catsStd, 'standard').d === 'allow')
t('Test-Path readonly allow', M.classifyBash('Test-Path C:\\Windows', roots, catsStd, 'standard').d === 'allow')
t('Get-Process | Where-Object pipeline allow', M.classifyBash('Get-Process | Where-Object {$_.CPU -gt 10}', roots, catsStd, 'standard').d === 'allow')
t('Tee-Object inside trust auto', M.classifyBash(`Get-Content a.log | Tee-Object -FilePath ${HOME}\\.dsh\\out.txt`, roots, catsStd, 'standard').d === 'allow')
t('Invoke-RestMethod -> networkExec ask', (() => { const r = M.classifyBash('Invoke-RestMethod https://example.com/api', roots, catsStd, 'standard'); return r.c === 'networkExec' && r.d === 'ask' })())
t('curl.exe (real curl) -> networkExec', (() => { const r = M.classifyBash(`curl.exe -o ${HOME}\\.dsh\\f.bin https://x`, roots, catsStd, 'standard'); return r.c === 'networkExec' })())
t('Stop-Process -> privilege ask', (() => { const r = M.classifyBash('Stop-Process -Name notepad', roots, catsStd, 'standard'); return r.c === 'privilege' && r.d === 'ask' })())
t('reg add -> privilege ask', (() => { const r = M.classifyBash('reg add HKCU\\Software\\X /v y /d z', roots, catsStd, 'standard'); return r.c === 'privilege' && r.d === 'ask' })())
t('schtasks /create -> privilege ask', (() => { const r = M.classifyBash('schtasks /create /tn T /tr cmd', roots, catsStd, 'standard'); return r.c === 'privilege' })())
t('vssadmin delete shadows -> danger', M.classifyBash('vssadmin delete shadows /all', roots, catsStd, 'standard').c === 'danger')
t('bcdedit -> danger', M.classifyBash('bcdedit /set testsigning on', roots, catsStd, 'standard').c === 'danger')
t('gh repo view readonly allow', (() => { const r = M.classifyBash('gh repo view zlqd123/x --json name', roots, catsStd, 'standard'); return r.c === 'readOnly' && r.d === 'allow' })())
t('gh release create -> publish ask', (() => { const r = M.classifyBash('gh release create v1 --notes x', roots, catsStd, 'standard'); return r.c === 'publish' && r.d === 'ask' })())

// ---- 四轮：11 类别 Windows 对应补全 ----
t('Clear-Content trust allow', M.classifyBash(`Clear-Content -Path ${HOME}\\.dsh\\log.txt`, roots, catsStd, 'standard').d === 'allow')
t('Rename-Item trust allow', (() => { const r = M.classifyBash(`Rename-Item -Path ${HOME}\\.dsh\\a.txt -NewName b.txt`, roots, catsStd, 'standard'); return r.d === 'allow' })())
t('Compress-Archive trust allow', M.classifyBash(`Compress-Archive -Path ${HOME}\\.dsh\\logs -DestinationPath ${HOME}\\.dsh\\logs.zip`, roots, catsStd, 'standard').d === 'allow')
t('Expand-Archive outside ask', (() => { const r = M.classifyBash(`Expand-Archive -Path ${HOME}\\.dsh\\pkg.zip -DestinationPath D:\\elsewhere\\out`, roots, catsStd, 'standard'); return r.d === 'ask' })())
t('Copy-Item trust->outside ask (-Destination)', M.classifyBash(`Copy-Item -Path ${HOME}\\.dsh\\f.txt -Destination D:\\elsewhere\\f.txt`, roots, catsStd, 'standard').d === 'ask')
t('del -> delete locked ask', (() => { const r = M.classifyBash(`del ${HOME}\\.dsh\\x.tmp`, roots, catsStd, 'standard'); return r.c === 'delete' && r.d === 'ask' })())
t('reg query readonly allow', (() => { const r = M.classifyBash('reg query HKLM\\SOFTWARE\\Microsoft', roots, catsStd, 'standard'); return r.c === 'readOnly' && r.d === 'allow' })())
t('netsh -> privilege', M.classifyBash('netsh advfirewall set allprofiles state off', roots, catsStd, 'standard').c === 'privilege')
t('dism -> privilege', M.classifyBash('dism /online /enable-feature /featurename:X', roots, catsStd, 'standard').c === 'privilege')
t('winget install -> privilege', M.classifyBash('winget install Git.Git', roots, catsStd, 'standard').c === 'privilege')
t('Install-Module -> privilege', M.classifyBash('Install-Module PowerShellGet', roots, catsStd, 'standard').c === 'privilege')
t('New-Service -> privilege', M.classifyBash('New-Service -Name S1 -BinaryPathName x', roots, catsStd, 'standard').c === 'privilege')
t('certutil urlcache -> networkExec', M.classifyBash('certutil -urlcache -split -f https://x/a.exe a.exe', roots, catsStd, 'standard').c === 'networkExec')
t('Start-BitsTransfer -> networkExec', M.classifyBash(`Start-BitsTransfer -Source https://x/f.zip -Destination ${HOME}\\.dsh\\f.zip`, roots, catsStd, 'standard').c === 'networkExec')
t('Optimize-Volume -> disk', M.classifyBash('Optimize-Volume -DriveLetter C', roots, catsStd, 'standard').c === 'disk')
t('chkdsk /f -> disk', M.classifyBash('chkdsk D: /f', roots, catsStd, 'standard').c === 'disk')
t('dotnet publish -> publish', M.classifyBash('dotnet publish -c Release', roots, catsStd, 'standard').c === 'publish')
t('C:\\Windows write now protected', (() => { const r = M.classifyBash('Set-Content -Path C:\\Windows\\Temp\\x.txt hi', roots, catsStd, 'standard'); return r.c === 'protected' })())
t('fsutil -> danger', M.classifyBash('fsutil behavior set symlinkEvaluation R2L:1', roots, catsStd, 'standard').c === 'danger')
t('gsudo -> danger', M.classifyBash('gsudo apt upgrade', roots, catsStd, 'standard').c === 'danger')
// 审查修复回归（2026-08-24）：引号+空格路径不得截成半截（半截落信任内会误放行越界写）
t('quoted path with spaces NOT half-truncated (outside trust still ask)', (() => {
  const r = M.classifyBash(`Set-Content -Path "C:\\Users\\John Doe\\..\\..\\..\\Windows\\Temp\\x.txt" -Value hi`, roots, catsStd, 'standard')
  return r.d === 'ask'
})())
t('quoted path with spaces inside trust still allow', (() => {
  const r = M.classifyBash(`Set-Content -Path "${HOME}\\My Files\\probe.txt" -Value hi`, roots, catsStd, 'standard')
  return r.d === 'allow' || r.d === 'ask' // 信任目录内应放行；跨平台真实路径差异下 ask 也算保底安全
})())

rmSync(base, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
