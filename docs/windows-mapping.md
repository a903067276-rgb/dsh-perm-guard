# Windows 适配：11 操作类别 × 命令对应总表

> 本表为 dsh-perm-guard Windows 适配补丁（r1–r4）的完整映射。默认档 = standard；
> 「锁定人工」类别不受模式开关影响，永远需要人工确认。

| 类别 | 默认档 | Windows 对应命令 |
|---|---|---|
| 文件编辑 fileEdit | 信任目录内自动 | cp / mv / mkdir / touch / sed / ln 等原有项；PowerShell：Set-Content、Add-Content、Out-File、Copy-Item、Move-Item、New-Item、Tee-Object、Export-Csv、Export-Clixml、Clear-Content*、Rename-Item*、Compress-Archive*、Expand-Archive* |
| Git 本地操作 gitLocal | 自动 | add / commit / merge / rebase / checkout / switch / branch / restore / stash / rm / mv / cherry-pick / revert / am（git 跨平台一致） |
| 构建·测试·依赖 build | 自动 | npm / pnpm / yarn / bun / tsc / vite / webpack / rollup / esbuild / make / cmake / cargo / go / gradle / mvn / poetry / uv / pip / docker；新增 dotnet*、msbuild*、ninja*、gcc/g++/clang(++)*（`dotnet publish` 单独归发布类） |
| 只读查询 readOnly | 自动 | ls / cat / grep / git status 等原有项；PowerShell 管道件 Select-Object/Where-Object/Format-* 等；新增 where、netstat、tracert、tasklist、systeminfo、hostname、Get-FileHash、Get-Acl、Get-AuthenticodeSignature、Get-Volume、Get-Disk、Get-NetIPAddress/Adapter/TCPConnection、Get-CimInstance、Get-WmiObject、Get-WinEvent、Get-EventLog、Get-ScheduledTask、reg query* |
| 不可逆删除 delete | 锁定人工 | rm / rmdir / unlink / git clean -f / reset --hard(硬红线)；Remove-Item 直接硬红线；新增 del、erase、rd、Clear-RecycleBin* |
| 受保护路径 protected | 锁定人工 | .ssh / .aws / .config / .gnupg / .kube / .env / rc 文件 / 密钥文件(.pem/.key/.p12/.pfx) / id_rsa / .git/ 及其反斜杠变体；新增系统根目录 C:\Windows\*、Program Files(\(x86\))\*、ProgramData\*、drivers\etc\(hosts)* |
| 提权·系统管理 privilege | 锁定人工 | sudo 系 / 服务管理 / chmod -R / chown -R / Stop-/Start-Process·Service / reg add / sc config / schtasks / net user / Set-ExecutionPolicy / MpPreference / wmic 写操作 / takeown / icacls /grant；新增 runas*、gsudo*(硬红线)、winget install*、choco install/upgrade/uninstall*、scoop install*、dism*、sfc*、netsh*、msiexec /i*、Install-/Uninstall-Module*、Install-/Uninstall-Package*、Register-ScheduledTask 等*、New-/Set-/Remove-Service*、*-NetFirewallRule*、Rename-Computer*、New-/Set-/Remove-ItemProperty* |
| 网络下载执行 networkExec | standard=人工 / aggressive=自动 | curl(-exe 后缀已归一) / wget / scp / rsync / iwr / irm / Invoke-RestMethod；新增 certutil -urlcache*、bitsadmin /transfer*、Start-BitsTransfer*（LOLBin 下载通道） |
| Git 推送远端 gitPush | standard=人工 / aggressive=自动 | git push（--force/-f 升级为硬红线 danger） |
| 发布·部署 publish | standard=人工 / aggressive=自动 | npm / yarn / pnpm publish、docker push、kubectl apply|create|delete|edit|scale|rollout、helm install|upgrade|delete|rollback；新增 dotnet publish*、gh release create* |
| 磁盘·分区·设备 disk | 锁定人工 | dd of=/dev、mkfs/fdisk/wipefs/shred/gdisk/parted、diskutil erase、Clear-/Initialize-Disk、diskpart*、format X:*、bcdedit*、vssadmin delete shadows*、cipher /w*；新增 Optimize-Volume*、Repair-Volume*、chkdsk /f|r|x*、mountvol*、fsutil*(硬红线) |

带 `*` 为本适配新增或显著扩充的条目。

## 落点语义说明（四轮核心修正）

`extractTargets` 收集全部"落点语义"旗标作为候选写入目标：
**-Path / -LiteralPath / -Destination / -DestinationPath / -FilePath**

- `Expand-Archive -Path <读取源> -DestinationPath <落点>`：`-Path` 是读取源，
  只查 `-Path` 会漏掉外部解包目的地（真实漏洞，四轮修复）；
- `Copy-Item -Path <信任内> -Destination <信任外>` 同理被堵住；
- 任一候选目标在信任边界外即转人工（只收紧不放宽）；全部缺失时才回退
  "最后一个非旗标参数"启发式。

## 复合命令语义

`;` / `&&` / `||` / `|` 分段后逐段分类取最严判定；任一段落入锁定人工或
不可分类（unknown），整条复合命令转人工——包括命令文本中仅以字符串形式
出现危险关键字的情况（如审计查询脚本里引用了 `Remove-Item` 字样）。
