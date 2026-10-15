# 墨尔本韩国签证预约：只读结构测试

研究与验证日期：2026-10-16，Australia/Melbourne。

## 已验证的情况

- 官方指定预约入口：https://calendly.com/conmel-mofa/visa
- 当前检查范围：2026 年 11 月；页面标题 Visa Application Lodgement；时区 Sydney, Melbourne Time。
- 2026-10-16 01:18:46 AEDT 的页面样本包含 30 个可见日期按钮，全部禁用，标签均为 No times available。这是当前已加载页面的观察结果，不是一次新的服务器查询。
- 页面会预加载其他月份，并使用祖先元素上的 `aria-hidden="true"` 隐藏它们。仅判断 CSS 可见性或读取整个页面文字会混入隐藏月份。本脚本同时排除 aria-hidden、hidden、inert、CSS 隐藏节点。
- 日期按钮的 `aria-label` 包含日期和状态，`disabled` 表示不可选；不能单靠按钮颜色判断。
- 未发现领事馆公布“每分钟放号”的证据。未观察到真实可预约样本，因此正向识别只经过模拟验证；未知标签会返回 unknown。

## 开源与官方路径

| 路径 | 作用 | 当前适用性 |
| --- | --- | --- |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | 开源网页变化监测；支持浏览器渲染、区域选择、通知 | 可借鉴过滤与变化记录方法；不是专门的韩国签证监测器。部署前需核实目标网站的访问规则 |
| [calendly-cli](https://github.com/bcharleson/calendly-cli) | MIT 许可的第三方 Calendly API 工具，包含 availability 命令 | 需要令牌及相应资源权限；未安装、未审计其代码，不能直接用于未授权的领事馆日历 |
| [Calendly 官方可用时间 API](https://developer.calendly.com/api-docs/calendly-api/event-types/list-event-type-available-times) | GET event_type_available_times | 要求 OAuth 或个人令牌；普通个人账户的令牌不能据此获得领事馆资源权限 |
| 当前脚本 | 分析用户已打开的公开日历 | 不发出额外网络请求；不能替代服务器轮询 |

本次检索没有验证到可以直接可靠使用的“墨尔本韩国签证每分钟放号监测器”。开源预约平台的替代产品也不等于现有 Calendly 页面的监测工具。

## 本版本的安全边界

脚本无依赖，不使用 fetch、XHR、WebSocket、自动刷新、点击、表单提交、Cookie、浏览器存储或外部通知。只在内存中保存月份、日期状态、观察时间及变化，最多 120 条。页面中存在的原有脚本仍可能自行联网；本脚本不会阻止它们，也不声称能控制它们。

[Calendly robots.txt](https://calendly.com/robots.txt) 当前包含 `Disallow: /*?*`，覆盖带 month 查询参数的地址。[使用政策](https://calendly.com/legal/acceptable-use-policy) 同时限制不受支持的抓取方式及过量自动请求。robots.txt 不是认证机制，但低频请求也不能自动视为平台许可。本版本因而采用本地 DOM 分析。

不会读取预约表单值、护照信息、账号密码或其他申请人的信息。若标题、时区、月份、标签或日期数量不符合预期，会输出 unknown，而不是“已约满”。检测到页面上的访问限制提示时输出 blocked 并停止本地观察。

## 使用方法

1. 打开目标月份的预约页面，例如 https://calendly.com/conmel-mofa/visa?month=2026-11 。
2. 审阅 `calendar-probe.js`，在自己的浏览器开发者工具 Console 中运行整个文件。若浏览器阻止粘贴，不要关闭浏览器安全保护。
3. 脚本立即输出一次当前页面状态。
4. 可选：执行以下命令，每 60 秒读取一次已加载页面，最多读取 30 次：

```js
visaCalendarProbe.start({ intervalSeconds: 60, samples: 30, month: '2026-11' });
```

停止与导出：

```js
visaCalendarProbe.stop();
visaCalendarProbe.exportJSON();
```

返回值可手动保存为 JSON。脚本不会自动下载文件。刷新页面会清空脚本及内存历史，需要先导出，再重新运行。发现可用日期、未知结构或访问限制时停止，方便人工核实。

**每分钟读取本地页面不等于每分钟查询服务器。** 如果页面没有自行更新，本地观察不会发现新号源。当前文件没有后台服务器监测功能。

状态含义：

- `no_available_dates`：这个已加载月份没有可选日期。
- `available_dates`：发现可选日期候选，需人工确认具体时间及能否预约；不代表已预约。
- `unknown`：无法可靠判断，不能当作无号。
- `blocked`：页面提示访问限制或验证。

## 测试结果

在本目录运行 `node --test test.cjs`。9 项测试通过：无号、有号候选、差分、缺失日期、预加载月份混入、错误页面/时区、未知标签、失败样本不可比较，以及本地计时器有界运行。

使用真实页面只读验证了月份过滤及全部不可选的 30 个日期；没有在真实网站上运行 24 小时轮询、提交预约、绕过验证码或进行漏洞扫描。浏览器计时器生命周期使用模拟环境验证，尚未对真实浏览器长时间运行进行验证。

## 如何解释将来的 24 小时报告

需要逐条记录检查开始、读取完成、时区、日期集合、错误状态。某日期从不可选变为可选，应报告为“上一次有效检查至本次发现之间出现可用日期”，而不是精确放号秒数。

首次样本已有日期只能算初始状态；网络失败不是“没放号”；两次检查间出现又被约走的号源可能漏检。只观察日期无法发现同一已可预约日期内部新增的时间段。应分别统计有效覆盖率、失败区间、初始可用日期、新出现日期及按墨尔本当地小时分组的发现次数。

出现变化可能来自取消预约、管理人员调整或滚动预约窗口，不能仅凭页面变化判定原因。[Calendly 的日期范围说明](https://community.calendly.com/asked-answered-79/limiting-invitee-booking-availability-to-the-next-two-months-4961)介绍了滚动窗口与固定日期范围，但未证明领事馆采用其中哪种设置。24 小时数据只能描述当天观察，不能证明长期固定放号规律。

## 用户指定项目的部署核实

已读取 [lyj-textile-website 仓库](https://github.com/huanyu-zhang-zhy/lyj-textile-website) 的 README、文件树及 `.openai/hosting.json`，并通过 Sites 查询确认：

- 站点：LYJ Textile，状态 active。
- 线上地址：https://lyj-textile.abuzz-skunk-9855.chatgpt.site
- 托管形态：Sites / Cloudflare Workers；仓库未提供 SSH 主机、Docker 或常驻服务器部署配置。
- 当前没有关联的 Sites 定时任务。

这个托管环境没有向当前工具暴露可登录的虚拟机或常驻 Chromium 进程环境，不能直接启动传统服务器版的 24 小时浏览器进程。这不等于 Cloudflare 平台无法实现任务。

Cloudflare 官方提供 [Cron Triggers / scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) 和 [Browser Run](https://developers.cloudflare.com/browser-run/faq/)，可以将任务改造成定时唤醒、短时浏览器检查、持久化结果、到期停止的架构。当前 Sites 工具与托管清单未提供配置底层 Cron Triggers 或 Browser Run 绑定的入口；Sites 的云任务调度也不能直接等同于一分钟一次的浏览器采样服务。外部 Browser Run REST 服务还需要对应账户权限和服务配置。

因此准确结论是“当前 Sites 项目不能直接部署传统后台脚本；使用另行配置的 Cloudflare 服务在架构上可行，当前尚未具备访问与运行条件”。[Browser Run 免费额度](https://developers.cloudflare.com/browser-run/limits/)为每天 10 分钟浏览器使用时间；1,440 次动态页面加载不能据此假定免费额度足够。

没有修改网站、仓库或其部署配置，也未启动 24 小时监测。接下来需明确用户可管理的 Cloudflare 账户／配套服务，或改用 Linux 主机、持续联网本机。
