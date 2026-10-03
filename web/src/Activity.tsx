import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Code, Paper, Stack, Table, Text } from '@mantine/core';
import {
  api,
  formatDate,
  type Operation,
  type System,
  type Instance,
  actionLabels,
} from './api';
import { PageTitle, Status, Loading, ErrorState, Empty } from './components';
const auditLabels: Record<string, string> = {
  'instance.create': '创建实例',
  'instance.start': '启动实例',
  'instance.stop': '停止实例',
  'instance.restart': '重启实例',
  'instance.archive': '归档实例',
  'login.password': '密码登录',
  'login.passkey': '通行密钥登录',
  logout: '退出登录',
  'session.revoke': '撤销登录会话',
  'totp.enable': '开启双因素认证',
  'totp.disable': '关闭双因素认证',
  'passkey.register': '添加通行密钥',
  'passkey.remove': '移除通行密钥',
  'password.change': '修改密码',
  'site-policy.update': '更新站点访问规则',
  'backup.create': '创建备份',
};
function auditAction(action: string) {
  if (auditLabels[action] || actionLabels[action])
    return auditLabels[action] || actionLabels[action];
  const [method, path = ''] = action.split(' ');
  if (path === 'indexes' && method === 'POST') return '创建索引';
  if (path === 'keys' && method === 'POST') return '创建访问密钥';
  if (path.startsWith('keys/') && method === 'DELETE') return '撤销访问密钥';
  if (path.endsWith('/settings')) return '更新搜索设置';
  if (path.includes('/documents'))
    return method === 'DELETE' ? '删除文档' : '导入或更新文档';
  if (path.startsWith('indexes/') && method === 'DELETE') return '删除索引';
  return '管理操作';
}
function auditTarget(target: string) {
  return (
    (
      {
        console: '管理后台',
        account: '账户',
        others: '其它登录会话',
      } as Record<string, string>
    )[target] || target
  );
}
export default function Activity({
  kind,
  embedded = false,
}: {
  kind: 'operations' | 'audit' | 'settings';
  embedded?: boolean;
}) {
  const instances = useQuery({
    queryKey: ['instances'],
    queryFn: () => api<Instance[]>('/instances'),
  });
  const q = useQuery({
    queryKey: [kind],
    queryFn: () => api<any>(kind === 'settings' ? '/system' : `/${kind}`),
    refetchInterval: 5000,
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (kind === 'settings') {
    const s = q.data as System;
    return (
      <>
        <PageTitle
          title="平台设置"
          description="当前环境和已实现的运行能力。"
        />
        <Paper withBorder p="xl">
          <Stack>
            <Text fw={600}>本地开发环境</Text>
            <Text size="sm">Go API · React / Mantine · SQLite</Text>
            <Text size="sm">Meilisearch：{s.engineVersion || '未配置'}</Text>
            <Text size="sm">
              通行密钥站点：<Code>{s.origin}</Code>
            </Text>
            <Text size="sm">搜索历史保留：30 天；IP 使用实际连接地址。</Text>
            <Alert color="blue">
              实例以真实本地进程运行。服务器 Docker
              运行时、定时异地备份和升级编排将按设计文档另行实现。
            </Alert>
          </Stack>
        </Paper>
      </>
    );
  }
  const rows = q.data as any[];
  return (
    <>
      {!embedded ? (
        <PageTitle title={kind === 'operations' ? '操作记录' : '审计日志'} />
      ) : null}
      {!rows.length ? (
        <Empty title="暂无记录" />
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={embedded ? 560 : 660}>
            <Table horizontalSpacing="xl" verticalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>操作</Table.Th>
                  <Table.Th>目标</Table.Th>
                  <Table.Th style={{ whiteSpace: 'nowrap' }}>
                    {kind === 'operations' ? '状态' : '操作者'}
                  </Table.Th>
                  <Table.Th>时间</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {auditAction(r.action)}
                      </Text>
                      {r.message ? (
                        <Text c="dimmed" size="xs" maw={400}>
                          {r.message}
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {r.instanceName ||
                          instances.data?.find((i) => i.id === r.target)
                            ?.name ||
                          auditTarget(r.target)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {r.status ? (
                        <Status value={r.status} />
                      ) : (
                        <Text size="sm">{r.actor}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {formatDate(r.createdAt)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </>
  );
}
