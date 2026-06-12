---
name: safe-shell
description: 安全 Shell 命令执行 — 在受限目录下运行数据处理命令（MATLAB、Python、ffmpeg 等 CLI 工具）
version: 1.0.0
---

# Safe Shell Execution

## 能力

- 在指定工作目录下执行 shell 命令
- 适用于调用 CLI 工具处理数据（MATLAB、Python、ffmpeg、pandoc 等）
- 带超时保护和输出截断

## 工具列表

- `shell_exec`: 在指定目录下执行一条 shell 命令，返回 stdout/stderr

## 调用时机

- 需要调用 MATLAB CLI 处理实验数据 → `shell_exec`
- 需要运行 Python 脚本处理数据 → `shell_exec`
- 需要调用 ffmpeg、pandoc 等 CLI 工具 → `shell_exec`
- 遇到工具链缺口，搜索发现有 CLI 方案 → `shell_exec`

## 安全约束

- 工作目录限制在 ~/Polarisor/ 范围内
- 命令超时默认 120 秒
- 输出截断为 50KB
- 禁止执行 rm -rf /、sudo、明显危险命令
