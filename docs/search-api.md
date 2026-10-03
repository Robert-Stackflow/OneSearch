# 网站搜索接入

向控制台站点的 `/api/search/{实例 ID}/{索引 UID}` 发送 POST JSON，使用 `Authorization: Bearer 搜索密钥`。在「站点访问」开启入口、配置允许的来源；在「访问密钥」创建仅含 `search` 操作且绑定目标索引的密钥。

## 分页与摘要

```json
{
  "q": "强化学习",
  "page": 1,
  "hitsPerPage": 10,
  "attributesToRetrieve": ["id", "title", "url", "content"],
  "attributesToHighlight": ["title", "content"],
  "attributesToCrop": ["content"],
  "cropLength": 40,
  "showMatchesPosition": true,
  "showRankingScore": true
}
```

`page` 从 1 开始，响应包含 `totalHits`、`totalPages`、`page`、`hitsPerPage`、`processingTimeMs` 和 `hits`。结果总量仍受索引 `pagination.maxTotalHits` 限制（默认 1000）；后台搜索设置的高级 JSON 可调整该值。公开网关会将每页大小限制在站点规则的「每次返回结果上限」内。

也可使用 `offset` 与 `limit`，此模式返回 `estimatedTotalHits`。两种模式不要混用；网关收到 `page` 或 `hitsPerPage` 时使用页码模式并移除 `offset`/`limit`。分页参数只接受非负整数；每次返回大小至少 1。`page: 0` 可用于只返回计数。

公开入口默认开启 `attributesToHighlight: ["*"]`、正文/摘要/描述裁剪（40 个词）和 `showMatchesPosition: true`；显式参数优先。仅有 `displayedAttributes` 中的字段可以返回。若要显示正文的命中上下文，应在索引「返回字段」中允许 `content`；不要开放私人字段。

## 结果中的信息

- 原始字段：标题、地址等文档数据。
- `_formatted`：包含高亮和裁剪后的字段。默认高亮标记为 `<em>` 与 `</em>`；可通过 `highlightPreTag`/`highlightPostTag` 自定义。
- `_matchesPosition`：按字段返回每处匹配的 `start`/`length`。位置基于原始字段的 UTF-8 **字节**，不能直接拿来当 JavaScript 字符索引或裁剪摘要的索引。
- `_rankingScore`：请求 `showRankingScore: true` 时返回相关性分数，不是严格的匹配概率。

匹配位置和高亮也可能包含未设置为可搜索的返回字段；用于渲染提示，不能仅凭该列表判断最终排序原因。裁剪在可能时围绕匹配词生成，因此比固定截取正文开头更适合摘要。

## 前端渲染

建议使用自定义标记，拆成文本与 `<mark>` 元素，通过 React 正常转义文本，而不是直接把整个 `_formatted` 字符串作为 HTML 插入。控制台采用此方式，文档里的 HTML 不会执行。外部网站可采用相同方法；若使用 HTML 插入，必须清理原始内容和不允许的标签。

控制台「查看搜索响应」可以查看并复制实际分页、格式与位置数据；点击文档标题可查看单条完整结果。

来源限制只作用于 OneSearch 网关，原生引擎端口应只对后台开放。来源头能够被非浏览器客户端伪造，需要与索引密钥权限、限流配合。

依据：[Meilisearch 搜索 API](https://www.meilisearch.com/docs/reference/api/search/search-with-post)、[搜索协议中的格式与字节位置](https://specs.meilisearch.dev/specifications/text/0118-search-api.html)。
