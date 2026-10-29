// Deterministic, isolated UI review server. Never connects to the real API.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const time = '2026-10-29T08:30:00Z';
const instance = {
  id: 'review',
  name: '博客搜索',
  description: '文章与文档索引',
  provider: 'native',
  host: '127.0.0.1',
  port: 7811,
  memoryMB: 1024,
  threads: 2,
  status: 'running',
  desiredState: 'running',
  version: '1.54.3',
  createdAt: time,
  canControl: true,
};
const indexes = ['articles', 'documentation'].map((uid) => ({
  uid,
  primaryKey: 'id',
  createdAt: time,
  updatedAt: time,
}));
const records = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1),
  title: `OneSearch 使用指南 ${i + 1}`,
  excerpt: '在网站中接入全文搜索，配置索引字段与访问规则。',
  url: `https://example.com/guide/${i + 1}`,
  category: '文档',
}));
const paged = (results, total = results.length) => ({
  results,
  total,
  limit: 20,
  offset: 0,
});
const days = Array.from({ length: 365 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 9, 30 + i)).toISOString().slice(0, 10),
  requests: i % 13 === 0 ? 0 : (i % 7) * 3,
  successes: (i % 7) * 3,
  zeroResults: 0,
  durationMs: 18,
  results: 5,
  public: 6,
  admin: 1,
}));
const operation = {
  id: 'op1',
  instanceId: 'review',
  instanceName: '博客搜索',
  action: 'instance.create',
  status: 'succeeded',
  message: '实例已启动',
  createdAt: time,
  finishedAt: time,
};
const settings = {
  searchableAttributes: ['title', 'summary'],
  displayedAttributes: ['*'],
  filterableAttributes: ['category'],
  sortableAttributes: ['id'],
  stopWords: [],
  synonyms: {},
  typoTolerance: { enabled: true },
};
function data(path) {
  if (path === '/auth/me')
    return { username: 'admin', name: '管理员', avatarUrl: '', mode: 'dev' };
  if (path === '/system')
    return {
      mode: 'dev',
      runtime: 'native',
      runtimeAvailable: true,
      engineVersion: '1.54.3',
      dockerAvailable: false,
      origin: 'http://localhost:5179',
    };
  if (path === '/instances')
    return [
      instance,
      { ...instance, id: 'archive', name: '历史归档', status: 'archived' },
    ];
  if (path === '/calendar')
    return { days, since: days[0].date, timezone: 'UTC' };
  if (path === '/security')
    return {
      verifiedUntil: 0,
      totpEnabled: true,
      passkeyCount: 2,
      recoveryRemaining: 8,
      rpOrigin: 'http://localhost:5179',
    };
  if (path === '/passkeys')
    return [
      { id: 'key1', name: 'Windows Hello', createdAt: time, lastUsedAt: time },
      { id: 'key2', name: '随身安全密钥', createdAt: time, lastUsedAt: '' },
    ];
  if (path === '/sessions')
    return [
      {
        id: 'current',
        ip: '127.0.0.1',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0.0.0 Safari/537.36',
        current: true,
        createdAt: time,
        lastSeen: time,
        method: 'password',
      },
      {
        id: 'mobile',
        ip: '192.0.2.1',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
        current: false,
        createdAt: time,
        lastSeen: time,
        method: 'passkey',
      },
    ];
  if (path === '/audit')
    return Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      actor: 'admin',
      action: i % 2 ? 'login.password' : 'site-policy.update',
      target: i % 2 ? 'console' : 'review',
      createdAt: time,
    }));
  if (path === '/backups/schedule')
    return {
      enabled: true,
      time: '03:00',
      keep: 7,
      includeDumps: true,
      hasPassword: true,
      lastRun: time,
    };
  if (path === '/backups')
    return [
      {
        id: 'backup1',
        kind: 'platform',
        status: 'succeeded',
        createdAt: time,
        size: 1048576,
        automatic: true,
      },
      {
        id: 'backup2',
        kind: 'dump',
        instanceId: 'review',
        status: 'failed',
        createdAt: time,
        size: 0,
        error: '连接引擎超时，请稍后重试',
      },
    ];
  if (path === '/history')
    return paged(
      [
        {
          id: 'history1',
          instanceId: 'review',
          indexUid: 'articles',
          source: 'public',
          query: '使用指南',
          ip: '192.0.2.2',
          status: 200,
          durationMs: 12,
          resultCount: 8,
          createdAt: time,
        },
      ],
      42,
    );
  if (path === '/instances/review') return instance;
  if (path === '/instances/review/analytics')
    return {
      days: days.slice(-30),
      requests: 1280,
      successes: 1270,
      errors: 10,
      zeroResults: 24,
      averageMs: 12,
      public: 1250,
      admin: 30,
      uniqueIPs: 86,
      topQueries: [
        { query: '使用指南', count: 42 },
        { query: '全文搜索', count: 28 },
      ],
    };
  if (path === '/instances/review/operations') return [operation];
  if (path === '/instances/review/logs')
    return {
      text: '2026-10-29T08:30:00Z INFO Server listening on 127.0.0.1:7811\n2026-10-29T08:31:00Z INFO GET /indexes 200\n2026-10-29T08:31:01Z INFO POST /indexes/articles/search 200',
    };
  if (path.endsWith('/chat-settings')) return {};
  if (path.endsWith('/application'))
    return {
      appId: 'reviewapp',
      instanceId: 'review',
      indexUid: 'articles',
      name: '博客搜索',
      createdAt: time,
    };
  if (path.includes('/sites/'))
    return {
      enabled: true,
      origins: ['https://example.com'],
      requireOrigin: true,
      rate: 60,
      maxLimit: 100,
    };
  const engine = path.split('/engine/')[1];
  if (engine === 'indexes') return paged(indexes);
  if (engine === 'stats')
    return {
      databaseSize: 23000000,
      indexes: {
        articles: { numberOfDocuments: 1280 },
        documentation: { numberOfDocuments: 320 },
      },
    };
  if (engine === 'keys')
    return paged([
      {
        uid: 'searchkey',
        name: '网站搜索',
        description: '仅搜索权限',
        actions: ['search'],
        indexes: ['articles'],
        expiresAt: null,
        createdAt: time,
      },
    ]);
  if (engine?.endsWith('/settings')) return settings;
  if (engine?.endsWith('/documents')) return paged(records, 42);
  if (engine?.endsWith('/search'))
    return {
      hits: records.slice(0, 3),
      query: '指南',
      processingTimeMs: 12,
      totalHits: 3,
      totalPages: 1,
      page: 1,
      hitsPerPage: 20,
    };
  if (engine === 'tasks')
    return paged([
      {
        uid: 1,
        status: 'succeeded',
        type: 'documentAdditionOrUpdate',
        indexUid: 'articles',
        enqueuedAt: time,
        duration: 'PT0.12S',
      },
    ]);
  return undefined;
}
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  plugins: [
    react(),
    {
      name: 'review-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url.startsWith('/api/')) return next();
          const path = new URL(req.url, 'http://localhost').pathname.slice(4);
          const result = data(path);
          res.setHeader('Content-Type', 'application/json');
          if (req.method !== 'GET' && !path.endsWith('/search')) {
            res.statusCode = 403;
            res.end(
              JSON.stringify({
                error: { message: '视觉检查环境：未执行写入操作' },
              }),
            );
            return;
          }
          res.statusCode = result === undefined ? 404 : 200;
          res.end(
            JSON.stringify(
              result === undefined
                ? { error: { message: `缺少检查数据: ${path}` } }
                : { data: result },
            ),
          );
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
  logLevel: 'warn',
});
await server.listen();
console.log('Isolated OneSearch review: http://localhost:5179');
