# dsh-perm-guard Windows 类别对应补全（第四轮 / r4）

基线：r3。状态：已打补丁 + 离线套件 **50/50 通过**，未做线上权限测试；重启后生效。

## 11 操作类别 × Windows 对应总表

| 类别 | 默认档 | Windows 对应（本轮补全加粗） |
|---|---|---|
| 文件编辑 fileEdit | 信任内自动 | cp/mv/mkdir/touch/sed/ln + Set-Content/Add-Content/Out-File/Copy-Item/Move-Item/New-Item/Tee-Object/Export-Csv/Export-Clixml/**Clear-Content/Rename-Item/Compress-Archive/Expand-Archive** |
| Git 本地 gitLocal | 自动 | add/commit/merge/rebase/checkout/switch/branch/restore/stash/rm/mv/cherry-pick/revert/am（git 本身跨平台一致） |
| 构建·测试·依赖 build | 自动 | npm/pnpm/yarn/bun/tsc/vite/webpack/rollup/esbuild/make/cmake/cargo/go/gradle/mvn/poetry/uv/pip/docker + **dotnet/msbuild/ninja/gcc/g++/clang/clang++**（dotnet publish 单独归发布类） |
| 只读查询 readOnly | 自动 | ls/cat/grep/git status 等 + Select-Object 等 PS 管道件 + **where/netstat/tracert/tasklist/systeminfo/hostname/Get-FileHash/Get-Acl/Get-AuthenticodeSignature/Get-Volume/Get-Disk/Get-Net*/Get-CimInstance/Get-WmiObject/Get-WinEvent/Get-EventLog/Get-ScheduledTask/reg query** |
| 不可逆删除 delete | 锁定人工 | rm/rmdir/unlink/git clean/reset --hard + Remove-Item(硬红线) + **del/erase/rd/Clear-RecycleBin** |
| 受保护路径 protected | 锁定人工 | .ssh/.aws/.config/.gnupg/.kube/.env/rc 文件/密钥文件(.pem/.key/.p12/.pfx)/.git/ + 反斜杠变体 + **C:\Windows\、Program Files(\(x86\))\、ProgramData\、drivers\etc\（hosts）** |
| 提权·系统管理 privilege | 锁定人工 | sudo/su/服务/useradd/passwd/chmod -R/chown -R + Stop-/Start-Process·Service + reg add/sc config/schtasks/net user/Set-ExecutionPolicy/MpPreference/wmic/takeown/icacls + **runas/gsudo→硬红线/winget install/choco/scoop/dism/sfc/netsh/msiexec /i/Install-Uninstall-Module·Package/Register-ScheduledTask/New-Set-Remove-Service/-NetFirewallRule/Rename-Computer/New-Set-Remove-ItemProperty** |
| 网络下载执行 networkExec | 标准人工/激进自动 | curl(-exe)/wget/scp/rsync/iwr/irm/Invoke-RestMethod + **certutil -urlcache/bitsadmin/Start-BitsTransfer（LOLBin 下载通道）** |
| Git 推送远端 gitPush | 标准人工/激进自动 | git push（--force/-f 走硬红线）——git 跨平台一致 |
| 发布·部署 publish | 标准人工/激进自动 | npm/yarn/pnpm publish/docker push/kubectl/helm + **dotnet publish/gh release create** |
| 磁盘·分区·设备 disk | 锁定人工 | dd of=/dev、mkfs/fdisk/wipefs/shred/gdisk/parted、diskutil erase、Clear/Initialize-Disk、diskpart/format X:/bcdedit/vssadmin delete shadows/cipher /w + **Optimize-Volume/Repair-Volume/chkdsk /f|r|x/mountvol/fsutil→硬红线** |

## 落点语义修正（四轮核心）

extractTargets 的落点旗标从单一 `-Path` 推广为 `-Path/-LiteralPath/-Destination/-DestinationPath/-FilePath` 全收集：
- `Expand-Archive -Path <读取源> -DestinationPath <落点>`——旧逻辑只查 -Path（源在信任内即放行），外部落点漏检；
- `Copy-Item -Path <信任内> -Destination <信任外>` 同理。
现全部候选逐个查边界，任一在外即转人工（只收紧不放宽）；全部缺失才回退末参数启发式。

## UI

设置页 11 个类别副标题同步补充 Windows 命令示例（client.js CATEGORY_ORDER）。

## 测试

`.tmp/test-permguard-winfix.mjs` 扩至 **50 断言全过**（新增 del/reg query/netsh/dism/winget/Install-Module/New-Service/certutil/Start-BitsTransfer/Optimize-Volume/chkdsk/dotnet publish/C:\Windows protected/fsutil/gsudo/Expand-Archive/Copy-Item 跨信任 17 项）。

## 部署与回滚

- 部署 A 就地覆盖 lib\index.js + lib\client.js（r3 版备份于 `.backup-winfix-r3\`），需重启 dsh web 生效。
- 回滚：用备份覆盖回去即可。
