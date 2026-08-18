# 安装指南（dsh-perm-guard）

> 已发布（v0.1.2+），可按下方 bundle 一行安装。

## 安装（推荐：官方 bundle 一行安装）

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-perm-guard#main"
```

装完**重启 `dsh web`**。更新时 `dsh plugin --profile web update dsh-perm-guard`，重启生效。

> **需要 pnpm**：`dsh plugin` 是 pnpm 转发器，PATH 里没有 pnpm 会直接失败。

## 验证是否装好

- 日志出现 `[dsh-perm-guard]` 相关记录
- 设置页可见 perm-guard 开关与类别开关
- 执行 `bash` 里 `rm -rf /` 类命令会被拦截并要求人工确认

## 卸载

- bundle 安装：`dsh plugin --profile web remove dsh-perm-guard`，重启 `dsh web`。
