# 安装指南（dsh-perm-guard）

> 插件开发中，暂不可安装。本文件为发布期占位。

## 安装（推荐：官方 bundle 一行安装，发布后生效）

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-perm-guard#main"
```

装完**重启 `dsh web`**。更新时 `dsh plugin --profile web update dsh-perm-guard`，重启生效。

> **需要 pnpm**：`dsh plugin` 是 pnpm 转发器，PATH 里没有 pnpm 会直接失败。

## 验证是否装好

（发布后按功能清单补全）

## 卸载

- bundle 安装：`dsh plugin --profile web remove dsh-perm-guard`，重启 `dsh web`。
