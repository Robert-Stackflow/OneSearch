# 本地开发与操作说明

> 部署更新：服务器 Docker 运行时、同端口前端服务、HTTPS Cookie 和可信代理已实现，配置与当前限制见 [服务器部署](deployment.md)。以下早期调研与演进方案中未完成项目，以部署文档为准。
## 环境

需要 Go 1.26、Node.js 22、npm 和官方 Meilisearch 可执行文件。当前验证引擎为 1.54.3。此阶段无需 Docker。

后端在项目根目录启动：

```powershell
$env:MEILISEARCH_BINARY = 'C:/path/to/meilisearch.exe'
go run ./cmd/onesearch
```

前端在另一个终端启动：

```powershell
Set-Location D:/Repositories/Web_Projects/OneSearch/web
npm ci
npm run dev
```

使用 `http://localhost:5178/`。即使前端监听日志显示 127.0.0.1，也应使用 localhost，使 WebAuthn RP 与站点配置保持一致。后台为 `127.0.0.1:7800`。

首次自动生成 admin 密码并写入 `data/dev-login.txt`。修改密码后此文件删除；环境变量中的初始密码只在创建第一个账户时使用，不能用来重置已存在的账户。

## 环境变量

| 变量 | 默认/要求 | 用途 |
| --- | --- | --- |
| `MEILISEARCH_BINARY` | 官方可执行文件绝对路径 | 创建托管实例 |
| `ONESEARCH_MODE` | `dev` | 当前不接受 Docker 模式 |
| `ONESEARCH_ADDR` | `127.0.0.1:7800` | 仅允许本机绑定 |
| `ONESEARCH_ORIGIN` | `http://localhost:5178` | 管理来源和 WebAuthn Origin |
| `ONESEARCH_DATA_DIR` | 项目 `data` 目录 | 持久化数据根目录 |
| `ONESEARCH_ADMIN_USER` | `admin` | 首次账户 |
| `ONESEARCH_ADMIN_PASSWORD` | 空时随机生成 | 首次密码，至少 12 字节 |
| `ONESEARCH_ENCRYPTION_KEY` | 空时生成 `data/encryption.key` | Base64 编码的 32 字节密钥 |

Windows 上 Go 文件权限参数不能替代目录 ACL。开发数据存放在当前用户目录或受控目录；上线应明确设置服务账户、Linux 文件权限/ACL 与备份访问范围。

## 使用流程

1. 添加实例，选择创建本地实例或接入已有本机服务。创建成功后等待实际运行状态。
2. 在详情页创建网站索引，为文档选择主键。
3. 导入 JSON 对象数组或每行一条 JSON 的 NDJSON。相同主键更新已有记录。
4. 调整搜索字段与返回字段，等待任务成功；在“文档与搜索”中验证查询。
5. 为网站创建只读搜索密钥，绑定网站索引；仅创建时显示其值。
6. 在“站点访问”开启公开入口，设置完整来源域名、频率和结果上限。
7. 网站调用公开入口，查看搜索历史；原生端口应由后端独占访问。

公开接口示例（变量值由网站配置提供，不要填入主密钥）：

```javascript
const result = await fetch(`${searchHost}/api/search/${instanceId}/${indexUid}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${indexSearchKey}`,
  },
  body: JSON.stringify({ q: input, limit: 10 }),
});
if (!result.ok) throw new Error(`搜索失败：${result.status}`);
const data = await result.json();
```

允许来源为网站网页实际 Origin，例如 `https://blog.example.com`，不含路径和结尾斜杠。Origin/Referer 不是不可伪造的身份凭证；搜索权限仍由引擎密钥约束。

## 账户设置

点击侧栏底部账户头像，选择账户设置。登录安全中可添加通行密钥和设置 TOTP；注册真实设备时需要本人在浏览器完成验证。正式域名与 localhost 是不同的 WebAuthn RP，不能直接沿用开发凭据。

添加通行密钥不要求密码验证，仍需已登录和设备的用户验证。删除通行密钥、设置 TOTP 与备份创建要求 5 分钟内验证身份；过期时自动打开验证弹窗，成功后继续原操作。未启用 TOTP 时只需当前密码。TOTP 同一验证码不能重复使用，刚使用后下一次敏感验证应等待下一个验证码或使用一次性恢复码。

修改密码需当前密码和已启用的第二因素。成功后保留轮换后的当前会话，其它会话撤销。会话列表显示实际连接 IP、设备标识和最后活跃时间；“撤销其它会话”立即阻止旧会话的后续 API 请求。

## 备份与恢复

平台备份和搜索数据备份分别创建。备份密码至少 12 字节，不会保存；丢失密码无法解密。平台备份中包含加密凭据对应的加密密钥，因此整个文件必须保持加密和受控访问。

当前离线工具把备份解密到一个新的目录，不直接覆盖运行环境：

```powershell
$env:ONESEARCH_BACKUP_PASSWORD = Read-Host '备份密码'
go run ./cmd/backup-extract ./data/backups/ID.osbackup ./data/restored-ID
Remove-Item Env:ONESEARCH_BACKUP_PASSWORD
```

示例的 Read-Host 会产生可见文本输入；实际操作宜通过受控终端以隐藏方式读取并临时设置环境变量。不要把密码写在命令参数、文档或提交记录中。

平台恢复：先停止后台并另行备份当前目录，核对 manifest，再用解密出的 `onesearch.db` 和 `encryption.key` 作为一组替换对应文件。环境变量加密密钥必须同步调整。不要把旧 WAL/SHM 文件与恢复的数据库混用。重新启动后会话为空，需重新登录；实例数据不在平台备份内，需要另行恢复。

数据恢复：使用解密的 `engine.dump` 启动一个新数据库目录，示例：

```powershell
meilisearch.exe --http-addr 127.0.0.1:7901 --db-path ./new-data.ms --import-dump ./restored/engine.dump --no-analytics
```

应同时通过 `MEILI_MASTER_KEY` 环境变量配置新实例认证。完成重建后检查文档数量、重要查询、设置和密钥权限，再把新实例接入平台。不要把 dump 导入已有数据库来覆盖正在使用的服务。当前无在线一键恢复按钮。

## 检查与排错

```powershell
go test ./...
Set-Location web
npm run build
```

`scripts/dev-smoke.py` 针对本机真实服务验证博客数据、公开网关和备份。它会读取开发初始登录文件，创建“博客演示”实例并导入 `Blog/public/search.xml`，生成验证用加密备份，密码放在被 Git 忽略的 `data/smoke-backup-password.txt`。该脚本不是生产部署工具；修改密码后初始文件不存在，不应重新生成来绕过账户认证。

端口冲突：查看实例运行日志；端口池耗尽时不会覆盖现有服务。主密钥/API 密钥失效：检查外部接入凭据，不要把主密钥替换到网站公开配置。后台重启后实例停止：在详情页重新启动，持久化索引数据保留。

旧原生进程遗留：平台不会按历史 PID 停止陌生进程，先在本机确认进程来源并处理，避免误杀其它服务。服务器 Docker 状态协调属于后续实现。

文档列表和搜索结果均支持分页与每页数量调整。点击文档标题查看完整文档与命中信息；搜索后可点击“查看搜索响应”复制包含分页和格式信息的 JSON。详情见 [网站搜索接入](search-api.md)。

`scripts/dev-search-smoke.py` 验证既有博客演示的文档分页、搜索分页、高亮、命中位置和公开入口分页上限；仅给该公共内容演示的返回字段补充正文，并创建后撤销临时搜索密钥。
