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

## hud-test-repo 全类别验证矩阵（标准模式，2026-08-17 第三轮）

### A 系列·应自动放行（弹窗即误伤）
- [x] A1 write 到工作区兄弟目录 → 自动放行
- [x] A2 mkdir 兄弟目录 → 自动放行
- [x] A3 git commit（cd && 形式，含引号）→ 自动放行（根因修复后）
- [x] A4 node 只读 → 不弹窗
- [x] A5 `ls 2>/dev/null` → 不弹窗（修复后）

### B 系列·应弹窗（全部拒绝验证）
- [x] B1 write hud-test-repo（信任目录外）→ 弹窗拒绝
- [x] B2 write ~/.ssh（受保护路径）→ 弹窗拒绝
- [x] B3 rm（删除类）→ 弹窗拒绝
- [x] B4 sudo → 弹窗拒绝
- [x] B5 curl|sh → 弹窗拒绝
- [x] B6 git push（标准模式）→ 弹窗拒绝
- [x] B7 git push --force → 弹窗拒绝

### C 系列·边界
- [x] C1 `git -C <path> commit` → 误伤弹窗 → **已修复**（热插拔验证自动放行，类别 gitLocal）
- [x] C3 `echo x > /dev/null` → 不弹窗

### 本轮发现并修复的 bug（重要）
1. **根因**：catOf 返回类别开关原文（'auto'），answerer/防火墙只认 'allow' → 单条命令
   （不可拆）的 auto 类别全部误弹窗；复合命令因 worst 兜底掩盖。→ 归一化 auto→allow
2. `2>/dev/null` 纯丢弃重定向被当"有写行为无目标" → unknown ask → 视为无写行为
3. `git -C <path> <sub>` 子命令提取失败（sub='-C'）→ unknown ask → 跳过 -C 与路径
4. 边界记录：命令文本内含 "Remove-Item"/"sudo" 等敏感字样（如文档/测试脚本内容）
   会命中 DANGER 保守拦截——预期内保守行为，非 bug
5. 审计标签瑕疵：复合命令类别显示 readOnly（worst 初始值），不影响判定

### 热插拔测试结论
动态插件（permh-1）与静态版同源判定逻辑，prepend 优先生效；
热插拔验证与静态版等效，无需重启（本次验证采用该方式）。

## 激进模式热插拔验证矩阵（permh-1/pkg-2，2026-08-17 第四轮）

### A 系列·激进应自动放行（弹窗即误伤）
- [x] A1 write 到 hud-test-repo（信任目录外）→ 自动
- [x] A2 write 到 ~/.dsh（系统配置目录）→ 自动
- [x] A3 mkdir 信任目录外 → 自动
- [x] A4 git push（非 force）→ 自动（日志 allow）
- [x] A5 node 未知命令越界写 → 自动（日志 allow/unknown）
- [x] A6 git -C commit → 自动（日志 allow）

### B 系列·激进仍应弹窗（全部拒绝）
- [x] B1 rm → 弹窗拒绝（日志 ask/delete）
- [x] B2 write ~/.ssh → 弹窗拒绝
- [x] B3 sudo → 弹窗拒绝（ask/danger）
- [x] B4 curl|sh → 弹窗拒绝（ask/danger）
- [x] B5 git push --force → 弹窗拒绝（ask/danger）
- [x] B6 dd of=/dev/null → 弹窗拒绝（ask/danger，边界：写 /dev 一律保守拦截）
- [x] B7 fdisk -l → 弹窗拒绝（ask/danger）

### 结论
激进档拦截底线验证通过：删除/受保护路径/提权/下载执行/force push/磁盘类
在任何模式下都不自动放行；激进档其余操作（含信任目录外、系统目录、未知命令、
git push）全部自动。与设计预期一致。

## 安全修复验证（v0.1.1，2026-08-17 第五轮）

awesome-dsh-plugin PR #1316 评审发现信任边界穿越漏洞，已修复并发布 v0.1.1：

- [x] 漏洞：inTrust 字符串前缀匹配，/trust/../../../etc/cron.d/x 可穿越自动放行；
      PROTECTED 前后矛盾（.ssh 拦穿越、/etc 不拦）；信任目录内 symlink 可绕过
- [x] 修复：realOf = resolve(expandHome) → realpathSync（不存在回退 resolve）；
      inTrust 双侧规范化比较；bash 目标与 fs 目标规范化后再查 PROTECTED
- [x] 单测 7/7：穿越攻击 / ../../../../etc/passwd / 正常文件 / 子目录 / 新建文件回退 / 兄弟目录 / ~ 展开
- [x] 实机验证：穿越路径 write → ask-human/outside 弹窗（修复前自动放行）
- [x] 正式安装升级 v0.1.1（dsh plugin update）+ 重启加载确认
