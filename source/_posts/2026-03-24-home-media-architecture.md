---
title: 家庭影音方案架构
date: 2026-03-24 15:52:00
tags:
  - NAS
  - Docker
  - Jellyfin
  - 影音
categories:
  - 技术
---

折腾了一段时间的家庭影音方案，现在基本稳定了，记录一下整体架构。

<!-- more -->

## 整体架构

```
用户请求 → Tailscale/Cloudflare → NAS (飞牛FNOS)
                                      ├── Jellyfin (媒体播放)
                                      ├── MoviePilot (自动追剧)
                                      ├── qbittorrent (下载)
                                      ├── CloudDrive2 (云盘挂载)
                                      └── sing-box (代理)
```

## 核心组件

### MoviePilot — 自动化中心

MoviePilot 是整个方案的调度中心。设定追剧规则后，它会自动：
- 监控 TMDB 新集更新
- 调用 qbittorrent 下载
- 自动整理命名（hard link 到媒体库）
- 推送通知

一句话：**设定规则就不管了，它自己会追**。

### Jellyfin — 播放器

Jellyfin 负责媒体播放，支持：
- 电视 / 手机 / 平板多端
- 自动刮削元数据
- 硬件转码（NAS 没独显，大部分走直出）

实测效果：本地 1080p Blu-ray 直出无压力，4K 外网受限于带宽。

### qbittorrent — 下载器

MoviePilot 下载的执行者。配置要点：
- 下载路径：`/vol1/media/downloads/complete/`
- 通过 hard link 与媒体库共享，不浪费空间
- PT 站接入（iyuuplus 辅助管理）

## 媒体库结构

```
/media/
├── tv/           # 电视剧
├── anime/        # 动漫
├── movies/       # 电影
├── variety/      # 综艺
├── documentary/  # 纪录片
├── music/        # 音乐
└── downloads/    # 下载暂存
```

当前总量约 4TB，品类覆盖比较全了。

## 网络层

### 组网 — Tailscale

NAS 通过 Tailscale 组网，外网访问靠 MagicDNS 解析，不用暴露端口。

### 代理 — sing-box

VPS 上跑 sing-box 代理，NAS 内容器通过代理访问 TMDB 等海外服务。核心配置：
- Hysteria2 TLS 协议
- 通过域名访问，走 Cloudflare CDN

### 反向代理 — Cloudflare

域名解析走 Cloudflare CDN，配合 cloudflare-ddns 动态更新。

## Docker 编排

所有服务跑在 Docker Compose 里。

当前运行的服务：

| 服务 | 用途 |
|------|------|
| jellyfin | 媒体播放 |
| moviepilot | 自动追剧 |
| qbittorrent | 下载 |
| tailscale | 组网 |
| cloudflared | Cloudflare 隧道 |
| clouddrive2 | 云盘挂载 |
| sing-box-proxy | 代理 |
| xiaomusic | 小米音箱音乐 |
| iyuuplus | PT 辅助 |
| itvall | 直播源 |

## 踩过的坑

1. **硬链接必须同分区**：qbittorrent 和媒体库必须在同一 ZFS 分区，否则 hard link 不生效，会复制一份浪费空间
2. **代理配置坑**：MoviePilot 的 PROXY_HOST 不是 HTTP_PROXY，是专属环境变量
3. **Docker 重建掉版本**：每次 `docker compose up -d --force-recreate` 会回到 compose 文件里写的镜像版本，升级后要更新 compose 文件
4. **旧目录迁移**：从旧路径迁移到 MoviePilot 管理路径，释放了大量空间，部分旧文件需要手动处理

## 后续优化

- [ ] Jellyfin 硬件转码（考虑给 NAS 加独显或者换方案）
- [ ] 4K 资源外网播放优化
- [ ] 自动备份方案（当前 ZFS 快照不够）
- [ ] 更多 PT 站接入

---

这套方案跑了小半年了，整体稳定。核心思路就是 **MoviePilot 做调度，Docker 做隔离，Tailscale 做组网**，各司其职，出问题也好排查。
