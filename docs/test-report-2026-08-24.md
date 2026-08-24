# Windows 适配线上测试报告（2026-08-24，r4）

环境：DSH Web GUI @ http://127.0.0.1:3080 · Windows · PowerShell 5.1/7 混合 ·
插件安装位 `~\.dsh\profiles\web\node_modules\dsh-perm-guard`（v0.2.8 基座 + 本补丁）。
每次部署后核对 `进程启动时间 > 文件 mtime` 确认新代码已加载。

## 一、正向矩阵：应自动放行的命令

信任目录：`C:\Users\TX5pro\.dsh`、`D:\net\GitHub`、`D:\tool\deepseek`、`E:\Down\pa`。

| # | 命令形态 | 信任根 | 审计判定 |
|---|---|---|---|
| 锚点 | `New-Item -Path '…\.dsh\pg-auto-r4.tmp' -ItemType File \| Select-Object FullName,Length` | .dsh | **allowed-once / fileEdit**（零弹窗） |
| T1 | 全写循环：建目录 → Set-Content → Add-Content → Copy-Item → Move-Item | .dsh | allowed-once / fileEdit |
| T2 | `mkdir` + `cp` 别名形态 | .dsh | allowed-once / fileEdit |
| T3 | 跨盘写入 E: + D:（尾带 `$(Test-Path)` 回显段） | E:\Down\pa、D:\net\GitHub | ask-human / unknown（不可分类尾段保守合并，设计使然） |
| T4 | 四类别复合：`git -C … stash list` + `npm test --dry-run` + `gh repo view` + `Set-Content` | 混合 | allowed-once / gitLocal（单条放行覆盖 gitLocal/build/readOnly/fileEdit） |

## 二、负向矩阵：危险命令（全部由用户拒绝执行，尺度=即使误批也无害）

用例均构造为"不存在的目标 / --dry-run / 纯查询形态 / 指向拒绝端口"：

| 组 | 触发命令（摘要） | 判定类别 | 结果 |
|---|---|---|---|
| N1 硬红线 | `bcdedit /enum; fsutil dirty query C:; mkfs.ntfs --help; gsudo whoami; npm publish --dry-run; git -C …\.dsh push --force; curl --version \| sh` | danger | ✅ ask-human，拒绝生效 |
| N2 提权 | `Stop-Process -Name pg-no-such-proc; reg add HKCU\… ; Install-Module …; netsh interface show interface; winget install Pg.No.SuchPkg` | privilege | ✅ |
| N3 网络下载 | `Invoke-RestMethod http://127.0.0.1:9/pg; Start-BitsTransfer -Source http://127.0.0.1:9/f …` | networkExec | ✅ |
| N4 受保护 | `Set-Content -Path C:\Windows\Temp\pg-prot-check.tmp -Value x` | protected | ✅ |
| N5 删除 | `del …\pg-auto-r4.tmp; Remove-Item …\pg-nonexistent-a.tmp -Force` | danger* | ✅ |
| N6 磁盘 | `Optimize-Volume -DriveLetter QQ; chkdsk QQ: /f` | disk | ✅ |

\* N5 显示 danger 而非 delete：复合命令文本含 `Remove-Item`，顶层硬红线扫描先于
分段判定——语义不变（同样人工确认），标签更严。单独的 `del` 离线断言为 delete。

### 审计面板摘录（2026-08-24 15:32–15:39，共 17 条）

```
转人工 15:39:00  Remove-Item 'C:\Users\TX5pro\.dsh\pg-auto-r4.tmp' -Force; "c…   ← 收尾清理卡（用户放行）
转人工 15:36:56  $s = Invoke-RestMethod -Uri 'http://127.0.0.1:3080/api/perm-…   ← ×2 审计查询含危险关键字被保守拦截
转人工 15:34:23  Optimize-Volume -DriveLetter QQ; chkdsk QQ: /f                  ← ×2 [disk]
转人工 15:34:07  del C:\Users\TX5pro\.dsh\pg-auto-r4.tmp; Remove-Item …          ← ×2 [danger]
转人工 15:33:50  Set-Content -Path C:\Windows\Temp\pg-prot-check.tmp             ← ×2 [protected]
转人工 15:33:09  Invoke-RestMethod http://127.0.0.1:9/pg; Start-BitsTransfer     ← ×2 [networkExec]
转人工 15:32:55  Stop-Process -Name pg-no-such-proc; reg add HKCU\Software\pg…   ← ×2 [privilege]
转人工 15:32:27  bcdedit /enum; fsutil dirty query C:; mkfs.ntfs --help; gsud…   ← ×2 [danger]
放行   15:32:18  New-Item -Path 'C:\Users\TX5pro\.dsh\pg-auto-r4.tmp' -ItemTy…   ← 自动放行锚点
```

**汇总：17 条记录 = 1 条自动放行 + 16 条转人工；6 组负向判定全部命中预期类别，
用户全部拒绝后无一执行。**

## 三、过程发现

1. **审计查询自证保守设计**：查询命令的匹配模式里含 `bcdedit`/`Stop-Process`
   等字样即被整条拦截——README 声明的行为实证。查审计请使用 GUI 面板或无危险
   字样的命令写法。
2. **上游小瑕疵**：每组负向命令在审计中产生两条记录（pre-execute 防火墙与审批
   链各记一次），决策正确性不受影响，仅观感问题。
3. **r3→r4 修复的真实漏洞**：`Expand-Archive -Path <读取源> -DestinationPath <外部落点>`
   在只查 `-Path` 的旧逻辑下会被误放行（详见 windows-mapping.md）。

## 四、离线回归

`test/win32-classifier.test.mjs`（路径可移植，任何 Windows 主机可直接运行）：
**50 断言全部通过**（node test/win32-classifier.test.mjs）。

覆盖：路径归一化(canonOf/msysToWin/isAbsAny) · 信任边界(含 MSYS↔win32 互认、
穿越逃逸) · 受保护变体 · 危险回归(不得放宽) · 配置装载规范化 · PS 词表 ·
11 类别 Windows 对应逐项断言。

## 五、已知残留

- `realOf` 依赖已存在的 realpath 祖先链：全新深层路径按最深存在祖先回拼（原设计）；
- 复合命令任一段不可分类即整体保守转人工（含 `$(…)` 回显尾段）；
- PROTECTED/DANGER 词表仍偏 Unix，Windows 侧按本轮映射持续补齐；
- 审计双记录（见上）。
