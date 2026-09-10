// 离线冒烟测试：从 lib/index.js 提取 sessionEventsOf + lookupCall，在受控作用域里跑断言。
// 背景（2026-09-10）：dsh 0.1.5 移除了 Session.events，lookupCall 因此拿不到工具参数，
// 审批自动判定全线失效（所有请求回落宿主弹窗）。修复=新增 sessionEventsOf 适配两条宿主路径。
// 本测试不触碰线上安装与 ~/.dsh 真实配置，任何平台可直接 `node test/session-events.test.mjs`。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const src = readFileSync(SRC, 'utf8')
const start = src.indexOf('function sessionEventsOf')
const end = src.indexOf('// 写语义判定')
if (start < 0 || end < 0 || end <= start) throw new Error('marker not found')

const body = src.slice(start, end)
const factory = new Function(`"use strict";
  ${body}
  return { sessionEventsOf, lookupCall };
`)
const { sessionEventsOf, lookupCall } = factory()

let passed = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed += 1; return }
  failures.push(`${name}\n    期望: ${e}\n    实际: ${a}`)
}

const callEvent = (callId, name, args) => ({ type: 'tool/call', data: { callId, name, arguments: args } })
const reqWith = (session, callId = 'call_1') => ({ callId, agent: { session } })

// ── ① 新宿主（0.1.5+）：用 snapshotEvents() ──────────────────────────
const newHost = {
  snapshotEvents: () => [
    { type: 'user/message', data: {} },
    callEvent('call_1', 'bash', { command: 'ls -la' }),
  ],
}
check('新宿主：snapshotEvents 命中', lookupCall(reqWith(newHost)), { name: 'bash', args: { command: 'ls -la' } })

// ── ② 旧宿主（≤0.1.2）：仍走 session.events ─────────────────────────
const legacyHost = {
  events: [callEvent('call_1', 'write', { file_path: '/tmp/a.txt' })],
}
check('旧宿主：session.events 命中', lookupCall(reqWith(legacyHost)), { name: 'write', args: { file_path: '/tmp/a.txt' } })

// ── ③ 参数是 JSON 字符串（宿主序列化差异）───────────────────────────
const jsonArgs = { snapshotEvents: () => [callEvent('call_1', 'edit', '{"file_path":"/tmp/b.txt"}')] }
check('字符串 args 反序列化', lookupCall(reqWith(jsonArgs)), { name: 'edit', args: { file_path: '/tmp/b.txt' } })

// ── ④ 倒序扫描：同 callId 取最后一条 ────────────────────────────────
const dupes = {
  snapshotEvents: () => [
    callEvent('call_1', 'bash', { command: 'old' }),
    callEvent('call_1', 'bash', { command: 'new' }),
  ],
}
check('同 callId 取最后一条', lookupCall(reqWith(dupes)), { name: 'bash', args: { command: 'new' } })

// ── ⑤ 兜底：拿不到事件一律 null（=回落人工审批，绝不放行）───────────
check('无 session', lookupCall({ callId: 'call_1', agent: {} }), null)
check('无 callId', lookupCall({ agent: { session: newHost } }), null)
check('两条路都没有', lookupCall(reqWith({})), null)
check('callId 不匹配', lookupCall(reqWith(newHost, 'call_zzz')), null)
check('空事件表', lookupCall(reqWith({ snapshotEvents: () => [] })), null)

// ── ⑥ snapshotEvents 抛错时不得炸掉审批链 ──────────────────────────
const thrower = { snapshotEvents: () => { throw new Error('boom') } }
let threw = false
let result = 'unset'
try { result = lookupCall(reqWith(thrower)) } catch { threw = true }
check('snapshotEvents 抛错 → 不抛出且返回 null', { threw, result }, { threw: false, result: null })

// ── ⑦ sessionEventsOf 直测：非数组返回值按"拿不到"处理 ──────────────
check('snapshotEvents 返回非数组', sessionEventsOf({ snapshotEvents: () => null }), null)
check('null session', sessionEventsOf(null), null)

if (failures.length > 0) {
  console.error(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项\n`)
  for (const f of failures) console.error('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`✓ lookupCall 适配测试全部通过（${passed}/${passed}）`)
