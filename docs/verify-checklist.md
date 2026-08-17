# dsh-perm-guard 重启后验证清单（2026-08-17）

> 静态 bundle 安装完成，重启 `dsh web` 后按此清单逐项验证。
> 重启：`bash ~/.dsh/restart-dsh-web.sh`（最后一步执行）。

## 1. 挂载与配置

- [ ] `~/.dsh/perm-guard.json` 生成（enabled: true + 11 类别默认值 + trustedDirs: []）
- [ ] 插件日志无报错（`grep perm-guard ~/.dsh/logs/dsh-web.log` 或宿主 stdout）

## 2. UI

- [ ] 输入框工具行左侧出现 **Auto ✓** 按钮（绿色）
- [ ] 设置侧栏出现 **Auto 权限** 页（第 5 项），打开可见 11 类别开关 + 信任目录 + 审计

## 3. 行为（在 Auto 开启下）

- [ ] **跨目录写信任目录**（如 `mkdir -p <工作区父目录>/perm-guard-test`）：沙箱拒绝 → 带
      `sandbox_permissions` 重试 → **自动放行无弹窗**（会话日志 approval/asked→decided 间隔
      <100ms，outcome=allowed-once）
- [ ] **不可逆删除**（`rm -rf <路径>`）：**弹窗人工确认**（防火墙提前拦截，无沙箱拒绝往返）
- [ ] **只读未知命令**（如 `node -e "console.log(1)"`）：直接执行不弹窗
- [ ] **受保护路径**（write 到 `~/.ssh/x`）：弹窗人工确认
- [ ] Auto 按钮点击关闭后：跨目录 mkdir 重试 → 弹窗（回宿主默认）

## 4. 配置持久化

- [ ] 设置页把「删除」切到「拒绝」→ 之后 rm 直接返回拒绝（不弹窗）
- [ ] 重启 dsh web 后设置保持（读 ~/.dsh/perm-guard.json）

## 5. 审计

- [ ] 设置页审计列表显示最近判定（放行/转人工/拒绝 + 时间 + 命令摘要）
- [ ] 会话日志每次审批成对：approval/asked + approval/decided

## 备注

- 动态版（permg-1）已停止；静态版经 profile bundles + 插件自带 cordis.patch.yml 挂载（id: perm-guard）
- 配置默认值即用户习惯：commit/merge/文件编辑/构建/只读 = 自动；删除/受保护/提权/网络执行/推送/发布/磁盘 = 人工
- 规则边界：网络无 OS 级断网（仅 curl|sh 模式）；终端/MCP/子代理无审批机制

## 补充验证（激进模式 + 模式同步，2026-08-17 第二轮重启后）

- [x] 激进档 bash：跨目录/系统目录 mkdir 自动放行（跳过信任目录限制）
- [x] 激进档 fs（write/edit）：~/.dsh 下写文件自动放行（审计 allowed-once/fileEdit）
- [x] 模式切换同步类别：POST standard → privilege/gitPush 等回 ask；POST aggressive → 除 delete/protected/disk 外全 auto
- [x] 配置持久化：重启后 mode 保持（读 ~/.dsh/perm-guard.json）
- [x] 修复：write/edit 分支接 mode（此前漏改导致激进档 fs 仍弹窗）
- [x] 修复：/dev/null 不再误判受保护路径
- [x] 修复：切换模式重置类别开关（UI 有提示）

### 激进档拦截底线（永不自动）
删除（rm/Remove-Item/reset --hard/clean -fd）、磁盘（dd/mkfs/fdisk/diskutil）、
受保护路径（.ssh/.aws/密钥/.env/系统目录）、提权（sudo/su/系统服务）、
网络下载执行（curl|sh）、force push、chmod/chown 递归根。
