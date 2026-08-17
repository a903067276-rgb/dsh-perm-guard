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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-perm-guard'
export const inject = ['webServer']

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
const DEFAULTS = { enabled: true, mode: 'standard', categories: { ...CATEGORY_DEFAULTS }, trustedDirs: [] }

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
      trustedDirs: Array.isArray(j.trustedDirs) ? j.trustedDirs.filter((d) => typeof d === 'string') : []
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
  /(^|\s)\/(etc|usr|System|Library|Applications)(\/|\s|$)/,
  /\/dev\/(?!null\b)/, // 写设备（/dev/null 除外——标准丢弃输出，无害）
  /\.(pem|key|p12|pfx)(\s|$)/,
  /(id_rsa|id_ed25519|authorized_keys)(\s|$)/,
  /\.git\//
]
const READONLY = new Set(['ls', 'cat', 'echo', 'pwd', 'head', 'tail', 'grep', 'find', 'wc', 'which', 'diff', 'stat', 'du', 'cd', 'less', 'more', 'file', 'dirname', 'basename', 'uname', 'date', 'env', 'printenv', 'type', 'df', 'ps', 'top', 'free', 'uptime', 'whoami', 'id', 'groups', 'history', 'true', 'false', 'sleep', 'test', 'printf', 'Get-Content', 'Get-ChildItem', 'Get-Process', 'Get-Item', 'Select-String', 'Get-Date', 'Write-Output', 'Get-Location'])
const GIT_READONLY = new Set(['status', 'log', 'diff', 'show', 'blame', 'remote', 'branch', 'tag', 'stash', 'ls-files', 'rev-parse', 'config', 'help'])
const GIT_LOCAL = new Set(['add', 'commit', 'merge', 'rebase', 'checkout', 'switch', 'branch', 'restore', 'stash', 'rm', 'mv', 'cherry-pick', 'revert', 'am'])
const BUILD = new Set(['npm', 'pnpm', 'yarn', 'bun', 'tsc', 'vite', 'webpack', 'rollup', 'esbuild', 'make', 'cmake', 'cargo', 'go', 'gradle', 'mvn', 'poetry', 'uv', 'pip', 'pip3', 'docker'])
const BUILD_SUB = new Set(['install', 'ci', 'test', 'run', 'build', 'exec', 'check', 'fmt', 'clippy', 'vet', 'mod', 'compile', 'compose', 'pull', 'audit', 'init', 'preview', 'lint', 'fix', 'format'])
const BUILD_SUB2 = new Set(['install', 'test', 'build', 'run', 'compile', 'package', 'verify', 'validate', 'audit', 'lint', 'fix', 'format'])
const WRITE_CMDS = ['cp', 'mv', 'install', 'ln', 'mkdir', 'touch', 'sed', 'awk', 'tr', 'dd', 'rm', 'rmdir', 'unlink', 'Set-Content', 'Add-Content', 'Out-File', 'Copy-Item', 'Move-Item', 'New-Item', 'Remove-Item']
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
const inTrust = (target, roots) => {
  const t = normPath(target)
  if (!t.startsWith('/')) return false
  for (const r of roots) { const root = normPath(r); if (t === root || t.startsWith(root + '/')) return true }
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
    if (redirs || tee || outOpt || WRITE_CMDS.includes(name)) return []
    return null
  }
  return targets.map((t) => t.replace(/^['"]|['"]$/g, ''))
}

const catOf = (categories, key) => { const v = categories[key] || 'ask'; return { d: v, c: key } }

function classifyCommand(cmd, trustRoots, categories, mode) {
  const c = cmd.trim()
  if (c === '') return { d: 'allow', c: 'readOnly' }
  if (matchAny(DANGER, c)) return { d: 'ask', c: 'danger' }
  if (matchAny(PROTECTED, c)) return { d: 'ask', c: 'protected' }
  const name = cmdNameOf(c)
  const targets = extractTargets(c)
  if (targets !== null) {
    if (targets.length === 0) return { d: 'ask', c: 'unknown' }
    // 标准档：写目标必须在信任目录才可能自动；激进档：位置不限（只拦破坏性）
    if (mode !== 'aggressive') {
      for (const t of targets) if (!inTrust(t, trustRoots)) return { d: 'ask', c: 'outside' }
    }
    if (name === 'rm' || name === 'rmdir' || name === 'unlink' || name === 'Remove-Item') return catOf(categories, 'delete')
    if (name === 'brew' || name === 'port' || name === 'useradd' || name === 'passwd') return catOf(categories, 'privilege')
    if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
      if (mode !== 'aggressive' && /-g\b|--global/.test(c)) return catOf(categories, 'privilege')
      if (mode !== 'aggressive' && subOf(c) === 'publish') return catOf(categories, 'publish')
    }
    return catOf(categories, 'fileEdit')
  }
  if (mode === 'aggressive') return { d: 'allow', c: 'unknown' } // 激进档：未知命令全放行
  if (READONLY.has(name)) return catOf(categories, 'readOnly')
  if (name === 'git') {
    const sub = subOf(c)
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
  if (matchAny(DANGER, cmd) || matchAny(PROTECTED, cmd)) return { d: 'ask', c: matchAny(DANGER, cmd) ? 'danger' : 'protected' }
  const parts = splitCommands(cmd)
  if (parts === null) return classifyCommand(cmd, trustRoots, categories, mode)
  let worst = { d: 'allow', c: 'readOnly' }
  for (const part of parts) {
    const r = classifyCommand(part, trustRoots, categories, mode)
    if (r.d === 'deny') return r
    if (r.d === 'ask') worst = r
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
    config = {
      ...config,
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(patch.mode === 'standard' || patch.mode === 'aggressive' ? { mode: patch.mode } : {}),
      categories: { ...config.categories, ...(patch.categories || {}) },
      trustedDirs: Array.isArray(patch.trustedDirs) ? patch.trustedDirs : config.trustedDirs
    }
    try {
      mkdirSync(dirname(configPath()), { recursive: true })
      writeFileSync(configPath(), JSON.stringify({ enabled: config.enabled, mode: config.mode, categories: config.categories, trustedDirs: config.trustedDirs }, null, 2))
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
      if (!roots) return next()
      const call = lookupCall(req)
      if (!call) return next()
      if (req.toolName === 'bash' || req.toolName === 'pwsh') {
        const cmd = typeof call.args.command === 'string' ? call.args.command : ''
        if (!cmd) return next()
        const r = classifyBash(cmd, roots, config.categories, config.mode)
        if (r.d === 'allow') { record({ tool: req.toolName, cmd: summarize(cmd), decision: 'allowed-once', category: r.c }); return 'allowed-once' }
        if (r.d === 'deny') { record({ tool: req.toolName, cmd: summarize(cmd), decision: 'rejected', category: r.c }); return 'rejected' }
        record({ tool: req.toolName, cmd: summarize(cmd), decision: 'ask-human', category: r.c })
        return next()
      }
      if (req.toolName === 'write' || req.toolName === 'edit') {
        const target = call.args.file_path || call.args.path || ''
        const t = typeof target === 'string' ? target.trim() : ''
        if (!t) return next()
        if (matchAny(PROTECTED, t) || matchAny(PROTECTED, ' ' + t + ' ')) { record({ tool: req.toolName, target: t, decision: 'ask-human', category: 'protected' }); return next() }
        if (inTrust(t, roots)) { record({ tool: req.toolName, target: t, decision: 'allowed-once', category: 'fileEdit' }); return 'allowed-once' }
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
  ctx.on('tools/pre-execute', (exec, next) => {
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
        if (!firewallCats(config.mode).has(r.c)) return next()
        if (r.d === 'allow') return next()
        if (r.d === 'deny') { record({ tool: name, cmd: summarize(cmd), decision: 'deny', category: r.c }); return { kind: 'deny', reason: 'perm-guard: 该操作被类别规则禁止 (' + r.c + ')' } }
        record({ tool: name, cmd: summarize(cmd), decision: 'ask-human', category: r.c })
        return { kind: 'ask', reason: 'perm-guard: 需要人工确认 (' + r.c + '): ' + summarize(cmd) }
      }
      const target = exec.arguments.file_path || exec.arguments.path || ''
      const t = typeof target === 'string' ? target.trim() : ''
      if (!t) return next()
      if (matchAny(PROTECTED, t) || matchAny(PROTECTED, ' ' + t + ' ')) { record({ tool: name, target: t, decision: 'ask-human', category: 'protected' }); return { kind: 'ask', reason: 'perm-guard: 受保护路径写入需人工确认: ' + t } }
      return next()
    } catch (e) {
      console.error('[perm-guard] firewall failed: ' + (e && e.message ? e.message : String(e)))
      return next()
    }
  })

  // ===== 状态读写 HTTP 端点 =====
  webServer.register({
    kind: 'exact',
    path: '/api/perm-guard/state',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET' || req.method === undefined) {
          return writeJson(res, 200, { ok: true, enabled: config.enabled, mode: config.mode, categories: config.categories, trustedDirs: config.trustedDirs, audit: audit.slice().reverse() })
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const patch = {}
          if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
          if (body.mode === 'standard' || body.mode === 'aggressive') patch.mode = body.mode
          if (body.categories && typeof body.categories === 'object') {
            const nextCats = {}
            for (const k of Object.keys(config.categories)) {
              if (['auto', 'ask', 'deny'].includes(body.categories[k])) nextCats[k] = body.categories[k]
            }
            patch.categories = nextCats
          }
          if (Array.isArray(body.trustedDirs)) patch.trustedDirs = body.trustedDirs.filter((d) => typeof d === 'string' && d.startsWith('/'))
          saveConfig(patch)
          return writeJson(res, 200, { ok: true, enabled: config.enabled, mode: config.mode, categories: config.categories, trustedDirs: config.trustedDirs })
        }
        return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      } catch (e) {
        return writeJson(res, 500, { ok: false, error: e && e.message ? e.message : String(e) })
      }
    }
  })
}
