# 服务器部署

生产模式使用 Docker 管理真实 Meilisearch 容器；本地 dev 继续使用原生进程。前端由 Go 服务提供，统一端口 3013。

## 目录

```text
/home/apps/one-search/
  .env                      # 当前发布号、稳定的部署标识、固定引擎镜像
  docker-compose.yml
  DEPLOYMENT.md
  releases/<日期>-<提交>/
    source/                 # 对应 Git 提交的源码
    bundle/                 # Linux 二进制、前端、运行镜像 Dockerfile
    SHA256SUMS
  data/
    onesearch.db
    encryption.key
    initial-login.txt       # 首次随机登录信息，修改密码后删除
    instances/<实例 ID>/    # 引擎数据库、dump、snapshot
    backups/                # 界面生成的加密备份
  backups/                  # 运维快照与升级前备份
```

`data`、`.env` 和备份不进入 Git。保留 `encryption.key` 才能解密 SQLite 中的实例凭据。首次部署创建新的平台账户和数据，不复制开发环境的密码、通行密钥和会话。

## 构建和启动

完整源码可使用根目录 `Dockerfile` 构建。服务器发布包使用 `deploy/Dockerfile.release`，在开发机完成前端构建和 Linux 编译，减少服务器构建资源消耗。发布包的源码提交号和文件摘要同时记录。

```sh
# 源码构建方式
docker build -t ruida/onesearch:dev .

# 发布目录准备完成后，服务器运行
cd /home/apps/one-search
docker compose build
docker compose up -d
docker compose ps
curl -f http://127.0.0.1:3013/api/health
```

Compose 模板见 `deploy/docker-compose.yml`。部署 `.env` 内容：

```dotenv
ONESEARCH_RELEASE=<日期>-<提交>
ONESEARCH_DOCKER_OWNER=<首次生成并长期保留的随机部署标识>
ONESEARCH_ENGINE_IMAGE=getmeili/meilisearch:v1.54.3@sha256:e68913ab7d6f5b159529e472cfd362ce3c741fafd3c127961b2142abbe41b3c9
```

部署前拉取该固定镜像。代码使用 Docker API v1.53，要求 Docker Engine API 至少支持 v1.53；当前目标服务器支持 v1.56。不会根据浏览器输入拉取任意镜像、挂载目录或开放宿主端口。

## 端口、反向代理和身份验证

- 主服务仅映射 `127.0.0.1:3013:3013`，沿用服务器其它 apps 的方式。
- 域名 `https://search.cloudchewie.com` 反向代理至 `http://127.0.0.1:3013`。
- 代理须覆盖 Host、X-Real-IP、X-Forwarded-For、X-Forwarded-Proto；现有 OpenResty 配置已满足。
- 独立网络 `onesearch-engines` 使用 `10.213.13.0/24`。只信任其宿主网关 `10.213.13.1/32`，不可将整个容器网段或 `0.0.0.0/0` 加入代理信任列表。
- 后端从实际连接地址向左检查转发链，只跨越可信代理，忽略客户端伪造的左侧地址。历史、会话与限流使用相同的 IP 来源。
- 生产模式必须配置 HTTPS Origin，登录 Cookie 开启 Secure、HttpOnly、SameSite=Strict。
- 通行密钥绑定正式域名；开发环境注册的 localhost 凭据不能迁移为正式域名凭据。
- 管理页面、API 和公开搜索均从同一服务提供。引擎只在内部网络暴露 7700，不直接对外开放。

第一次登录请通过服务器 `data/initial-login.txt` 获取用户名和随机密码，然后在账户设置修改密码。不要将文件内容写入日志、仓库或部署报告。

## Docker 托管实现

引擎容器名 `onesearch-engine-<实例 ID>`。实例标识限定 32 位十六进制，容器必须同时匹配部署归属标签、实例标签及固定数据挂载，才能启动、停止或读取日志。所有引擎运行于 production 模式，使用随机主密钥；凭据加密存储，仅由 Go 后端使用。

控制台重启不关闭搜索容器。服务器重启由 Docker restart policy 恢复运行中的引擎；用户已停止的容器保持停止。控制台启动时重新探测，并恢复 desiredState 为 running 的托管实例。归档会停止引擎、保留容器及数据。

控制台挂载 Docker socket，因此部署管理员拥有管理宿主 Docker 的能力。该控制台仅面向可信管理员，不提供多租户隔离。Web API 不提供任意 Docker 命令、镜像、目录或 socket 代理；仍需保护管理员账号和服务器访问权限。

生产模式暂不接入外部引擎，避免开发模式的 localhost 语义在容器内产生歧义。升级编排、在线恢复、定时异地备份和多用户角色仍未实现。索引内存预算是 Meilisearch 索引过程预算，不是进程内存硬上限。

## 备份和更新

界面支持平台与单实例 dump 加密备份。平台备份不包含引擎数据库或有效登录会话；单实例 dump 通过内部 API 创建，并从共享数据目录读取。离线解密工具见开发文档。

备份页可设置每日自动备份，按北京时间执行，每天最多一次。平台和各运行中的托管实例分别保留指定份数，手动备份不清理。自动备份密码加密保存在数据库中，仍需管理员单独妥善保存以便离线恢复。该功能只写本机数据目录，不包含异地存储；默认关闭。

更新时先做平台和引擎数据备份，在 `releases` 添加新的发布包，更新 `.env` 的发布号后 `docker compose up -d --build`。稳定部署标识不能更换。不要随意修改引擎镜像版本：现有实例不会自动重建或迁移，跨版本升级应先验证 dump 恢复。

主镜像使用 `ruida/onesearch:dev`。发布后同时保存本机不可变标签 `ruida/onesearch:<release>`，回滚时可重新构建旧发布包或把对应不可变标签重新标记为 dev。

回滚控制台时恢复旧发布号并重建主容器。数据结构变化时须配合升级前备份，不能保证任意旧版本直接读取新数据库。

## 参考

- [Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.53/)
- [Meilisearch 生产部署](https://www.meilisearch.com/docs/resources/self_hosting/deployment/running_production)
