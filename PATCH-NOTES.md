# dsh-perm-guard Windows 兼容补丁（winfix）

基线：官方 web profile 安装副本（upstream commit `dcd8835`，tarball 安装）。
状态：**已打补丁 + 离线冒烟测试 16/16 通过，未部署**（部署需提权写入 profiles\web 并重启 DSH）。

## 根因回顾（为什么"信任目录保存后为空"）

1. **服务端静默丢弃**（原 index.js POST 处理器）：`trustedDirs.filter(d => d.startsWith('/'))`
   —— `C:/…`、`C:\…` 风格条目全部被丢，但响应仍 `ok:true`，前端闪「✓ 已保存」后重绘出空列表。
2. **MSYS 条目存得进但不生效**（inTrust 强制 `t.startsWith('/')`）：Windows 原生路径一律判
   "信任外"，连默认工作区根都失效——即任何输入格式都无法端到端生效。
3. **配置不热加载**（loadConfig 仅插件加载时读一次）：外部手改 perm-guard.json 不重启不生效，
   内存态与磁盘分叉（实测 live API 返回 trustedDirs=[] 而磁盘文件有 5 条）。

## 补丁内容

### lib/index.js
| # | 位置 | 改动 |
|---|------|------|
| 1 | import | 增加 `watchFile` |
| 2 | PROTECTED | 新增反斜杠分隔符变体正则（`.ssh/.aws/.config/.gnupg/.kube/.git`），Windows 形态不再漏拦 |
| 3 | loadConfig | 拆为 shapeConfig/readConfigFile/loadConfig；解析失败返回 null 而非默认值（热重载遇坏 JSON 不冲掉好配置）；装载时统一规范化条目 |
| 4 | 工具函数 | 新增 `isAbsAny`（POSIX 与盘符路径均算绝对）、`msysToWin`（/c/… ↔ C:/…）、`canonOf`（正斜杠+小写盘符规范形）；normPath/parentOf 兼容反斜杠 |
| 5 | inTrust | 去掉 `startsWith('/')` 硬门；两侧 canonOf 后用 `/` 前缀比较 |
| 6 | apply() | 配置热重载：watchFile 轮询(5s)，成功解析才替换内存配置 |
| 7 | extractTargets | `-Path/-LiteralPath` 显式值纳入写目标候选（PowerShell 动词前置命令的落点不再漏判，只收紧不放宽） |
| 8 | POST 处理器 | 接受三种绝对路径写法，统一规范化存储；非法条目回传 `droppedDirs`，不再静默丢弃 |

### lib/client.js
- 两处 saveDirs：响应含 `droppedDirs` 时显示红字告警「部分保存：已忽略 N 条非绝对路径条目」，替代假成功；
- 两处 placeholder：补充 Windows 示例路径。

## 测试

`.tmp/test-permguard-winfix.mjs`（提取补丁文件的配置+规则表+分类器纯函数段离线断言）：
归一化 4 项、信任判定 6 项（含 MSYS↔win32 跨格式匹配、目录穿越防护）、受保护变体 2 项、
危险类别回归 4 项（reset --hard/Remove-Item 仍锁 ask）、混合格式装载 1 项 —— **16/16 通过**。

## 部署（二选一，均需 danger-full-access 提权 + 重启 DSH 生效）

- **A. 就地覆盖**：把本目录 `lib\*.js` 覆盖到
  `C:\Users\TX5pro\.dsh\profiles\web\node_modules\dsh-perm-guard\lib\`
  快；缺点是下次 `plugin update` 会被上游版本覆盖。
- **B. link 安装**：本目录移到固定位置后，改 profile 的 package.json 为
  `"dsh-perm-guard": "link:<路径>"` 并 pnpm install（对齐 dsh-composer-keys 先例），更新不丢。

重启后附带收益：运行时将首次读到磁盘上已有的 5 条 MSYS 条目（本补丁使其真实生效），内存/磁盘分叉消除。

## 回滚

用 `C:\Users\TX5pro\.dsh\profiles\web\node_modules\dsh-perm-guard\lib\` 的原始文件覆盖回来即可；
或方案 B 下把依赖指回 tarball URL 后 pnpm install。

## 已知残留（本次不动）

- realOf 依赖 realpath：信任目录指向磁盘上不存在的路径时无法参与匹配（原设计如此）；
- 写目标启发式仍以"最后非旗标参数"为主，`Set-Content <路径> <内容>` 语序仍会误读内容串（已修 -Path 显式形态）；
- PROTECTED/DANGER 正则主体仍偏 POSIX（/etc//usr/sudo 等），Windows 特有危险面覆盖有限；
- 上游 README 声称 Windows「预期可用」与 placeholder 全 macOS 示例的问题需在上游仓库修正（可回传 PR）。
