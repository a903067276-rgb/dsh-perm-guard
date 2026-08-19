/**
 * dsh-perm-guard — Host 半
 *
 * 「Auto 自动审批」中间档：在宿主 approval/request 审批链最前面插入自动
 * 判定器（prepend），按"操作类别规则表"三态判定：
 *   - 自动放行（allowed-once）：信任目录内的常规开发操作（commit/merge/
 *     跨目录写兄弟项目/构建测试等），不弹窗
 *   - 人工确认（next → 宿主弹窗）：不可逆删除、受保护路径、提权、网络
 *     下载执行、git 推送、发布部署、磁盘操作（默认值，可在设置页调整）
 *   - 自动拒绝（rejected）：类别开关设为「拒绝」的操作
 * 另有 tools/pre-execute 防火墙：对明确危险类别提前拦截（不必先被沙箱
 * 拒绝再走升级审批），未知/安全命令交给沙箱 + answerer 流程，避免过度打扰。
 *
 * 零宿主依赖：配置持久化到 $DSH_HOME/perm-guard.json（默认 ~/.dsh），
 * 状态读写走 webServer HTTP 端点 /api/perm-guard/state。
 *
 * 规则参考 Claude Code 内置只读命令集与 rm -rf / ~ 断路器、Codex 的
 * prefix_rule 取最严与复合命令拆分（纯词链拆分，含变量/重定向整体保守）。
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-perm-guard'
export const inject = ['webServer', 'approval', 'tools']

// ===== 配置 =====
const CATEGORY_DEFAULTS = {
  fileEdit: 'auto',     // 信任目录内文件编辑
  gitLocal: 'auto',     // git 本地写（commit/merge 等）
  build: 'auto',        // 构建/测试/本地装依赖
  readOnly: 'auto',     // 只读查询
  delete: 'ask',        // 不可逆删除（rm 等，必须人工）
  protected: 'ask',     // 受保护路径写入
  privilege: 'ask',     // 提权/系统管理
  networkExec: 'ask',   // 网络下载执行
  gitPush: 'ask',       // git 推送远端
  publish: 'ask',       // 发布/部署
  disk: 'ask'           // 磁盘/分区/设备
}
const DEFAULTS = { enabled: true, mode: 'standard', categories: { ...CATEGORY_DEFAULTS }, trustedDirs: [], strictHighRisk: false }
// 激进模式默认类别：除破坏性（删除/受保护/磁盘）外全部自动；切换模式时同步重置
const AGGRESSIVE_CATEGORIES = {
  fileEdit: 'auto',
  gitLocal: 'auto',
  build: 'auto',
  readOnly: 'auto',
  delete: 'ask',
  protected: 'ask',
  privilege: 'ask',
  networkExec: 'auto',
  gitPush: 'auto',
  publish: 'auto',
  disk: 'ask'
}
// 高危类别锁定（2026-08-18 用户定，安全第一）：任何模式、任何配置都强制 ask，
// 不允许 auto/deny 覆盖——防"一条命令把 delete/protected 改成 auto"类攻击（收录审阅 finding 1）。
// 涵盖：硬红线（danger）、受保护文件、不可逆删除、磁盘/分区、提权/系统管理。
const LOCKED_ASK = new Set(['danger', 'protected', 'delete', 'disk', 'privilege'])

function configPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'perm-guard.json')
}

function loadConfig() {
  try {
    const j = JSON.parse(readFileSync(configPath(), 'utf8'))
    return {
      enabled: typeof j.enabled === 'boolean' ? j.enabled : DEFAULTS.enabled,
      mode: j.mode === 'aggressive' ? 'aggressive' : 'standard',
      categories: { ...CATEGORY_DEFAULTS, ...(j.categories && typeof j.categories === 'object' ? j.categories : {}) },
      trustedDirs: Array.isArray(j.trustedDirs) ? j.trustedDirs.filter((d) => typeof d === 'string') : [],
      strictHighRisk: j.strictHighRisk === true
    }
  } catch {
    return { enabled: DEFAULTS.enabled, mode: 'standard', categories: { ...CATEGORY_DEFAULTS }, trustedDirs: [] }
  }
}

// ===== 规则表 =====
const DANGER = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~)(\s|$|;|&&|\|\|)/, // rm -rf / 或 ~（CC 断路器）
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+[~$]\(/,                  // rm -rf $(...) / ~(...) 变体
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  /\bdd\b[^;|&]*\bof=\/dev\//,
  /\b(mkfs|fdisk|wipefs|shred|gdisk|parted)\b/,
  /\bdiskutil\s+(eraseVolume|eraseDisk|zeroDisk)\b/,
  /\bsudo\b|\bsu\s+-/,
  /\b(curl|wget)\b[^|;]*\|\s*(ba|z)?sh\b/,
  /\bgit\s+push\b[^|;&]*--force(\s|$)/,
  /\bgit\s+push\b[^|;&]*-f(\s|$)/,
  /\b(npm|pnpm|yarn)\s+publish\b/,
  /\bkubectl\s+(apply|create|delete|edit|scale|rollout)\b/,
  /\bhelm\s+(install|upgrade|delete|rollback)\b/,
  /\b(launchctl|systemctl)\s+(load|unload|bootout|bootstrap|start|stop|restart|enable|disable)\b/,
  /\bchmod\s+-R\b[^;|&]*\s+(\/|~)/,
  /\bchown\s+-R\b[^;|&]*\s+(\/|~)/,
  // find 危险旗：-delete / -exec 是写行为，绝不因 find 属只读而放行（P0 修复）
  /\bfind\b[^|;&]*\s-(delete|exec|execdir)\b/,
  // xargs 配合删除/破坏命令（2026-08-18 扩充）：`xargs rm` 类链式删除
  /\bxargs\b[^|;&]*\b(rm|rmdir|shred|dd|mkfs|wipefs)\b/,
  // PowerShell 危险模式
  /\bRemove-Item\b/,
  /\bIEX\b|\bInvoke-Expression\b/,
  /\bClear-Disk\b|\bInitialize-Disk\b/,
  /\b(Enable|Disable)-PSRemoting\b/
]
const PROTECTED = [
  /(^|[\s'"])[\.]?(ssh|aws|config|gnupg|kube)(\/|\s|$)/,
  /\/(\.ssh|\.aws|\.config|\.gnupg|\.kube)(\/|\s|$)/,
  /(^|[\s'"])[\.]?(bashrc|zshrc|bash_profile|zprofile|npmrc|gitconfig|netrc|env)(\s|$)/,
  // 受保护文件名全路径匹配（P2 修复）：write <trusted>/.env、x/.bashrc 这类"路径中部出现"也拦
  /(?:^|[\s"'/])(?:\.env|bashrc|zshrc|bash_profile|zprofile|npmrc|gitconfig|netrc)(?:\.|$|\s)/,
  /(^|\s)\/(etc|usr|System|Library|Applications)(\/|\s|$)/,
  /\/dev\/(?!null\b)/, // 写设备（/dev/null 除外——标准丢弃输出，无害）
  /\.(pem|key|p12|pfx)(\s|$)/,
  /(id_rsa|id_ed25519|authorized_keys)(\s|$)/,
  /\.git\//
]
const READONLY = new Set(['ls', 'cat', 'echo', 'pwd', 'head', 'tail', 'grep', 'wc', 'which', 'diff', 'stat', 'du', 'cd', 'less', 'more', 'file', 'dirname', 'basename', 'uname', 'date', 'printenv', 'type', 'df', 'ps', 'top', 'free', 'uptime', 'whoami', 'id', 'groups', 'history', 'true', 'false', 'sleep', 'test', 'printf', 'jq', 'yq', 'sha256sum', 'shasum', 'md5', 'md5sum', 'base64', 'sw_vers', 'system_profiler', 'nproc', 'ulimit', 'umask', 'ping', 'dig', 'nslookup', 'host', 'Get-Content', 'Get-ChildItem', 'Get-Process', 'Get-Item', 'Select-String', 'Get-Date', 'Write-Output', 'Get-Location'])
// 已从 READONLY 摘除（P0 修复）：find（-delete/-exec 是写行为，走 DANGER 拦截）、
// env（可作命令前缀 `env cmd`，按首 token 放行会被绕过）
// 脚本解释器（2026-08-18 扩充）：跑信任目录内的脚本文件 = 本地开发操作（build）；
// `-c/-e/标准输入` 等任意代码执行 = 执行语义 → ask（privilege 类，锁定）。bash/sh 同理。
const INTERPRETERS = new Set(['python', 'python3', 'node', 'ruby', 'perl', 'php', 'bash', 'sh', 'zsh', 'fish', 'deno', 'bun'])
const GIT_READONLY = new Set(['status', 'log', 'diff', 'show', 'blame', 'remote', 'branch', 'tag', 'stash', 'ls-files', 'rev-parse', 'config', 'help'])
const GIT_LOCAL = new Set(['add', 'commit', 'merge', 'rebase', 'checkout', 'switch', 'branch', 'restore', 'stash', 'rm', 'mv', 'cherry-pick', 'revert', 'am'])
const BUILD = new Set(['npm', 'pnpm', 'yarn', 'bun', 'tsc', 'vite', 'webpack', 'rollup', 'esbuild', 'make', 'cmake', 'cargo', 'go', 'gradle', 'mvn', 'poetry', 'uv', 'pip', 'pip3', 'docker'])
const BUILD_SUB = new Set(['install', 'ci', 'test', 'run', 'build', 'exec', 'check', 'fmt', 'clippy', 'vet', 'mod', 'compile', 'compose', 'pull', 'audit', 'init', 'preview', 'lint', 'fix', 'format'])
const BUILD_SUB2 = new Set(['install', 'test', 'build', 'run', 'compile', 'package', 'verify', 'validate', 'audit', 'lint', 'fix', 'format'])
const WRITE_CMDS = ['cp', 'mv', 'install', 'ln', 'mkdir', 'touch', 'sed', 'awk', 'tr', 'dd', 'rm', 'rmdir', 'unlink', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'chmod', 'chown', 'Set-Content', 'Add-Content', 'Out-File', 'Copy-Item', 'Move-Item', 'New-Item', 'Remove-Item']
// 网络传输类（2026-08-18 扩充）：scp/rsync 从远端取/传文件，落点判定易被 host:path 形式误导 → 归 networkExec 类
const NET_CMDS = new Set(['curl', 'wget', 'scp', 'rsync'])
// 系统操作类（2026-08-18 扩充，privilege 锁定 ask）：kill 系列、xargs（配合 DANGER 旗拦 xargs rm）
const SYS_CMDS = new Set(['kill', 'pkill', 'killall', 'xargs', 'service', 'systemctl'])
// 防火墙只主动拦截的明确危险类别；其余交给沙箱 + answerer，避免过度打扰
// 激进档：位置不限，只拦破坏性（删除/受保护/磁盘 + DANGER 硬红线）
function firewallCats(mode) {
  return mode === 'aggressive'
    ? new Set(['danger', 'protected', 'delete', 'disk'])
    : new Set(['danger', 'protected', 'delete', 'privilege', 'networkExec', 'gitPush', 'publish', 'disk'])
}

// ===== 工具函数 =====
const matchAny = (patterns, text) => patterns.some((p) => p.test(text))
const normPath = (p) => { let s = p.trim(); if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1); return s }
const parentOf = (p) => { const s = normPath(p); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i) }
// 规范化到真实绝对路径：展开 ~ → resolve 折叠 ../ → realpath 解析符号链接。
// 安全评审发现：纯字符串前缀匹配可被 /root/../../../etc/x 穿越信任边界，
// 且信任目录内的 symlink 指向外部也能绕过——两侧都解析后再比较。
const expandHome = (p) => p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
const realOf = (p) => {
  const abs = resolve(expandHome(p.trim()))
  // 新建路径按"实际落点"判定（审阅 Finding 2 修复）：向上找最深已存在祖先 realpath 后拼回剩余段，
  // 堵住 `ln -s /etc /workspace/evil`（链接目标尚不存在，字符串前缀判可信）→ 写入实际落到 /etc 的绕过。
  let cur = abs
  const tail = []
  for (;;) {
    try { return join(realpathSync(cur), ...tail.reverse()) } catch { /* 继续向上找已存在祖先 */ }
    const parent = dirname(cur)
    if (parent === cur) return abs // 根都不可达（极端异常）：回退 resolve
    tail.push(basename(cur))
    cur = parent
  }
}
const inTrust = (target, roots) => {
  const t = realOf(target)
  if (!t.startsWith('/')) return false
  for (const r of roots) {
    const root = realOf(r)
    if (t === root || t.startsWith(root + sep)) return true
  }
  return false
}
const cmdNameOf = (part) => {
  const m = part.match(/^\s*([^\s]+)/)
  if (!m) return ''
  let n = m[1]
  if (n.startsWith('./') || n.startsWith('../')) n = n.slice(n.lastIndexOf('/') + 1)
  else if (n.startsWith('/')) n = n.slice(n.lastIndexOf('/') + 1)
  return n.replace(/^['"]|['"]$/g, '')
}
const subOf = (cmd) => { const m = cmd.match(/^\s*(?:\S+\s+)([a-zA-Z-]+)/); return m ? m[1] : '' }
const summarize = (s) => (s || '').replace(/\s+/g, ' ').slice(0, 80)
// git -C 归一化（P0 修复）：`git -C <path> reset --hard` / `git -C/trusted reset --hard`
// 归一化为 `git reset --hard`，让 DANGER/PROTECTED 正则不再被 -C 变体绕过。
// 仅用于危险模式匹配；子命令提取本身已支持 -C（见 classifyCommand）。
const normalizeGit = (cmd) => cmd.replace(/\bgit\s+-C(?:\s+\S+|\S*)(?=\s|$)/g, 'git')

function splitCommands(cmd) {
  if (/[\$`()<>*?"'\\]|(^|[\s;|&])[A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) return null
  const parts = cmd.split(/\s*&&\s*|\s*\|\|\s*|\s*;\s*|\s*\|\s*/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : null
}

function extractTargets(cmd) {
  const targets = []
  let redirs = cmd.match(/(?:^|[\s|;&])(?:[12])?>>?\s*([^\s|;&"']+)/g)
  if (redirs) for (const r of redirs) {
    const t = r.replace(/(?:^|[\s|;&])(?:[12])?>>?\s*/, '')
    if (t !== '/dev/null') targets.push(t) // /dev/null = 丢弃输出，非写目标
  }
  const tee = cmd.match(/\btee\s+([^\s|;&"']+)/)
  if (tee) targets.push(tee[1])
  const outOpt = cmd.match(/(?:^|\s)-[oO]\s+([^\s|;&"']+)/)
  if (outOpt) {
    const t = outOpt[1]
    if (t !== '/dev/null') targets.push(t) // curl -o /dev/null = 丢弃输出
  }
  const name = cmdNameOf(cmd)
  if (WRITE_CMDS.includes(name)) {
    const tokens = cmd.split(/\s+/).filter((t) => t !== '' && !t.startsWith('-') && !t.startsWith('>') && t !== '&&' && t !== '||' && t !== ';' && t !== '|')
    if (tokens.length > 0) targets.push(tokens[tokens.length - 1])
  }
  if (targets.length === 0) {
    // redirs 存在但目标全被过滤（/dev/null 丢弃输出）→ 不算写行为；
    // 非 /dev/null 的重定向目标已在上方进入 targets
    if (tee || outOpt || WRITE_CMDS.includes(name)) return []
    return null
  }
  return targets.map((t) => t.replace(/^['"]|['"]$/g, ''))
}

// 类别开关值 'auto' 归一化为判定值 'allow'（answerer/防火墙只认 allow/ask/deny）。
// 高危类别（LOCKED_ASK）强制 ask，配置里的 auto/deny 一律不生效。
const catOf = (categories, key) => {
  if (LOCKED_ASK.has(key)) return { d: 'ask', c: key }
  const v = categories[key] || 'ask'
  return { d: v === 'auto' ? 'allow' : v, c: key }
}

function classifyCommand(cmd, trustRoots, categories, mode) {
  const c = cmd.trim()
  if (c === '') return { d: 'allow', c: 'readOnly' }
  // git -C 变体先归一化再匹配危险/受保护模式（P0 修复：git -C x reset --hard 不再绕过）
  const cNorm = normalizeGit(c)
  if (matchAny(DANGER, cNorm)) return { d: 'ask', c: 'danger' }
  if (matchAny(PROTECTED, cNorm)) return { d: 'ask', c: 'protected' }
  const name = cmdNameOf(c)
  // curl/wget 属网络类（P2 修复）：-o/-O 下载目标是 URL/落点，不按信任目录判定
  // （URL 会被 resolve 成相对路径误落信任目录内而放行）
  if (name === 'curl' || name === 'wget') return catOf(categories, 'networkExec')
  const targets = extractTargets(c)
  if (targets !== null) {
    if (targets.length === 0) return { d: 'ask', c: 'unknown' }
    // 标准档：写目标必须在信任目录才可能自动；激进档：位置不限（只拦破坏性）
    if (mode !== 'aggressive') {
      for (const t of targets) {
        // 规范化（../ 折叠 + symlink 解析）后再查受保护路径与信任边界，
        // 防止 /trust/../../../etc/x 穿越绕过
        const resolved = realOf(t)
        if (matchAny(PROTECTED, ' ' + resolved + ' ')) return { d: 'ask', c: 'protected' }
        if (!inTrust(t, trustRoots)) return { d: 'ask', c: 'outside' }
      }
    } else {
      // 激进档：位置不限，但规范化后的目标命中受保护路径仍拦
      for (const t of targets) {
        const resolved = realOf(t)
        if (matchAny(PROTECTED, ' ' + resolved + ' ')) return { d: 'ask', c: 'protected' }
      }
    }
    if (name === 'rm' || name === 'rmdir' || name === 'unlink' || name === 'Remove-Item') return catOf(categories, 'delete')
    if (name === 'brew' || name === 'port' || name === 'useradd' || name === 'passwd') return catOf(categories, 'privilege')
    if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
      if (mode !== 'aggressive' && /-g\b|--global/.test(c)) return catOf(categories, 'privilege')
      if (mode !== 'aggressive' && subOf(c) === 'publish') return catOf(categories, 'publish')
    }
    return catOf(categories, 'fileEdit')
  }
  // 激进档语义（审阅 Finding 1 修复）："更宽的自动放行清单"= 显式配置的类别照 auto 放行，
  // 但分类器没能解析的 unknown 一律 ask——那个集合按定义无界，放行等于权限闸门可被诱导放宽。
  // （删除原 `mode === 'aggressive'` 的 unknown 早返回 allow；git push/publish/privilege 等
  //   显式类别仍按 AGGRESSIVE_CATEGORIES 放行，见下方各自分支。）
  if (READONLY.has(name)) return catOf(categories, 'readOnly')
  // 网络传输类（2026-08-18 扩充）：curl/wget/scp/rsync → networkExec（危险子命令已被 DANGER 拦）
  if (NET_CMDS.has(name)) return catOf(categories, 'networkExec')
  if (name === 'dd') return catOf(categories, 'disk')
  // 脚本解释器（2026-08-18 扩充）：跑信任目录内的脚本文件 = 本地开发（build）；
  // `-c/-e/标准输入` 等任意代码执行 = 执行语义 → ask（privilege 类，已锁定）
  if (INTERPRETERS.has(name)) {
    // 脚本文件提取：`python3 script.py` 或带选项的 `node --check file.js`（2026-08-19 修：
    // 选项开头曾导致误判 privilege，严格模式下日常 node --check 等全被拦）
    const fileM = c.match(/^\S+\s+((?:\.\/|~\/|\/)?[^\s-][^\s]*(?:\.py|\.js|\.mjs|\.ts|\.rb|\.pl|\.php|\.sh|\.zsh|\.fish))/)
    const optFileM = fileM === null
      ? c.match(/^\S+\s+(?:-{1,2}[a-zA-Z]+\s+)+((?:\.\/|~\/|\/)?[^\s-][^\s]*(?:\.py|\.js|\.mjs|\.ts|\.rb|\.pl|\.php|\.sh|\.zsh|\.fish))/i)
      : null
    const f = fileM !== null ? fileM[1] : optFileM !== null ? optFileM[1] : null
    if (f !== null) {
      if (mode === 'aggressive' || inTrust(f, trustRoots)) return catOf(categories, 'build')
      return { d: 'ask', c: 'outside' }
    }
    return { d: 'ask', c: 'privilege' } // -c/-e/标准输入：任意代码执行
  }
  // 系统操作类（2026-08-18 扩充）：kill 系列/xargs/service 等 → privilege（锁定 ask）
  if (SYS_CMDS.has(name)) return catOf(categories, 'privilege')
  if (name === 'git') {
    // 子命令提取：支持 git -C <path> <sub> 形式（跳过 -C 与路径）
    let sub = subOf(c)
    if (sub === '-C') {
      const m2 = c.match(/^\s*\S+\s+-C\s+\S+\s+([a-zA-Z-]+)/)
      sub = m2 ? m2[1] : ''
    }
    if (GIT_LOCAL.has(sub)) return catOf(categories, 'gitLocal')
    if (GIT_READONLY.has(sub)) return catOf(categories, 'readOnly')
    if (sub === 'push') return mode === 'aggressive' ? { d: 'allow', c: 'gitPush' } : catOf(categories, 'gitPush')
    if (sub === 'fetch' || sub === 'pull') return catOf(categories, 'gitLocal')
    return { d: 'ask', c: 'unknown' }
  }
  if (BUILD.has(name)) {
    if (name === 'docker') {
      const sub = subOf(c)
      if (sub === 'push') return mode === 'aggressive' ? { d: 'allow', c: 'publish' } : catOf(categories, 'publish')
      if (sub === 'run' || sub === 'exec' || sub === 'rmi' || sub === 'rm') return mode === 'aggressive' ? { d: 'allow', c: 'privilege' } : catOf(categories, 'privilege')
      if (sub === 'build' || sub === 'compose') return catOf(categories, 'build')
      return { d: 'ask', c: 'unknown' }
    }
    if (BUILD_SUB2.has(subOf(c))) return catOf(categories, 'build')
    return { d: 'ask', c: 'unknown' }
  }
  return { d: 'ask', c: 'unknown' }
}

function classifyBash(cmd, trustRoots, categories, mode) {
  const cNorm = normalizeGit(cmd)
  if (matchAny(DANGER, cNorm) || matchAny(PROTECTED, cNorm)) return { d: 'ask', c: matchAny(DANGER, cNorm) ? 'danger' : 'protected' }
  const parts = splitCommands(cmd)
  if (parts === null) {
    // 复杂命令（变量/引号/通配/赋值）：不得按首 token 定类别（P0 修复——
    // `cd /trusted && rm -rf *` 以前按首 token cd 判 readOnly 被自动放行）。
    // 按 &&/||/;/| 粗切分逐段递归判定（含单管道：rm x | head 也要把 rm 段切出来）
    const rough = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/).map((s) => s.trim()).filter(Boolean)
    if (rough.length > 1) {
      let worst = { d: 'allow', c: 'readOnly' }
      for (const part of rough) {
        const r = classifyBash(part, trustRoots, categories, mode)
        if (r.d === 'deny') return r
        if (r.d === 'ask') {
          // 高危类别优先（2026-08-19 修）：rm(delete) 不能被后续段 unknown 覆盖——worst 取最危险而非最后
          if (LOCKED_ASK.has(r.c)) return r
          worst = r
        } else if (worst.c === 'readOnly' && r.c !== 'readOnly') {
          worst = r
        }
      }
      return worst
    }
    // 单段（无 &&/;/| 分隔）：按首 token 走 classifyCommand——含 2>&1 等重定向的
    // rm/mv 等也能正确分类（P0-2 的按首 token 漏洞只存在于跨段命令，单段无分隔符是安全的）
    return classifyCommand(cmd, trustRoots, categories, mode)
  }
  let worst = { d: 'allow', c: 'readOnly' }
  for (const part of parts) {
    const r = classifyCommand(part, trustRoots, categories, mode)
    if (r.d === 'deny') return r
    if (r.d === 'ask') {
      if (LOCKED_ASK.has(r.c)) return r // 高危类别优先（2026-08-19 修）
      worst = r
    } else if (worst.c === 'readOnly' && r.c !== 'readOnly') {
      worst = r // 保留第一个非只读 allow 的类别（curl | head → networkExec 而非 readOnly）
    }
  }
  return worst
}

function trustRootsOf(ctx, session, config) {
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const workspaceRoot = sandboxPolicy && session ? sandboxPolicy.resolve({ session }).workspaceRoot : null
  if (!workspaceRoot) return null
  return [workspaceRoot, parentOf(workspaceRoot)].concat(config.trustedDirs)
}

function lookupCall(req) {
  if (req.callId === undefined) return null
  const events = req.agent && req.agent.session ? req.agent.session.events : null
  if (!events) return null
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]
    if (!e || e.type !== 'tool/call') continue
    const d = e.data
    if (!d || d.callId !== req.callId) continue
    try {
      const args = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : d.arguments
      return { name: d.name, args: args && typeof args === 'object' ? args : {} }
    } catch { return null }
  }
  return null
}

// 写语义判定（2026-08-18 新方案）：工具 args 带路径且无执行参数 → 视为纯写工具，
// 与官方 write/edit 同规则按路径归属判定。执行语义/无法判断的一律交人工，不放宽。
const WRITE_ARG_KEYS = ['file_path', 'path', 'target']
const EXEC_ARG_KEYS = ['command', 'script', 'code', 'expression', 'shell', 'eval', 'javascript']
function isWriteSemantics(args) {
  const keys = Object.keys(args)
  if (keys.some((k) => EXEC_ARG_KEYS.includes(k))) return false
  return keys.some((k) => WRITE_ARG_KEYS.includes(k))
}

// ===== HTTP helpers =====
function writeJson(res, code, obj) {
  const text = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > 65536) { rejectBody(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (e) { rejectBody(e) }
    })
    req.on('error', rejectBody)
  })
}

// ===== 插件主体 =====
export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (!webServer) return

  let config = loadConfig()
  const audit = []

  function saveConfig(patch) {
    // 高危类别锁定（2026-08-18）：任何来源的配置补丁都不能把 LOCKED_ASK 类改成非 ask
    const safeCats = { ...(patch.categories || {}) }
    for (const k of LOCKED_ASK) safeCats[k] = 'ask'
    config = {
      ...config,
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(patch.mode === 'standard' || patch.mode === 'aggressive' ? { mode: patch.mode } : {}),
      categories: { ...config.categories, ...safeCats },
      trustedDirs: Array.isArray(patch.trustedDirs) ? patch.trustedDirs : config.trustedDirs,
      strictHighRisk: typeof patch.strictHighRisk === 'boolean' ? patch.strictHighRisk : config.strictHighRisk
    }
    try {
      mkdirSync(dirname(configPath()), { recursive: true })
      writeFileSync(configPath(), JSON.stringify({ enabled: config.enabled, mode: config.mode, categories: config.categories, trustedDirs: config.trustedDirs, strictHighRisk: config.strictHighRisk }, null, 2))
    } catch (e) {
      console.error('[perm-guard] config persist failed: ' + (e && e.message ? e.message : String(e)))
    }
  }

  const record = (entry) => {
    audit.push({ t: Date.now(), ...entry })
    if (audit.length > 60) audit.splice(0, audit.length - 60)
  }

  // ===== 审批自动判定器（prepend 插队到宿主人工审批前）=====
  ctx.on('approval/request', (req, next) => {
    if (!config.enabled) return next()
    if (req.signal && req.signal.aborted) return 'cancelled'
    try {
      const session = req.agent && req.agent.session ? req.agent.session : null
      const roots = trustRootsOf(ctx, session, config)
      if (!roots) { console.log('[perm-guard] approve roots=MISS session=' + (session ? session.id : 'none')); return next() }
      const call = lookupCall(req)
      console.log('[perm-guard] approve tool=' + req.toolName + ' callId=' + req.callId + ' reason=' + (req.reason || '').slice(0, 60) + ' lookup=' + (call ? 'hit args=' + JSON.stringify(Object.keys(call.args)) : 'MISS'))
      if (!call) return next()
      if (req.toolName === 'bash' || req.toolName === 'pwsh') {
        const cmd = typeof call.args.command === 'string' ? call.args.command : ''
        if (!cmd) return next()
        const r = classifyBash(cmd, roots, config.categories, config.mode)
        console.log('[perm-guard] decide tool=' + req.toolName + ' mode=' + config.mode + ' ro=' + config.categories.readOnly + ' d=' + r.d + ' c=' + r.c + ' cmd=' + summarize(cmd))
        if (r.d === 'allow') { record({ tool: req.toolName, cmd: summarize(cmd), decision: 'allowed-once', category: r.c }); return 'allowed-once' }
        if (r.d === 'deny') { record({ tool: req.toolName, cmd: summarize(cmd), decision: 'rejected', category: r.c }); return 'rejected' }
        record({ tool: req.toolName, cmd: summarize(cmd), decision: 'ask-human', category: r.c })
        return next()
      }
      // 写语义工具（官方 write/edit + 任意纯写工具如 memory-write）：
      // args 带路径且无执行参数 → 按路径归属判定（信任目录内自动放行，信任外/受保护交人工）。
      // 执行语义/无法判断的工具不走这里，保持弹窗（安全默认）。
      if (req.toolName === 'write' || req.toolName === 'edit' || isWriteSemantics(call.args)) {
        const target = call.args.file_path || call.args.path || call.args.target || ''
        const t = typeof target === 'string' ? target.trim() : ''
        if (!t) { console.log('[perm-guard] write-semantics no-target args=' + JSON.stringify(call.args)); return next() }
        // 原始文本 + 规范化（../ 折叠 + symlink 解析）双查受保护路径
        const resolved = realOf(t)
        if (matchAny(PROTECTED, t) || matchAny(PROTECTED, ' ' + t + ' ') || matchAny(PROTECTED, ' ' + resolved + ' ')) { record({ tool: req.toolName, target: t, decision: 'ask-human', category: 'protected' }); return next() }
        // 激进档：位置不限自动放行（受保护路径已拦）；标准档：信任目录内才自动
        if (config.mode === 'aggressive' || inTrust(t, roots)) { console.log('[perm-guard] write-semantics ALLOW target=' + t + ' inTrust=' + inTrust(t, roots) + ' mode=' + config.mode); record({ tool: req.toolName, target: t, decision: 'allowed-once', category: 'fileEdit' }); return 'allowed-once' }
        console.log('[perm-guard] write-semantics ASK target=' + t + ' inTrust=' + inTrust(t, roots))
        record({ tool: req.toolName, target: t, decision: 'ask-human', category: 'outside' })
        return next()
      }
      return next()
    } catch (e) {
      console.error('[perm-guard] answerer failed: ' + (e && e.message ? e.message : String(e)))
      return next()
    }
  }, true)

  // ===== pre-execute 防火墙：只主动拦截明确危险类别 =====
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!config.enabled) return next()
    const name = exec.name
    if (name !== 'bash' && name !== 'pwsh' && name !== 'write' && name !== 'edit') return next()
    const session = exec.agent && exec.agent.session ? exec.agent.session : null
    const roots = trustRootsOf(ctx, session, config)
    if (!roots) return next()
    try {
      if (name === 'bash' || name === 'pwsh') {
        const cmd = typeof exec.arguments.command === 'string' ? exec.arguments.command : ''
        if (!cmd) return next()
        const r = classifyBash(cmd, roots, config.categories, config.mode)
        // 严格模式（2026-08-19）：高危类别即使沙箱允许也强制人工确认（主动发审批，必弹窗）
        if (config.strictHighRisk && LOCKED_ASK.has(r.c)) {
          const approval = ctx.get('approval')
          if (approval === undefined || !exec || !exec.agent) {
            record({ tool: name, cmd: summarize(cmd), decision: 'deny', category: r.c })
            return { kind: 'deny', reason: 'perm-guard 严格模式: 无审批通道，拒绝 (' + r.c + ')' }
          }
          const outcome = await approval.request({
            agent: exec.agent,
            toolName: name,
            callId: exec.callId,
            reason: 'perm-guard 严格模式需确认 (' + r.c + '): ' + summarize(cmd),
          })
          if (outcome === 'allowed-once') {
            record({ tool: name, cmd: summarize(cmd), decision: 'allowed-once-strict', category: r.c })
            return next()
          }
          record({ tool: name, cmd: summarize(cmd), decision: 'rejected-strict', category: r.c })
          return { kind: 'deny', reason: 'perm-guard 严格模式已拒绝 (' + r.c + '): ' + summarize(cmd) }
        }
        if (!firewallCats(config.mode).has(r.c)) return next()
        if (r.d === 'allow') return next()
        if (r.d === 'deny') { record({ tool: name, cmd: summarize(cmd), decision: 'deny', category: r.c }); return { kind: 'deny', reason: 'perm-guard: 该操作被类别规则禁止 (' + r.c + ')' } }
        record({ tool: name, cmd: summarize(cmd), decision: 'ask-human', category: r.c })
        return { kind: 'ask', reason: 'perm-guard: 需要人工确认 (' + r.c + '): ' + summarize(cmd) }
      }
      const target = exec.arguments.file_path || exec.arguments.path || ''
      const t = typeof target === 'string' ? target.trim() : ''
      if (!t) return next()
      const resolved = realOf(t)
      if (matchAny(PROTECTED, t) || matchAny(PROTECTED, ' ' + t + ' ') || matchAny(PROTECTED, ' ' + resolved + ' ')) { record({ tool: name, target: t, decision: 'ask-human', category: 'protected' }); return { kind: 'ask', reason: 'perm-guard: 受保护路径写入需人工确认: ' + t } }
      return next()
    } catch (e) {
      console.error('[perm-guard] firewall failed: ' + (e && e.message ? e.message : String(e)))
      return next()
    }
  })

  // ===== 严格模式守卫（2026-08-19 v0.1.8）：tools.guard 官方钩子，可靠拦截所有工具执行
  // （pre-execute 事件 scope 隔离 perm-guard 收不到；guard 同步 deny，agent 带
  //  sandbox_permissions 重试 → 沙箱提权审批 → 弹窗确认。拒绝即安全：不确认不执行）=====
  const tools = ctx.get('tools')
  if (tools !== undefined && typeof tools.guard === 'function') {
    ctx.effect(() => tools.guard((exec) => {
      try {
        if (!config.enabled || !config.strictHighRisk) return undefined
        const name = exec.name
        if (name !== 'bash' && name !== 'pwsh') return undefined
        const cmd = exec.arguments && typeof exec.arguments.command === 'string' ? exec.arguments.command : ''
        if (cmd === '') return undefined
        const session = exec.agent && exec.agent.session ? exec.agent.session : null
        const roots = trustRootsOf(ctx, session, config)
        if (!roots) return undefined
        const r = classifyBash(cmd, roots, config.categories, config.mode)
        if (LOCKED_ASK.has(r.c)) {
          record({ tool: name, cmd: summarize(cmd), decision: 'deny-strict', category: r.c })
          return 'perm-guard 严格模式：高危操作被拒绝 (' + r.c + ')。如需执行请带 sandbox_permissions+justification 提权重试（会弹人工确认）'
        }
      } catch (error) {
        console.error('[perm-guard] strict guard failed: ' + (error && error.message ? error.message : String(error)))
      }
      return undefined
    }), 'perm-guard: strict guard')
  }

  // ===== 状态读写 HTTP 端点 =====
  // P1 修复（本地 CSRF）：校验 Origin/Host 必须为本机，恶意网页无法关守卫/改配置
  const isSameOrigin = (req) => {
    const origin = req.headers.origin || ''
    if (origin !== '') return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
    const host = req.headers.host || ''
    return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
  }
  webServer.register({
    kind: 'exact',
    path: '/api/perm-guard/state',
    handler: async (req, res) => {
      try {
        if (!isSameOrigin(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: cross-origin request' })
        if (req.method === 'GET' || req.method === undefined) {
          return writeJson(res, 200, { ok: true, enabled: config.enabled, mode: config.mode, categories: config.categories, trustedDirs: config.trustedDirs, strictHighRisk: config.strictHighRisk === true, audit: audit.slice().reverse() })
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const patch = {}
          if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
          if (body.mode === 'standard' || body.mode === 'aggressive') {
            patch.mode = body.mode
            // 切换模式同步重置类别开关为该模式默认（与 UI 显示的当前模式行为一致）
            patch.categories = body.mode === 'aggressive' ? { ...AGGRESSIVE_CATEGORIES } : { ...CATEGORY_DEFAULTS }
          }
          if (body.categories && typeof body.categories === 'object') {
            const nextCats = {}
            for (const k of Object.keys(config.categories)) {
              // 高危类别锁定：LOCKED_ASK 键不接受 auto/deny（saveConfig 兜底再强制 ask）
              if (LOCKED_ASK.has(k)) { nextCats[k] = 'ask'; continue }
              if (['auto', 'ask', 'deny'].includes(body.categories[k])) nextCats[k] = body.categories[k]
            }
            patch.categories = nextCats
          }
          if (Array.isArray(body.trustedDirs)) patch.trustedDirs = body.trustedDirs.filter((d) => typeof d === 'string' && d.startsWith('/'))
          if (typeof body.strictHighRisk === 'boolean') patch.strictHighRisk = body.strictHighRisk
          saveConfig(patch)
          return writeJson(res, 200, { ok: true, enabled: config.enabled, mode: config.mode, categories: config.categories, trustedDirs: config.trustedDirs, strictHighRisk: config.strictHighRisk === true })
        }
        return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      } catch (e) {
        return writeJson(res, 500, { ok: false, error: e && e.message ? e.message : String(e) })
      }
    }
  })
}
