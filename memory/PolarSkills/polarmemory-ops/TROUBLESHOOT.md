# PolarMemory — 故障排查

## 常见问题

### 服务无法启动

1. 检查端口是否被占用: `lsof -i :3000`
2. 检查依赖: `npm ci`
3. 查看日志: 检查 stdout/stderr

### 健康检查失败

```bash
curl -v N/A
```

### 数据库问题

检查 SQLite 文件权限和磁盘空间。
