window.__ModuleLoader__.load({
  id: "dsh-perm-guard",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    /**
     * dsh-perm-guard — Client 半
     *
     * 1. 输入框工具行左侧「Auto ✓」按钮：一键开关自动审批（与权限档位并列）。
     * 2. 设置侧栏「Auto 权限」页：总开关 + 11 个操作类别三态开关（自动/人工/
     *    拒绝，默认=用户习惯）+ 信任目录编辑 + 最近判定审计列表。
     * 状态读写走 Host 的 HTTP 端点 /api/perm-guard/state（GET 读 / POST 写）。
     */
    const inject = ["slots"];

    /** 静态版无 styles builtin，手动注入插件 CSS（幂等注入统一口径：style id 标记，2026-08-21） */
    function insertCss() {
      if (typeof document === "undefined") return;
      if (document.getElementById("dsh-perm-guard-style") !== null) return;
      const tag = document.createElement("style");
      tag.id = "dsh-perm-guard-style";
      tag.textContent = ".pg-toggle{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary, #666);font-size:12px;cursor:pointer;padding:0}.pg-toggle:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1))}.pg-toggle.pg-on{color:var(--dsw-alias-state-success-primary, #2ecc71);background:var(--dsw-alias-state-success-tertiary, rgba(46,204,113,.08))}.pg-panel{display:flex;flex-direction:column;gap:14px;padding:4px 2px 20px}.pg-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.pg-row-label{font-size:13px;color:var(--dsw-alias-label-primary, #ddd)}.pg-row-sub{font-size:11px;color:var(--dsw-alias-label-tertiary, #999);margin-top:2px}.pg-modes{display:flex;flex-direction:column;gap:6px}.pg-mode{display:flex;flex-direction:column;gap:2px;text-align:left;font-size:12.5px;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25));background:transparent;color:var(--dsw-alias-label-primary, #ddd);cursor:pointer}.pg-mode.pg-sel{border-color:var(--dsw-alias-state-success-primary, rgba(46,204,113,.5));background:var(--dsw-alias-state-success-tertiary, rgba(46,204,113,.08))}.pg-mode-sub{font-size:11px;color:var(--dsw-alias-label-tertiary, #999)}.pg-mode-note{font-size:11px;color:var(--dsw-alias-label-secondary, #bbb)}.pg-dim{opacity:.45}.pg-cat{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2));border-radius:8px}.pg-cat-name{font-size:12.5px}.pg-cat-sub{font-size:11px;color:var(--dsw-alias-label-tertiary, #999)}.pg-tri{display:flex;gap:4px}.pg-tri button{font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-tertiary, #999);cursor:pointer}.pg-tri button.pg-sel{color:var(--dsw-alias-state-success-primary, #2ecc71);border-color:var(--dsw-alias-state-success-primary, rgba(46,204,113,.5))}.pg-tri button.pg-tri-red.pg-sel{color:var(--dsw-alias-state-error-primary, #e74c3c);border-color:var(--dsw-alias-state-error-primary, rgba(231,76,60,.5));background:var(--dsw-alias-state-error-tertiary, rgba(231,76,60,.08))}.pg-tri button.pg-tri-auto.pg-sel{background:var(--dsw-alias-state-success-tertiary, rgba(46,204,113,.08))}.pg-audit{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto}.pg-audit-item{font-size:11px;color:var(--dsw-alias-label-secondary, #bbb);display:flex;gap:6px;align-items:baseline;font-family:ui-monospace,monospace}.pg-audit-item .pg-d{font-size:10px;padding:1px 5px;border-radius:4px}.pg-d-allow{background:var(--dsw-alias-state-success-tertiary, rgba(46,204,113,.12));color:var(--dsw-alias-state-success-primary, #2ecc71)}.pg-d-ask{background:var(--dsw-alias-state-warn-tertiary, rgba(241,196,15,.12));color:var(--dsw-alias-state-warn-primary, #f1c40f)}.pg-d-deny{background:var(--dsw-alias-state-error-tertiary, rgba(231,76,60,.12));color:var(--dsw-alias-state-error-primary, #e74c3c)}.pg-input{width:100%;min-height:64px;font-size:12px;font-family:ui-monospace,monospace;background:transparent;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));border-radius:8px;padding:8px;color:var(--dsw-alias-label-primary, #ddd)}.pg-btn{font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-primary, #ddd);cursor:pointer}.pg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1))}.pg-btn.pg-on{color:var(--dsw-alias-state-success-primary, #2ecc71);border-color:var(--dsw-alias-state-success-primary, rgba(46,204,113,.5))}.pg-btn.pg-saved{color:var(--dsw-alias-state-success-primary,#2ecc71);border-color:var(--dsw-alias-state-success-primary,rgba(46,204,113,.5))}.pg-ok{color:var(--dsw-alias-state-success-primary,#2ecc71)}.pg-err{color:var(--dsw-alias-state-error-primary,#e74c3c)}";
      document.head.appendChild(tag);
    }

    function apiGet() {
      return fetch("/api/perm-guard/state").then((r) => r.json()).catch(() => null);
    }
    function apiPost(patch) {
      return fetch("/api/perm-guard/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      }).then((r) => r.json()).catch(() => null);
    }

    const CATEGORY_ORDER = [
      ["fileEdit", "文件编辑", "信任目录内 write/edit/cp/mv/mkdir/Set-Content/New-Item 等"],
      ["gitLocal", "Git 本地操作", "commit/merge/rebase/checkout/stash 等"],
      ["build", "构建·测试·依赖", "build/test/install/tsc/dotnet/cargo 等"],
      ["readOnly", "只读查询", "ls/cat/grep/git status/Test-Path/netstat 等"],
      ["delete", "不可逆删除", "rm/del/rd/Remove-Item/git clean/reset --hard（硬红线不自动）"],
      ["protected", "受保护路径", ".ssh/.aws/密钥/.env、C:\\Windows/Program Files 等系统目录"],
      ["privilege", "提权·系统管理", "sudo/runas/reg add/schtasks/netsh/服务与全局安装"],
      ["networkExec", "网络下载执行", "curl|sh、Invoke-RestMethod/iwr、certutil 下载等"],
      ["gitPush", "Git 推送远端", "push/force-push"],
      ["publish", "发布·部署", "npm publish/docker push/dotnet publish/kubectl apply"],
      ["disk", "磁盘·分区·设备", "dd/mkfs/diskpart/format/chkdsk /f"]
    ];
    const TRIPLE = [["auto", "自动"], ["ask", "人工"], ["deny", "拒绝"]];

    function AutoButton() {
      const [st, setSt] = react.useState(null);
      const load = () => apiGet().then((s) => { if (s) setSt(s); }).catch(() => {});
      react.useEffect(() => { load(); }, []);
      const on = st ? st.enabled : false;
      const toggle = () => apiPost({ enabled: !on }).then(load).catch(() => {});
      const title = "Auto 自动审批：" + (on ? "开启中——信任目录内自动放行，危险操作弹窗确认" : "关闭——恢复宿主默认审批");
      // 盾牌图标（线性风格，对齐官方 Icon 体系）：盾 = 权限，对勾 = 放行
      const shieldIcon = react.createElement("svg", {
        width: 14,
        height: 14,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        style: { flex: "none", display: "block" },
      },
        react.createElement("path", { d: "M8 1.5l5.5 2v4.5c0 3.2-2.2 5.6-5.5 6.5-3.3-.9-5.5-3.3-5.5-6.5V3.5L8 1.5z" }),
        react.createElement("path", { d: "M5.8 8.2l1.5 1.5L10.4 6.4" })
      );
      return react.createElement("button", {
        type: "button",
        className: "pg-toggle" + (on ? " pg-on" : ""),
        onClick: toggle,
        title: title,
        "aria-label": title,
      }, shieldIcon);
    }

    function SettingsPanel() {
      const [st, setSt] = react.useState(null);
      const [dirsText, setDirsText] = react.useState("");
      // 保存反馈统一口径（2026-08-21）：按钮短暂变绿"✓ 已保存" + 绿字；失败红字
      const [dirMsg, setDirMsg] = react.useState(null);
      const [dirSaved, setDirSaved] = react.useState(false);
      const dirSavedTimer = react.useRef(null);
      const load = () => apiGet().then((s) => {
        if (!s) return;
        setSt(s);
        setDirsText((s.trustedDirs || []).join("\n"));
      }).catch(() => {});
      react.useEffect(() => { load(); }, []);
      react.useEffect(() => () => {
        if (dirSavedTimer.current !== null) clearTimeout(dirSavedTimer.current);
      }, []);
      if (!st) return react.createElement("div", { className: "pg-panel" }, "加载中…");
      const setCat = (key, value) => apiPost({ categories: { [key]: value } }).then(load).catch(() => {});
      const saveDirs = () => {
        apiPost({ trustedDirs: dirsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) })
          .then((d) => {
            if (d && d.ok !== false) {
              const dropped = Array.isArray(d.droppedDirs) ? d.droppedDirs : [];
              if (dropped.length > 0) {
                setDirMsg({ kind: "err", text: "部分保存：已忽略 " + dropped.length + " 条非绝对路径条目：" + dropped.join(" , ") });
              } else {
                setDirMsg({ kind: "ok", text: "已保存，立即生效" });
                setDirSaved(true);
                if (dirSavedTimer.current !== null) clearTimeout(dirSavedTimer.current);
                dirSavedTimer.current = setTimeout(() => { setDirSaved(false); dirSavedTimer.current = null; }, 2000);
              }
            } else {
              setDirMsg({ kind: "err", text: "保存失败：" + ((d && d.error) || "未知错误") });
            }
            load();
          })
          .catch(() => setDirMsg({ kind: "err", text: "保存失败：网络错误" }));
      };
      const catRows = CATEGORY_ORDER.map(([key, name, sub]) => {
        const cur = st.categories[key] || "ask";
        const tri = TRIPLE.map(([v, label]) => react.createElement("button", {
          key: v,
          className: cur === v ? (v === "auto" ? "pg-sel pg-tri-auto" : "pg-sel pg-tri-red") : "",
          onClick: () => setCat(key, v)
        }, label));
        return react.createElement("div", { key: key, className: "pg-cat" }, [
          react.createElement("div", null, [
            react.createElement("div", { className: "pg-cat-name" }, name),
            react.createElement("div", { className: "pg-cat-sub" }, sub)
          ]),
          react.createElement("div", { className: "pg-tri" }, tri)
        ]);
      });
      const auditItems = (st.audit || []).slice(0, 20).map((a, i) => {
        const cls = a.decision === "allowed-once" || a.decision === "allow" ? "pg-d-allow" : (a.decision === "ask-human" || a.decision === "rejected" ? "pg-d-ask" : "pg-d-deny");
        const label = a.decision === "allowed-once" ? "放行" : (a.decision === "rejected" ? "拒绝" : (a.decision === "ask-human" ? "转人工" : a.decision));
        return react.createElement("div", { key: i, className: "pg-audit-item" }, [
          react.createElement("span", { className: "pg-d " + cls }, label),
          react.createElement("span", null, a.t ? new Date(a.t).toLocaleTimeString() : ""),
          react.createElement("span", null, (a.tool || "") + " " + String(a.cmd || a.target || "").slice(0, 60))
        ]);
      });
      return react.createElement("div", { className: "pg-panel" }, [
        // 分区内容统一头部标题（2026-08-21，标题 = 分区名，样式对齐 memory/backup 的 h3）
        react.createElement("h3", { style: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "Auto 权限"),
        react.createElement("div", { className: "pg-row" }, [
          react.createElement("div", null, [
            react.createElement("div", { className: "pg-row-label" }, "Auto 自动审批"),
            react.createElement("div", { className: "pg-row-sub" }, "关闭后恢复宿主默认审批；开启后按下述模式判定" + (st.enabled ? "" : "（当前已关闭）"))
          ]),
          react.createElement("button", {
            type: "button",
            className: "pg-btn" + (st.enabled ? " pg-on" : ""),
            onClick: () => apiPost({ enabled: !st.enabled }).then(load).catch(() => {})
          }, st.enabled ? "开启中" : "已关闭")
        ]),
        react.createElement("div", { className: "pg-row-label" }, "审批模式"),
        react.createElement("div", { className: "pg-modes" }, [
          react.createElement("button", {
            type: "button",
            className: "pg-mode" + (st.mode === "standard" ? " pg-sel" : "") + (st.enabled ? "" : " pg-dim"),
            onClick: () => apiPost({ mode: "standard" }).then(load).catch(() => {}),
            title: "切换模式将重置下方类别开关为该模式默认值"
          }, "标准", react.createElement("div", { className: "pg-mode-sub" }, "信任目录内自动放行；目录外与危险操作弹窗（11 类别开关可细调）")),
          react.createElement("button", {
            type: "button",
            className: "pg-mode" + (st.mode === "aggressive" ? " pg-sel" : "") + (st.enabled ? "" : " pg-dim"),
            onClick: () => apiPost({ mode: "aggressive" }).then(load).catch(() => {}),
            title: "切换模式将重置下方类别开关为该模式默认值"
          }, "激进", react.createElement("div", { className: "pg-mode-sub" }, "除删除/磁盘/受保护路径/提权/curl|sh 外全部自动，不限目录")),
          react.createElement("div", { className: "pg-mode-note" }, st.mode === "aggressive" ? "当前：激进——位置不限，只拦会少东西或破坏性的操作" : "当前：标准——信任目录内自动，其余按类别判定")
        ]),
        react.createElement("div", { className: "pg-row", style: { alignItems: "center" } },
          react.createElement("div", null,
            react.createElement("div", { className: "pg-row-label" }, "严格控制高危命令"),
            react.createElement("div", { className: "pg-row-sub" }, "工作区内的高危操作也强制人工确认")
          ),
          react.createElement("button", {
            type: "button",
            className: "pg-btn" + (st.strictHighRisk ? " pg-on" : ""),
            onClick: () => apiPost({ strictHighRisk: !st.strictHighRisk }).then(load).catch(() => {})
          }, st.strictHighRisk ? "已开启" : "已关闭")
        ),
        react.createElement("div", { className: "pg-row-label" }, "操作类别开关（默认=你的习惯，可逐个调整）"),
        catRows,
        react.createElement("div", { className: "pg-row-label" }, "信任目录（每行一个绝对路径；默认含工作区及兄弟目录）"),
        react.createElement("textarea", {
          className: "pg-input",
          value: dirsText,
          onChange: (e) => setDirsText(e.target.value),
          placeholder: "/Users/you/projects\nC:/Users/you/projects\nD:/work/repos"
        }),
        react.createElement("div", null,
          react.createElement("button", {
            type: "button",
            className: "pg-btn" + (dirSaved ? " pg-saved" : ""),
            onClick: saveDirs
          }, dirSaved ? "✓ 已保存" : "保存信任目录"),
          dirMsg
            ? react.createElement("span", { className: dirMsg.kind === "ok" ? "pg-ok" : "pg-err", style: { marginLeft: 8, fontSize: 12 } }, dirMsg.text)
            : null
        ),
        react.createElement("div", { className: "pg-row-label" }, "最近判定审计"),
        react.createElement("div", { className: "pg-audit" }, auditItems.length ? auditItems : react.createElement("div", { className: "pg-audit-item" }, "暂无记录"))
      ]);
    }

    // ── 官方设置卡片壳（2026-09-02，视觉对齐 dsh 0.1.2 host PluginCard；key 须与宿主命名空间一致）──
    const CARD_CSS = ".dsh-settings-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s}.dsh-settings-card:hover{border-color:var(--dsw-alias-label-dimmed)}.dsh-settings-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.dsh-settings-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}.dsh-settings-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dsh-settings-headtext{display:flex;flex-direction:column;flex:1;min-width:0;gap:4px}.dsh-settings-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dsh-settings-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dsh-settings-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.dsh-settings-open .dsh-settings-chevron{transform:rotate(180deg)}.dsh-settings-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:10px 0 8px}";
    let cardCssInjected = false;
    function injectCardCss() {
      if (typeof document === "undefined" || cardCssInjected) return;
      cardCssInjected = true;
      if (document.getElementById("dsh-settings-card-style") !== null) return;
      const tag = document.createElement("style");
      tag.id = "dsh-settings-card-style";
      tag.textContent = CARD_CSS;
      document.head.appendChild(tag);
    }
    function SettingsCardShell(props) {
      const [open, setOpen] = react.useState(false);
      return react.createElement("li", { className: "dsh-settings-card" + (open ? " dsh-settings-open" : "") },
        react.createElement("button", {
          type: "button", className: "dsh-settings-head", "aria-expanded": open,
          onClick: () => setOpen(!open),
          "aria-label": (open ? "折叠" : "展开") + "：" + props.title,
        },
          react.createElement("span", { className: "dsh-settings-headtext" },
            react.createElement("span", { className: "dsh-settings-name" }, props.title),
            react.createElement("span", { className: "dsh-settings-desc" }, props.desc)
          ),
          react.createElement("svg", { className: "dsh-settings-chevron", width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
            react.createElement("path", { d: "M4 6.5 8 10.5 12 6.5" })
          )
        ),
        open ? react.createElement("div", { className: "dsh-settings-body" }, props.children) : null
      );
    }

    // ── 插件卡片精简版（设置双入口统一口径 2026-08-21：完整设置侧边栏页 + 卡片精简版）──
    function SettingsCard(props) {
      const [st, setSt] = react.useState(null);
      const [dirsText, setDirsText] = react.useState("");
      const [dirMsg, setDirMsg] = react.useState(null);
      const [dirSaved, setDirSaved] = react.useState(false);
      const dirSavedTimer = react.useRef(null);
      const load = () => apiGet().then((s) => {
        if (!s) return;
        setSt(s);
        setDirsText((s.trustedDirs || []).join("\n"));
      }).catch(() => {});
      react.useEffect(() => { load(); }, []);
      react.useEffect(() => () => {
        if (dirSavedTimer.current !== null) clearTimeout(dirSavedTimer.current);
      }, []);
      const on = st ? st.enabled : false;
      const saveDirs = () => {
        apiPost({ trustedDirs: dirsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) })
          .then((d) => {
            if (d && d.ok !== false) {
              const dropped = Array.isArray(d.droppedDirs) ? d.droppedDirs : [];
              if (dropped.length > 0) {
                setDirMsg({ kind: "err", text: "部分保存：已忽略 " + dropped.length + " 条非绝对路径条目：" + dropped.join(" , ") });
              } else {
                setDirMsg({ kind: "ok", text: "已保存，立即生效" });
                setDirSaved(true);
                if (dirSavedTimer.current !== null) clearTimeout(dirSavedTimer.current);
                dirSavedTimer.current = setTimeout(() => { setDirSaved(false); dirSavedTimer.current = null; }, 2000);
              }
            } else {
              setDirMsg({ kind: "err", text: "保存失败：" + ((d && d.error) || "未知错误") });
            }
            load();
          })
          .catch(() => setDirMsg({ kind: "err", text: "保存失败：网络错误" }));
      };
      return react.createElement("div", { className: "pg-panel", style: { gap: 10, padding: "4px 0 8px" } },
        // 分区内容统一头部标题（2026-08-21，标题 = 分区名，样式对齐 memory/backup 的 h3）；卡片壳内不重复标题
        props && props.inCard ? null : react.createElement("h3", { style: { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "Auto 权限"),
        react.createElement("div", { className: "pg-row" },
          react.createElement("div", null,
            react.createElement("div", { className: "pg-row-label" }, "Auto 自动审批"),
            react.createElement("div", { className: "pg-row-sub" }, "开启后信任目录内自动放行，危险操作仍弹窗确认")
          ),
          react.createElement("button", {
            type: "button",
            className: "pg-btn" + (on ? " pg-on" : ""),
            onClick: () => apiPost({ enabled: !on }).then(load).catch(() => {})
          }, on ? "开启中" : "已关闭")
        ),
        react.createElement("div", { className: "pg-row-label" }, "信任目录（每行一个绝对路径）"),
        react.createElement("textarea", {
          className: "pg-input",
          value: dirsText,
          onChange: (e) => setDirsText(e.target.value),
          placeholder: "/Users/you/projects\nC:/Users/you/projects\nD:/work/repos"
        }),
        react.createElement("div", null,
          react.createElement("button", {
            type: "button",
            className: "pg-btn" + (dirSaved ? " pg-saved" : ""),
            onClick: saveDirs
          }, dirSaved ? "✓ 已保存" : "保存"),
          dirMsg
            ? react.createElement("span", { className: dirMsg.kind === "ok" ? "pg-ok" : "pg-err", style: { marginLeft: 8, fontSize: 12 } }, dirMsg.text)
            : null
        ),
        react.createElement("div", { className: "pg-row-sub" }, "完整设置（11 类别开关 / 模式 / 审计）在设置 → Auto 权限页")
      );
    }

    function apply(ctx) {
      insertCss();
      injectCardCss();
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("conversation.input.left", () => slots.register(
        { name: "conversation.input.left", id: "dsh-perm-guard-toggle", order: 5 },
        () => react.createElement(AutoButton)
      ));
      slots.inject("settings.section", () => slots.register(
        { name: "settings.section", id: "dsh-perm-guard-settings", order: 25, label: "Auto 权限" },
        () => react.createElement(SettingsPanel)
      ));
      slots.inject("settings.plugin.item", () => slots.register(
        { name: "settings.plugin.item", key: "perm-guard", id: "perm-guard" },
        () => react.createElement(SettingsCardShell, { title: "Auto 权限", desc: "信任目录自动放行，危险操作人工确认" },
          react.createElement(SettingsCard, { inCard: true }))
      ));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
