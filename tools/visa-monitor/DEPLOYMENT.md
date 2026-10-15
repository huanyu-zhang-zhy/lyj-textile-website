# Render 部署与运行

## 复用现有 7 美元服务（当前选择）

用户选择复用现有 human-router-api，服务为 Python、0.5 CPU / 512 MB，已有 1 GB 磁盘挂载 /var/data。此次不创建新服务或新增磁盘，不暂停原 API。

2026-10-16 的只读检查：实例当时总内存使用约 236–247 MiB、磁盘可用约 953 MiB；Node v24.14.1 和主要 Chromium 系统库已存在，但未安装浏览器。单次 HTTP 请求返回 200，只有页面标题，没有日期可预约状态，不能把这个结果当作无号。

`reuse-service.py` 在 /var/data/visa-monitor 独立安装运行环境；启动的子进程降低调度优先级，复用现有资源。资源保护按 cgroup 中匿名内存加内核内存占上限 78% 停止新任务；运行前需额外 48 MiB 余量。每 10 秒检查原 API 的 /health，两次失败停止新任务。保护检查通常每 0.2 秒一次，不能提供硬隔离或保证完全不影响原 API。

程序只停止自己创建的进程组。原 API 的启动命令、应用代码、数据库、密钥和服务配置不变。子进程只继承必要运行环境变量，不传递原 API 的业务密钥。

运行命令：

```sh
python /var/data/visa-monitor/reuse-service.py setup
python /var/data/visa-monitor/reuse-service.py smoke
```

单次检查有效且资源充足后，才启动正式运行：

```sh
nohup python /var/data/visa-monitor/reuse-service.py run > /var/data/visa-monitor/supervisor.log 2>&1 < /dev/null &
```

采样状态与报告位于 /var/data/visa-monitor/run；保护程序状态保存为 run-guard.json。到期停止监测子进程，原 API 保持运行；不可暂停整个现有服务。

后台进程可在 Shell 断开后继续，但 Render 重启或重新部署可能中断它；原始截止时间保存在磁盘，可恢复采样，不能补回中断期间的数据。没有宣称能无条件保证 24 小时不间断。

保护程序的 4 项离线测试可用 `python3 -B reuse_service_test.py` 运行。子进程终止行为实测，降低调度优先级的调用在本机测试中模拟；服务器端另行验证。

以下新建 Worker 的配置保留为可选方案，不是当前选择。

该文件夹为独立 Docker 应用。仓库部署位置为 `tools/visa-monitor`，使用独立分支 `codex/visa-monitor-2026-11`。现有网站不需要合并或重新部署。

## 建议配置

- 类型：Background Worker；Docker。
- 名称：melbourne-visa-monitor-2026-11。
- 分支：codex/visa-monitor-2026-11。
- Root Directory：tools/visa-monitor；Dockerfile Path：./Dockerfile。
- 实例：1 CPU / 2 GB RAM；单实例；关闭自动部署。
- 持久化磁盘：1 GB，挂载 /data。
- TARGET_MONTH=2026-11；INTERVAL_SECONDS=60；DURATION_HOURS=24。
- DATA_DIR=/data；MONITOR_ENABLED=false（首次部署仅验证环境）。

Render 当前页面列出该计算方案 $25/月；磁盘和其他费用另计。24 小时计算费用通常远低于整月，实际以 Render 账单及计费规则为准。服务暂停前会持续产生计算费用；程序完成不等于 Render 服务被暂停。

## 启动与停止

部署后先检查日志、磁盘可写性和 Chromium 沙箱能否启动。通过 Shell 使用独立目录 `/data/smoke` 执行一次检查：

```sh
MONITOR_ENABLED=true DATA_DIR=/data/smoke node monitor.cjs --once
```

一次测试若返回 blocked，或未能得到有效月份日历，应先调查；不要绕过验证码、关掉沙箱或提高请求频率。测试状态位于 smoke 目录，不计入正式运行。

正式启动：将 MONITOR_ENABLED 改为 true 并部署。首次正式启动创建 `/data/state.json`，保存原始开始和截止时间；后续重启继续该次运行，不重新计时。进程暂停期间的缺口会体现在报告中，不进行补发请求。

有效状态为 no_available_dates 或 available_dates。访问限制立即停止；连续 3 次错误或 unknown 停止；运行时错误保留状态并停止。终态重启不会再次采样。禁用或完成后进程空闲，以避免 Render 反复重启；仍须在 Render 暂停服务以停止计算费用。

正式开始后，到期停止采样并输出 REPORT 日志。报告始终保存于：

- /data/state.json：原始检查记录与恢复状态。
- /data/summary.json：结构化统计与观察窗口。
- /data/report.md：墨尔本时间的中文报告。

通过 Render Shell 查看报告：

```sh
node monitor.cjs --report
```

先保存报告，再暂停服务；磁盘保留与删除政策以 Render 当前规则为准。删除服务、磁盘或状态文件会影响恢复与数据，需另外明确授权，不是结束采样的必要步骤。

## 请求与数据边界

仅访问固定的 Calendly 目标月份；不点击日期、不获取具体时间列表、不提交预约。每分钟一次“页面加载”会包含多个页面资源请求，不是每分钟一个 HTTP 请求。

每次检查创建临时浏览器上下文，只有 GET/HEAD 可通过；禁止非白名单域名、额外页面跳转、流式连接以及图片/字体/媒体；每次最多放行 120 个请求。白名单为页面已观察到的 calendly.com、assets.calendly.com、cdn.cookielaw.org。阻止 service worker、WebSocket 及写入方法。不复用用户浏览器的登录信息。

仅检测目标月份的可选日期。同一天内新增时间段可能漏检；新出现的日期也不能被直接归因为定时放号。限制与政策核实见 README.md。低频和只读不会自动获得网站许可，也不能保证不会触发限制。

## 验证范围

`npm test`：18 项离线测试通过，包括日期解析、隐藏月份过滤、请求限制、统计、断点恢复和实例锁。

真实已打开页面的只读 DOM 验证：2026 年 11 月 30 个日期全部不可选。

本机独立 Chromium 启动测试受到当前执行环境限制而退出，未向预约站点发起测试请求。因此服务器 Chromium 启动、真实页面加载和磁盘挂载权限仍须部署后做单次测试；没有声称这些检查已经通过。首次部署保持 MONITOR_ENABLED=false。
