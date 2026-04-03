---
title: AI短剧工作流踩坑记录
date: 2026-04-03 12:00:00
tags:
  - ai-drama
  - lesson
categories:
  - 技术
---

# AI 短剧工作流踩坑记录

> 2026-04-02 首次全链路 MVP 验证过程中发现的问题

<!-- more -->

## 1. CogVideoX API 参数限制

**现象**：提交视频生成任务时 400 错误 `"不支持当前fps值"` / `"不支持当前duration值"`
**原因**：CogVideoX-flash 不支持自定义 `fps` 和 `duration` 参数，只能用默认值
**正确用法**：
```json
{
  "model": "cogvideox-flash",
  "prompt": "描述文字",
  "image_url": "base64或URL（可选，i2v模式）"
}
```
- **不要传** `fps`、`duration`、`size` 等参数
- 默认输出：5秒，720p
- 异步接口，提交后轮询 `/v4/async-result/{task_id}`
**教训**：先用最小参数测试 API，确认支持的参数范围再批量提交

## 2. CogVideoX 限流

**现象**：1305 错误 `"该模型当前访问量过大，请您稍后再试"`
**原因**：高频并发提交触发限流
**应对**：提交间隔 2-3 秒，失败后指数退避重试

## 3. mimo-tts-proxy 网络绑定问题

**现象**：从宿主机 curl 容器 8099 端口超时 (HTTP 000)
**原因**：容器内 proxy 监听 `127.0.0.1:8099`，不是 `0.0.0.0:8099`
**端口映射**：docker 显示 `0.0.0.0:8099->8099/tcp` 但容器内只绑 loopback
**修复方案**：需要改容器内的监听地址为 `0.0.0.0`，或用 `network_mode: host`
**临时方案**：用 edge-tts 替代（已安装：`/home/sighzh/.local/bin/edge-tts`）

## 4. 剧本理解偏差

**教训**：用户说"猫狗嘲笑主人"，我以为有主人角色，实际只有猫和狗对话
**改进**：拿到需求后**先复述确认**，不要脑补角色和剧情

## 5. 静态图 + Ken Burns 天花板低

**现象**：CogView 生成的静态图用 FFmpeg zoompan 做 Ken Burns 推拉效果
**问题**：没有表情变化、没有动作、没有口型，只是缓慢缩放
**结论**：纯静态图无法形成有吸引力的短剧，必须上视频生成（CogVideoX）

## 6. FFmpeg amix 音频混流坑

**现象**：`amix` filter 报错 `Cannot find a matching stream`
**原因**：多输入混音时，map 和 filter graph 的标签要对应
**正确写法**：
```bash
ffmpeg -i video.mp4 -i audio1.mp3 -i audio2.mp3 \
  -filter_complex "[1:a]adelay=500|500[a1];[2:a]adelay=1500|1500[a2];[0:a][a1][a2]amix=inputs=3:duration=first[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac output.mp4
```

## 7. Python f-string 反斜杠限制

**现象**：`f"file '{BASE}/clips/{scene[\"scene_id\"]}.mp4'"` 报 SyntaxError
**原因**：Python 3.11 不允许 f-string 表达式中出现反斜杠
**正确写法**：
```python
sid = scene["scene_id"]
f.write(f"file '{BASE}/clips/{sid}.mp4'\n")
```

## 8. edge-tts 安装慢

**现象**：`pip install edge-tts` 卡住，依赖多（aiohttp 等）
**原因**：网络问题，PyPI 下载慢
**应对**：耐心等或用镜像源；`gtts` 更轻量但中文质量不如 edge-tts

## API 信息速查

| 服务 | 端点 | Key |
|------|------|-----|
| 智谱 图片 | `POST /v4/images/generations` | `[REDACTED]` |
| 智谱 视频 | `POST /v4/videos/generations` | 同上 |
| 智谱 视频查询 | `GET /v4/async-result/{task_id}` | 同上 |
| MiMo (OpenRouter) | `POST /v4/chat/completions` | `[REDACTED]` |
| edge-tts | CLI `/home/sighzh/.local/bin/edge-tts` | 无需 Key |

## v1 全链路跑通记录（4/3 00:40）

- 5.5分钟成片，23秒，4.5MB
- CogVideoX 6段视频全部成功（总计12MB）
- MiMo生成"薪水谈判"6场猫狗对话
- 有一个edge-tts调用超时但文件仍生成

## 质量差距分析（vs Seedance 2.0）

| 维度 | 我们 | Seedance 2.0 |
|------|------|-------------|
| 口型 | 无同步 | 原生音视频联合生成 |
| 角色一致性 | 各镜头独立 | 跨帧temporal attention |
| 连贯性 | 5秒碎片拼接 | 30秒连贯叙事 |
| 镜头转换 | 硬切 | 平滑过渡 |

**v2 改进方向**：
1. 首尾帧连续性（前镜头末帧→后镜头起始帧）
2. 角色描述统一化（prompt前缀注入）
3. Lip sync后处理（SadTalker/MuseTalk，需GPU）
