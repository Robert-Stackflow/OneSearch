# OneSearch API

生产地址：`https://search.cloudchewie.com`。开发地址通过 Vite 的 `/api` 代理到 Go 的 `127.0.0.1:7800`。本文描述仓库中的现有接口。

## 身份与响应

控制台管理 API 使用登录 Cookie。写操作携带 `X-OneSearch-Request: 1`，浏览器来源必须是配置的控制台 Origin。Cookie 为 HttpOnly、SameSite=Strict，生产环境 Secure，24 小时过期。App Key 不能登录控制台或管理 Docker、账户及备份。

网站/发布服务使用 `Authorization: Bearer <App Key>`，不使用 Cookie，不把密钥放在 URL。App ID 是公开标识，格式为 `app_` 加 32 位十六进制字符；一个应用绑定一个实例中的一个索引。绑定不能通过调用方参数更改。多个网站可使用同一实例的独立索引和 App ID。

管理成功返回 `{"data": ...}`；错误返回 `{"error":{"message":"..."}}`。App 接口成功直接返回 Meilisearch JSON，Chat 返回流式内容；错误沿用 OneSearch 错误格式。部分删除接口返回 204，无响应体。常见状态：400 参数无效，401 未登录/密钥失效，403 权限或来源拒绝，404 资源不存在，409 实例状态不允许，413 请求过大，429 限流，502 上游失败，503 实例暂不可用。

## 应用与密钥

管理员在实例的「访问密钥」页选择索引、创建应用，再创建 App Key。接口：

| 方法 | 路径 | 请求与返回 |
| --- | --- | --- |
| GET | `/api/instances/{id}/sites/{index}/application` | 返回应用或 `data: null`，不会自动创建 |
| POST | 同上 | 创建或返回已有应用，重复请求不改变 App ID |
| GET | 同上加 `/chat-settings` | 读取模型配置，移除 `apiKey` 字段 |
| PATCH | 同上加 `/chat-settings` | JSON 配置对象；启用引擎 chatCompletions，设置该 App 的工作区 |

应用对象：`{appId, instanceId, indexUid, name, createdAt}`。实例 ID 为 32 位十六进制；索引 UID 只允许字母、数字、下划线和连字符，1–128 字符。应用随平台备份保存。

| 类型 | actions | 使用位置 |
| --- | --- | --- |
| Search API Key | `search` | 网站前端 |
| Admin API Key | Read-Only 全部权限，加 `documents.add`, `documents.delete`, `settings.update` | 服务器/发布流程 |
| Read-Only Admin API Key | `search`, `documents.get`, `indexes.get`, `settings.get`, `tasks.get`, `stats.get` | 服务器读取和监控 |
| Chat API Key | `search`, `chatCompletions` | 网站搜索/对话 |

每种 App Key 的 `indexes` 都只包含该应用的索引；App 网关拒绝主密钥、通配符、跨索引密钥和未开放的操作权限。Admin 指应用的文档与搜索设置管理权限，不是平台管理员权限。默认引擎全局密钥不用于 App 网关。密钥通过管理引擎代理的 POST `keys` 创建、DELETE `keys/{uid}` 撤销；创建响应含 `key`，列表移除此值。支持过期时间或 `expiresAt: null`。每次调用重新查询引擎密钥元数据，撤销立即生效。

## 网站搜索

`POST /api/apps/{appId}/search`。先在「站点访问」开启索引入口，并配置精确的来源（协议、域名和可选端口，不含路径）。OPTIONS 预检只对获准来源开放，允许 Authorization 和 Content-Type，不允许携带 Cookie。

```js
const response = await fetch('https://search.cloudchewie.com/api/apps/APP_ID/search', {
  method: 'POST', credentials: 'omit',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer SEARCH_KEY' },
  body: JSON.stringify({
    q: '强化学习', page: 1, hitsPerPage: 6,
    attributesToRetrieve: ['id', 'title', 'url', 'content'],
    attributesToHighlight: ['title', 'content'], attributesToCrop: ['content'],
    cropLength: 45, highlightPreTag: '[onesearch-hit]',
    highlightPostTag: '[/onesearch-hit]', showMatchesPosition: true
  })
});
const result = await response.json();
```

参数白名单：`q`, `limit`, `offset`, `page`, `hitsPerPage`, `filter`, `sort`, `attributesToRetrieve`, `attributesToHighlight`, `attributesToCrop`, `facets`, `showMatchesPosition`, `highlightPreTag`, `highlightPostTag`, `cropLength`, `cropMarker`, `showRankingScore`。

请求最大 64 KiB。page 从 1 开始，page=0 仅计数。页码模式返回 `{hits,totalHits,totalPages,page,hitsPerPage,processingTimeMs,...}`；offset/limit 模式返回 estimatedTotalHits。含 page 或 hitsPerPage 时优先页码模式并移除 offset/limit；分页参数要求非负整数，每页至少 1，受站点 maxLimit 限制（1–100）。总结果数受索引 `pagination.maxTotalHits` 限制，默认 1000。

默认请求所有返回字段的高亮、正文/摘要/描述裁剪（40 个词）以及命中位置；显式参数覆盖默认值。只返回 displayedAttributes 允许的字段。

- 原始文档字段：标题、地址、正文等。
- `_formatted`：高亮/裁剪后的字段，默认 `<em>` 标记，可自定义。正文摘要围绕命中词裁剪。
- `_matchesPosition`：各字段匹配位置 start/length，基于原始字段的 UTF-8 **字节**，不能直接当 JavaScript 字符索引。
- `_rankingScore`：showRankingScore=true 时的相关性分数，不是匹配概率。

将自定义高亮标记拆成文本节点和受控 `<mark>` 元素。不要将整个 `_formatted` 字符串直接作为可信 HTML 插入。控制台支持查看完整响应。

历史记录包含真实连接 IP、来源头、User-Agent、状态、耗时、结果数、部分搜索参数和请求大小；不保存密钥。来源头可被服务器客户端伪造，需要结合密钥权限与限流。引擎端口应仅对后台开放。限流是单机一分钟窗口，服务重启归零。

## 文档发布与只读管理

以下入口只接受服务器调用，带 Origin 的浏览器请求会被拒绝；每 IP 最多 300 次/分钟。使用 Admin 或 Read-Only Admin Key，权限不足时拒绝。成功响应保持 Meilisearch 原始结构。

| 方法 | `/api/apps/{appId}` 后缀 | 权限与约束 |
| --- | --- | --- |
| GET | `/index` | indexes.get；仅当前索引元信息 |
| GET | `/stats` | stats.get；当前索引统计 |
| GET | `/settings` | settings.get |
| PATCH | `/settings` | settings.update；JSON 对象，64 KiB；响应 taskUid |
| GET | `/documents` | documents.get；limit 1–1000、offset 0–10000000、可选 fields；原始结果含 results/total/limit/offset |
| GET | `/documents/{documentId}` | documents.get；标识符合索引 UID 字符规则 |
| POST | `/documents` | documents.add；1–1000 篇 JSON 数组，最大 16 MiB；id 为有效、不重复的字符串；响应 202 taskUid |
| POST | `/documents/delete-batch` | documents.delete；1–10000 个有效字符串 id；最大 16 MiB；响应 202 taskUid |
| GET | `/tasks/{taskUid}` | tasks.get；非负 32 位数字；任务必须属于该应用的索引 |
| GET | `/tasks` | tasks.get；强制当前 indexUids；允许 limit/from/statuses/types，拒绝调用方 indexUids |

发布同步：先 GET documents?fields=id 读取已有 id；分批 POST documents 并等待每个 tasks/{taskUid} 到 succeeded；全部更新成功后才删除不再存在的旧 id，再等待删除任务完成。failed/canceled 要终止，不应清空旧索引。文档主键应设为 id，URL 转换出的稳定 id 能支持幂等更新。

```sh
curl -X POST "$ONESEARCH_URL/api/apps/$APP_ID/documents" \
  -H "Authorization: Bearer $ADMIN_KEY" -H 'Content-Type: application/json' \
  --data '[{"id":"article_1","title":"示例","url":"https://blog.example.com/posts/example/","content":"文章正文"}]'
```

保留旧入口 `/api/search/{instanceId}/{indexUid}` 和 `/api/publish/{instanceId}/{indexUid}/documents`、`/documents/delete-batch`、`/tasks/{taskUid}` 以兼容既有配置。旧搜索入口只接受纯 search 权限；旧发布文档列表强制只返回 id。新网站优先使用 App ID 入口。

## Chat

`POST /api/apps/{appId}/chat/completions`，使用 Chat Key。共用该索引的公开开关、来源白名单和 IP 限流。64 KiB 请求，最长 5 分钟，客户端关闭连接会取消上游；成功流逐块刷新，设置 X-Accel-Buffering:no，反向代理应关闭该路由的响应缓冲。

```json
{"model":"YOUR_MODEL","messages":[{"role":"user","content":"介绍强化学习"}],"stream":true}
```

工作区 UID 固定为 App ID，不能传其它应用的 workspace。模型提供商配置由登录的管理员在「模型服务」保存，例如 `{"source":"openAi","apiKey":"LLM_PROVIDER_KEY","baseUrl":null}`；OpenAI 兼容服务可填写 baseUrl。apiKey 只写不回显，修改其它配置时省略它可保留原值。此处模型服务密钥与 App Key 不同。引擎中的 Chat 需要支持并启用实验功能；模型和费用由配置的提供商决定。未配置模型服务时，引擎会拒绝调用。测试覆盖网关鉴权与流式代理，实际模型调用需要有效提供商凭据。

## 控制台账户 API

以下除登录流程外均要求已登录；TOTP 与备份敏感操作要求最近 5 分钟验证，可先 POST /api/auth/reauth。

| 方法/路径 | 请求与行为 |
| --- | --- |
| POST `/api/auth/login` | `{username,password,otp?}`。密码正确且启用 TOTP、未填写 otp：返回 data.requiresTwoFactor=true，不创建会话；再提交完整凭据。otp 可为恢复码 |
| GET `/api/auth/me` | `{username,name,avatarUrl,mode}` |
| POST `/api/auth/logout` | 撤销当前会话 |
| POST `/api/auth/reauth` | `{password,otp?}`；未启用 TOTP 不要求 otp |
| PUT `/api/account` | `{name}`，1–60 字符显示名，登录用户名不改变 |
| POST `/api/account/avatar` | multipart/form-data，字段 avatar；JPEG/PNG/GIF，最多 5 MiB、4096×4096；不设置 JSON Content-Type |
| GET `/api/account/avatar` | 私有图片响应，仅当前登录账户可读 |
| POST `/api/account/password` | `{currentPassword,newPassword,otp?}`；校验当前密码与启用的第二因素，新密码 12–72 字节；轮换当前会话、撤销其他会话和挑战 |
| GET `/api/security` | 当前 TOTP 状态 |
| POST `/api/security/totp/begin` | 开始设置，返回临时秘密和 otpauth 信息；5 分钟有效 |
| POST `/api/security/totp/confirm` | `{code}`，确认后启用，返回一次性恢复码，务必保存 |
| POST `/api/security/totp/disable` | `{code}`，关闭验证器 |
| GET `/api/passkeys` | 当前账户的通行密钥元数据，不返回私钥 |
| POST `/api/passkeys/begin` | `{name}`，注册挑战。设备用户验证，不要求再次输入密码 |
| POST `/api/passkeys/finish` | WebAuthn navigator.credentials.create 返回的标准凭据 JSON |
| DELETE `/api/passkeys/{key}` | 撤销指定凭据，要求近期验证 |
| POST `/api/auth/passkey/begin` | `{username}`，返回登录挑战 |
| POST `/api/auth/passkey/finish` | WebAuthn navigator.credentials.get 的标准凭据 JSON |
| GET `/api/sessions` | 会话设备/IP/活跃时间/当前会话标识 |
| DELETE `/api/sessions/{session}` | 撤销指定会话；`others` 表示除当前会话外的全部 |
| GET `/api/audit` | 审计原始事件代码及目标；界面提供中文标签 |

通行密钥绑定控制台 Origin/RP。所有挑战使用一次后消费。服务器生产账户与 dev 账户独立，部署不迁移 dev 凭据。

## 实例与观察

| 方法/路径 | 请求或查询 |
| --- | --- |
| GET `/api/health` | 无需登录；data.status=ok，含 mode |
| GET `/api/system` | 登录后读取环境元信息 |
| GET `/api/instances` | 所有实例元数据，不返回主密钥 |
| POST `/api/instances` | `{name,description?,provider,memoryMB,threads,host?,apiKey?}`；dev native/external，生产 docker；受支持范围以服务校验为准 |
| GET `/api/instances/{id}` | 实例状态和可操作信息 |
| POST `/api/instances/{id}/actions` | `{action:"start"\|"stop"\|"restart"\|"archive"}`，响应异步操作记录 |
| GET `/api/instances/{id}/logs` | data.text，当前引擎运行日志 |
| GET `/api/instances/{id}/operations` | 此实例最近 100 条生命周期操作 |
| GET `/api/operations` | 平台操作记录 |
| GET `/api/history` | instance/index/q/source/offset；每页 50 条；results,total,offset,limit；原始历史保留 30 天 |
| GET `/api/calendar` | 年度搜索活动聚合 |
| GET `/api/instances/{id}/analytics` | days=7 或 30，默认 30；包含每日请求、成功/错误、零结果、平均耗时、独立 IP、热门词；时区 UTC |
| GET/PUT `/api/instances/{id}/sites/{index}` | `{enabled,origins,requireOrigin,rate,maxLimit}`；rate 1–1000，maxLimit 1–100，origins 最多 30 个 |

管理引擎代理 `/api/instances/{id}/engine/{path}` 使用服务器凭据，但仅允许白名单路径：version/stats（GET），indexes（GET/POST），indexes/{uid}（GET/DELETE），documents（GET/POST/PUT）、documents/{id}（GET/DELETE）、search（POST）、settings（GET/PATCH）、stats（GET），tasks（GET）、tasks/{id}（GET），keys（GET/POST）、keys/{uid}（DELETE）。请求最多 16 MiB，成功使用 data 包装。拒绝任意 URL、Docker 参数和宿主目录操作。

## 备份

| 方法/路径 | 请求或行为 |
| --- | --- |
| GET `/api/backups` | 备份元数据与任务状态 |
| POST `/api/backups` | `{kind:"platform"\|"dump",instanceId?,password}`，近期验证，密码至少 12 位；返回异步记录 |
| GET `/api/backups/{backup}/download` | 下载成功生成的 .osbackup 加密文件 |
| GET `/api/backups/schedule` | `{enabled,time,keep,includeDumps,hasPassword,lastRun}`，不返回密码 |
| PUT `/api/backups/schedule` | `{enabled,time:"03:00",keep:7,includeDumps:true,password?}`；keep 1–100；近期验证，已存密码可省略以保留 |

自动备份按北京时间每日最多一次，平台和每个运行中的托管实例分别保留 keep 份成功备份，失败记录另限额；手动备份不清理。平台备份含应用、账户、凭据、规则、请求历史、配置与加密密钥，但排除有效会话和认证挑战，不包含引擎数据库。dump 备份包含单实例数据。离线解密/恢复操作见 [开发说明](dev.md)；当前没有在线恢复 API。

## 参考

- [Meilisearch 搜索 API](https://www.meilisearch.com/docs/reference/api/search/search-with-post)
- [高亮与 UTF-8 字节位置协议](https://specs.meilisearch.dev/specifications/text/0118-search-api.html)
- [密钥权限](https://www.meilisearch.com/docs/resources/self_hosting/security/master_api_keys)
- [Chat 工作区配置](https://www.meilisearch.com/docs/reference/api/chats/update-settings-of-a-chat-workspace)
