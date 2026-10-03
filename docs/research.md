# OneSearch 功能调研

调研日期：2026-10-03。本文区分官方能力、OneSearch 的产品选择和当前 dev 的实现范围。项目目录为 `D:/Repositories/Web_Projects/OneSearch`；Moment 作为只读界面参考。

## 1. 目标与核心结论

目标是自建搜索管理平台：创建和管理 Meilisearch 实例，管理实例中的多个网站索引，提供安全的管理入口、可观测的搜索网关和可恢复的数据备份。

建议采用“一个工作空间、多个实例；一个实例、多个网站索引”。博客和文档站通常先共用实例，分别使用 `blog_articles`、`docs_pages`；不同资源预算、升级窗口或信任边界需要独立实例。多个索引共享一个引擎的计算资源，不等同于容器级隔离。这是 OneSearch 的设计选择，索引的数据和设置模型参考 [官方索引说明](https://www.meilisearch.com/docs/resources/internals/indexes)。

部署目标仍为服务器 Docker；按用户最新要求，当前阶段先完成原生本地 dev，验证界面与 Go 服务，不部署本地 Docker 容器。

## 2. 引擎与授权

Meilisearch 核心使用 Rust，实现搜索、索引与 HTTP API。数据库依赖 LMDB 的存储模型；不能把内存映射地址空间直接当作实际内存占用。索引内存参数不代表整个进程的硬性内存限制。参考 [源代码](https://github.com/meilisearch/meilisearch) 与 [存储说明](https://www.meilisearch.com/docs/resources/internals/storage)。

Community Edition 适合作为基础引擎。社区与企业功能需要按版本区分，不能把整个仓库所有功能笼统称为 MIT 授权；涉及企业扩展时需核对对应许可证。当前产品不依赖企业分片等能力。参考 [版本与许可说明](https://www.meilisearch.com/docs/resources/self_hosting/enterprise_edition)。

本地验证使用 Meilisearch 1.54.3。服务器未来固定镜像版本，不使用浮动 `latest`。

## 3. 现有界面能够做什么

| 方案 | 适合的工作 | 不能直接替代的能力 |
| --- | --- | --- |
| 引擎内置 Search Preview | 快速输入关键词和查看结果 | 实例创建、资源管理、账户、备份平台 |
| eyeix/meilisearch-ui | 连接服务、索引和文档管理、搜索设置 | 在服务器创建容器、安全控制平面、统一请求日志 |
| 自建 OneSearch | 将实例生命周期、搜索管理、账户安全与网关整合 | 需要承担运行时、安全、升级与备份恢复的维护 |

内置网页定位可参见 [Search Preview](https://www.meilisearch.com/docs/resources/self_hosting/getting_started/search_preview)；第三方 UI 能力参见 [eyeix/meilisearch-ui](https://github.com/eyeix/meilisearch-ui)。第三方 UI 的连接管理不能等同于 Docker 实例管理。

现有工具可作为交互参考，但生产管理主密钥应留在 Go 后端，不能写进前端构建产物或浏览器长期存储。

## 4. 功能矩阵

| 领域 | 目标 | 当前 dev | 后续服务器阶段 |
| --- | --- | --- | --- |
| 实例 | 创建、连接、启停、重启、归档 | 原生进程实际运行，本机外部接入，实例内操作记录 | Docker 容器、资源限额、状态协调 |
| 索引 | 创建、删除、独立配置 | 已实现 | 批量同步、索引别名或切换流程 |
| 文档 | 导入、更新、删除、查询 | JSON/NDJSON、单文档删除、分页、高亮与命中信息 | 导出、自动抓取和发布同步 |
| 搜索设置 | 搜索字段、返回字段、过滤、排序、同义词、容错 | 表单及 JSON 编辑 | 设置版本、差异和回滚 |
| 任务 | 真实异步结果、失败详情 | 查询、状态、错误 | 重试编排、取消支持、持久化队列 |
| 密钥 | 搜索和发布用途、索引权限、过期时间 | 创建、列表隐藏密钥、撤销 | 轮换提醒、受管网关凭据 |
| 搜索网关 | 防盗链、CORS、限流、结果数上限 | 已实现 | 可信代理 IP、全局限额、分布式限流 |
| 搜索历史 | IP、来源、设备、查询、状态、耗时 | 实例内展示，50 条分页，30 天保留 | 时间/状态筛选、聚合、导出和更完整保留策略 |
| 统计 | 每实例趋势与年度热力图 | 真实请求聚合，近 7/30 天统计，365 天活动日历 | 资源监控、聚合筛选和告警 |
| 账户 | 通行密钥、TOTP、恢复码、密码、会话 | 已接通，敏感操作验证 | 多用户、角色、邀请和账户恢复流程 |
| 审计 | 谁对什么做了什么 | 实际变更记录，中文展示 | 更完整的失败事件、不可变审计归档 |
| 备份 | 平台与搜索数据、加密、恢复 | 手动备份和下载，离线解密 | 快照、调度、异地对象存储、在线恢复演练 |
| 升级 | 固定版本、预检、备份、回滚 | 设计阶段 | Docker 新实例导入及切流 |

文档修改与设置修改采用异步任务。HTTP 接受请求不代表索引已生效；平台查询任务的最终状态后再提示成功。参考 [任务接口](https://www.meilisearch.com/docs/reference/api/async-task-management/list-tasks)。

## 5. 网站与密钥隔离

博客、文档站的内容结构、同义词和搜索排序不同，分开索引能独立调整。一个网站的公开密钥只授予 `search` 和该网站索引；发布流程另用写入密钥。不要把 `indexes: ["*"]` 或管理密钥放进网页。

Meilisearch API 密钥由 actions、indexes 和有效期约束。OneSearch 创建时提供用途预设，已有密钥列表即使上游返回密钥值也会脱敏。参考 [创建密钥接口](https://www.meilisearch.com/docs/reference/api/keys/create-api-key)。

当前公开网关拒绝主密钥，转交调用方提供的 Bearer 密钥，由引擎执行索引权限验证。它不会使用平台主密钥代替未授权调用方搜索。搜索权限只限制搜索接口，字段可见性还必须结合 displayedAttributes 和数据建模；公开索引不要包含私人字段。

## 6. 搜索历史与防盗链

自托管实例的统计数据不能自动给 OneSearch 提供每次请求的真实 IP。完整请求记录必须经过平台网关；直接访问原生引擎会绕过网关规则和记录。官方分析产品的范围见 [Analytics](https://www.meilisearch.com/docs/capabilities/analytics/overview)。

建议保留：时间、实例、索引、查询、部分参数、IP、User-Agent、来源、HTTP 状态、响应耗时、引擎耗时和结果数。不要保存授权头、会话 Cookie、密码、OTP 或搜索结果正文。IP 和搜索词可能包含个人数据，应配置保留期限并限制管理员访问。

防盗链采用分层策略：精确来源白名单限制浏览器跨站调用；引擎搜索密钥限制索引范围；频率限制减少批量调用；结果数上限约束单次响应。Origin/Referer 能被直接客户端伪造，不能当作访问身份或保密手段。本站网页的搜索密钥也是可见的，不应设计成隐藏秘密。

生产环境应把引擎端口置于内部网络，只公开网关入口。CDN/WAF 可以承担边缘限流，但缓存包含 API 密钥或敏感搜索条件的响应需要单独评估；当前接口返回 no-store。

## 7. 管理账户安全

密码登录使用服务端哈希及不可预测的会话标识；启用 TOTP 后密码登录必须带有效验证码或单次恢复码。验证码步长 30 秒，允许相邻时间窗，并持久化已消费时间步以防重放。标准依据为 [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238)。

通行密钥采用 WebAuthn，不自制密码学协议，使用 [go-webauthn](https://github.com/go-webauthn/webauthn)。绑定 RP ID 与精确 Origin，挑战单次有效、5 分钟过期；注册绑定当前管理员会话，要求设备用户验证。开发使用 localhost，正式域名上线后需要为新 RP 重新注册。

产品策略是：设备用户验证成功的通行密钥可独立登录；TOTP 用于密码登录。添加通行密钥在已登录状态下通过设备用户验证，无需密码重验；移除通行密钥与 TOTP 管理须近期验证；修改密码验证当前密码和已启用的第二因素，并轮换当前会话、撤销其它会话。真实设备的注册与登录仍需要用户完成浏览器的指纹/PIN 等交互。

## 8. 备份和升级

平台数据库、凭据加密密钥、搜索引擎数据是不同的恢复对象。平台备份排除登录会话和未完成认证挑战，避免恢复出历史访问权限。搜索 dump 独立保存，恢复时需重新构建索引。

官方提供 snapshots 与 dumps：snapshot 适合同版本快速恢复，dump 适合迁移或重新构建。版本兼容性和选择依据参见 [备份说明](https://www.meilisearch.com/docs/resources/self_hosting/data_backup/overview)。OneSearch dev 先提供 dump，后续增加 snapshot 和异地保留。

升级不是修改镜像标签后直接覆盖数据。建议备份、启动目标版本、新实例导入、核对文档和搜索结果，再切换网关；保留旧实例数据以便回滚。是否可原地升级必须逐版本核对 [升级说明](https://www.meilisearch.com/docs/resources/migration/updating)。

## 9. Docker 管理边界与待定项

Docker daemon 是高权限管理面。浏览器不能输入任意镜像、命令、宿主机挂载路径或 privileged 参数；仅允许平台版本白名单和平台生成的数据卷。参考 [Docker 安全说明](https://docs.docker.com/engine/security/) 和 [Engine API](https://docs.docker.com/reference/api/engine/)。

后续实施前需确定：服务器资源预算、正式域名、可信反向代理网段、恢复时间目标、异地备份存储和多用户需求。上述未确定项不影响当前 dev 的开发与验证。控制台不在此阶段提供集群自动扩容、计费或跨区域高可用。
