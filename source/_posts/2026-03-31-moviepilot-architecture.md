---
title: MoviePilot 媒体库架构与经验总结
date: 2026-03-31 12:00:00
tags:
  - NAS
  - Docker
  - MoviePilot
categories:
  - 技术
---

# MoviePilot 媒体库架构与经验总结

> 整理时间：2026-03-22 17:00 | 来源：一整天的调试和踩坑

<!-- more -->

## 系统架构

```
搜索(M-Team) → qBittorrent(下载) → MoviePilot(刮削+整理) → Jellyfin(播放)
                    ↑                      ↑
               sing-box-proxy(代理)    TMDB API(元数据)
```

### 容器清单

| 容器 | 网络 | 端口 | 用途 |
|------|------|------|------|
| moviepilot | media_net | 3000 | 媒体调度核心 |
| jellyfin | media_net | 8096 | 媒体播放服务器 |
| qbittorrent | media_net | 8085 | BT/PT 下载器 |
| clouddrive2 | media_net | 19798 | 云盘挂载(阿里/115) |
| sing-box-proxy | media_net + client_default | 7890/7891 | 代理(双宿主) |

### 目录映射

| 路径 | 容器内 | 宿主机 | 用途 |
|------|--------|--------|------|
| 下载目录 | /downloads/complete/ | /vol1/media/downloads/complete/ | qBittorrent 下载完成 |
| 电影库 | /media/movies/ | /vol1/media/movies/ | 电影整理目标 |
| 电视剧库 | /media/tv/ | /vol1/media/tv/ | 电视剧整理目标 |
| 动漫库 | /media/anime/ | /vol1/media/anime/ | 动漫整理目标 |
| 纪录片库 | /media/documentary/ | /vol1/media/documentary/ | 纪录片整理目标 |
| 云盘 | /cloud/ | /vol1/cloud/ | CloudDrive2 挂载点 |

## 关键配置

### MoviePilot 环境变量 (app.env)
```
PROXY_HOST=http://sing-box-proxy:7890    # 代理地址（必须用容器名，不是host.docker.internal）
TMDB_API_KEY=${TMDB_API_KEY}
GITHUB_PROXY=https://gh-proxy.com/       # GitHub 下载镜像
NO_PROXY=localhost,127.0.0.1,...,sing-box-proxy,.iyuu.cn,.m-team.cc
```

### qBittorrent 下载器配置 (user.db)
```json
{
  "name": "qb",
  "type": "qbittorrent",
  "config": {
    "host": "http://172.22.0.4:8085",  // ⚠️ 用IP不用容器名（Docker DNS不稳定）
    "username": "admin",
    "password": "${QB_PASSWORD}",
    "category": true
  }
}
```

### 媒体目录配置 (user.db)
```json
{
  "name": "电影",
  "download_path": "/downloads/complete/",
  "library_path": "/media/movies/",
  "monitor_type": "downloader",
  "media_type": "电影",
  "transfer_type": "softlink",  // ⚠️ 不能用link（跨设备硬链接失败）
  "renaming": true,
  "scraping": true
}
```

## 踩坑记录（血泪教训）

### 🔴 Docker 网络隔离（反复出现3次）

**问题**：容器间无法通信，DNS 解析失败，代理不通
**根因**：不同 Docker Compose 项目的容器在不同 bridge 网络上
**表现**：
- `sing-box-proxy` 在 `client_default`，MoviePilot 在 `media_net` → DNS 解析不了
- `host.docker.internal` 解析到 172.17.0.1（默认 bridge 网关），不是 media_net 网关
- 容器内从 172.22.0.1 连代理超时

**解决方案**：
```bash
docker network connect movie-pilot-v2_media_net sing-box-proxy
```

**教训**：所有需要互相通信的容器必须在同一网络。docker-compose.yml 应该引用外部网络或共享网络。

### 🔴 Docker DNS 间歇性故障

**问题**：MoviePilot 偶尔解析不到 `qbittorrent` 主机名，transfer 任务静默失败
**表现**：`socket.gethostbyname('qbittorrent')` 偶尔报 `Temporary failure in name resolution`
**解决方案**：qBittorrent 连接地址从容器名改成 IP（172.22.0.4）
**教训**：Docker 内置 DNS (127.0.0.11) 不可靠，关键服务用 IP

### 🔴 MoviePilot 只认带 MOVIEPILOT tag 的种子

**问题**：清理完 qBittorrent 种子后，transfer 还是报"没有已完成下载"
**根因**：MoviePilot 的 `get_completed_torrents()` 调用时传了 `tags=settings.TORRENT_TAG`（= "MOVIEPILOT"），只有带这个 tag 的种子才会被处理
**代码位置**：`/app/app/modules/qbittorrent/__init__.py:278`
**解决方案**：
```python
client.torrents_add_tags(tags='MOVIEPILOT', torrent_hashes=hashes)
```
**教训**：旧迁移的种子不会自动带 MOVIEPILOT tag，必须手动添加

### 🔴 MoviePilot 只认 seeding 状态，不认 stoppedUP

**问题**：qBittorrent 中已完成种子状态是 `stoppedUP`（手动停止），MoviePilot 不认
**根因**：`get_completed_torrents()` 使用 `status_filter="seeding"`，而 `stoppedUP` 不在其中
**代码位置**：`/app/app/modules/qbittorrent/qbittorrent.py:124-125`
**解决方案**：恢复种子（resume），让状态从 `stoppedUP` → `stalledUP`
**教训**：MoviePilot 要求种子处于做种状态（stalledUP/uploading），不能手动停止

### 🟡 硬链接跨设备失败

**问题**：`transfer_type="link"` 报 `Invalid cross-device link`
**根因**：Docker 的每个 volume bindmount 是独立的挂载点，即使宿主机同一文件系统
**解决方案**：改用 `transfer_type="softlink"`（软链接）
**教训**：Docker 容器内硬链接不可靠，用软链接更稳妥

### 🟡 app.env 配置残留

**问题**：app.env 中 `PROXY_HOST=http://host.docker.internal:7890`，但实际需要 `sing-box-proxy:7890`
**表现**：环境变量覆盖了 app.env 所以暂时正常，但不一致
**解决方案**：手动修改 app.env 保持一致
**教训**：环境变量优先级高于 app.env，但配置文件应该一致

### 🟡 TMDB API Key 误判

**问题**：中书省报告说 TMDB Key 失效，实际是代理不通
**根因**：测试时 Docker 网络隔离导致代理不通，不是 Key 问题
**教训**：诊断问题要排除网络因素，不要直接跳到结论

### 🟢 GitHub 下载慢

**数据**：
- 走代理隧道（sing-box）：~14KB/s（Vless-Reality）
- gh-proxy.com（绕过隧道）：~96KB/s
- 切 Hysteria2 后：~289KB/s
- VPS 直连 GitHub：663KB/s

**结论**：sing-box 隧道是瓶颈，Hysteria2 (QUIC) 比 Vless-Reality (TCP) 快 140 倍
**教训**：VPS 内核 3.10 不支持 BBR，TCP 在高丢包环境下极其脆弱

## 全流程配置清单

### 1. Docker Compose 网络
- 所有 media 相关容器加入同一网络（media_net）
- sing-box-proxy 需要同时连接 media_net 和自己的网络

### 2. qBittorrent
- 新下载的种子自动带 MOVIEPILOT tag（通过 MoviePilot 配置）
- 已有种子需要手动加 tag
- 不能手动停止种子（要保持 stalledUP 状态）

### 3. MoviePilot
- 下载器 host 用 IP 不用容器名
- 目录配置 transfer_type="softlink"
- PROXY_HOST 指向代理容器

### 4. Jellyfin
- 媒体库已自动创建（电影/电视剧/动漫/纪录片）
- 路径映射与 MoviePilot 一致
- TMDB 元数据自动同步

## 当前状态（2026-03-22 17:00）

- ✅ TMDB 刮削正常
- ✅ MoviePilot transfer 正常（34条记录，31成功）
- ✅ Jellyfin 媒体库有内容（4部电视剧+1部电影）
- ✅ 代理走 Hysteria2（289KB/s）
- ⏳ 54个下载中的种子完成后自动入库
- ⏳ Hysteria2 TLS 待工部修复
- ⏳ CloudDrive2 云盘待配置

## 部门协作总结

### 工部 🏗️
- 隧道优化（Vless→HY2，140倍提速）
- qBittorrent 清理（128→81种子，missingFiles清零）
- 安全修复（Docker镜像锁定、bash_history清理）
- 扣分：留尾巴（没验证qBittorrent连接）

### 刑部 🗡️
- 网络隔离诊断
- 隧道速度诊断（发现BBR缺失+高丢包）
- 存量安全修复方案（insecure:true + API Key + 供应链）
- +3分（快速交付高质量报告）

### 中书省 ✍️
- MoviePilot 全链路方案（首次返工：TMDB分析错误+缺迁移方案+缺Jellyfin配置）
- qBittorrent 种子迁移方案（重做通过）
- Jellyfin 配置方案（重做通过）
- -4分（首次返工扣分严重）

### 暴躁高达 🔧
- 发现 sing-box-proxy 网络隔离问题（直接修复）
- 发现 MOVIEPILOT tag 缺失问题
- 发现 transfer_type 未配置问题
- 发现种子 stoppedUP 状态问题
- 教训：不该自己干的活要派部门，但小事直接干比派部门更快
