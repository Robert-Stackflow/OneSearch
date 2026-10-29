import { Descriptions } from '@robert-stackflow/oneui/Descriptions';
import { SettingsLayout } from '@robert-stackflow/oneui/SettingsLayout';
import { Alert } from '@robert-stackflow/oneui/Alert';
import {
  Button,
  Button as UnstyledButton,
} from '@robert-stackflow/oneui/Button';
import {
  Code,
  Group,
  Surface as Paper,
  Stack,
  Text,
  Heading as Title,
  Box,
} from '@robert-stackflow/oneui/Layout';
import { Menu } from '@robert-stackflow/oneui/Menu';
import { Dialog as Modal } from '@robert-stackflow/oneui/Dialog';
import { Combobox } from '@robert-stackflow/oneui/Combobox';
import { TableMarkup as Table } from '@robert-stackflow/oneui/TableMarkup';
import { Input as TextInput } from '@robert-stackflow/oneui/Input';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Search,
  Archive,
  ArrowLeft,
  Database,
  FileJson,
  KeyRound,
  ListChecks,
  MoreHorizontal,
  Play,
  Plus,
  RotateCw,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import {
  api,
  engine,
  formatDate,
  notifyError,
  notifySuccess,
  waitTask,
  type Index,
  type Instance,
  type Page,
  type TaskRef,
} from './api';
import { Empty, ErrorState, Loading, PageTitle, Status } from './components';
import { Settings, Tasks, Logs } from './InstanceDetail';
import Keys from './AppKeys';
import Documents from './Documents';
import SitePolicy from './SitePolicy';
import History from './History';
import { InstanceStats, InstanceOperations } from './Analytics';
const sections = [
  { value: 'overview', label: '统计', icon: BarChart3 },
  { value: 'indexes', label: '索引', icon: Database },
  { value: 'documents', label: '文档与搜索', icon: FileJson, index: true },
  { value: 'settings', label: '搜索设置', icon: Settings2, index: true },
  { value: 'tasks', label: '索引任务', icon: ListChecks },
  { value: 'sites', label: '站点访问', icon: ShieldCheck, index: true },
  { value: 'keys', label: '访问密钥', icon: KeyRound },
  { value: 'history', label: '搜索历史', icon: Search },
  { value: 'operations', label: '操作记录', icon: Activity },
  { value: 'logs', label: '运行日志', icon: Terminal },
];
export default function InstancePage() {
  const { id = '' } = useParams();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const section = sections.some((x) => x.value === params.get('view'))
    ? params.get('view')!
    : 'overview';
  const selected = params.get('index');
  function setSection(view: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('view', view);
      return next;
    });
  }
  function selectIndex(index: string, view: string) {
    const next = new URLSearchParams(params);
    next.set('index', index);
    next.set('view', view);
    setParams(next);
  }
  function setSelected(index: string | null) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (index) next.set('index', index);
      else next.delete('index');
      return next;
    });
  }
  const [action, setAction] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [uid, setUID] = useState('');
  const [primaryKey, setPrimaryKey] = useState('id');
  const instance = useQuery({
    queryKey: ['instance', id],
    queryFn: () => api<Instance>(`/instances/${id}`),
    refetchInterval: 3000,
  });
  const i = instance.data;
  useEffect(() => {
    if (params.get('action') === 'create-index' && i?.status === 'running') {
      setCreateOpen(true);
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete('action');
          return next;
        },
        { replace: true },
      );
    }
  }, [params, setParams, i?.status]);
  const indexes = useQuery({
    queryKey: ['indexes', id],
    queryFn: () => engine<Page<Index>>(id, 'indexes?limit=100'),
    enabled: i?.status === 'running',
    refetchInterval: 5000,
  });
  const stats = useQuery({
    queryKey: ['stats', id],
    queryFn: () =>
      engine<{
        databaseSize: number;
        indexes: Record<
          string,
          {
            numberOfDocuments: number;
          }
        >;
      }>(id, 'stats'),
    enabled: i?.status === 'running',
    refetchInterval: 5000,
  });
  const list = indexes.data?.results || [];
  const index =
    list.find((x) => x.uid === selected)?.uid || list[0]?.uid || null;
  const actionMutation = useMutation({
    mutationFn: () =>
      api(`/instances/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => {
      setAction('');
      cache.invalidateQueries({ queryKey: ['instance', id] });
      cache.invalidateQueries({ queryKey: ['instances'] });
      notifySuccess('操作已提交。');
    },
    onError: notifyError,
  });
  const create = useMutation({
    mutationFn: async () => {
      const ref = await engine<TaskRef>(id, 'indexes', {
        method: 'POST',
        body: JSON.stringify({ uid, primaryKey: primaryKey || undefined }),
      });
      await waitTask(id, ref);
    },
    onSuccess: () => {
      setSelected(uid);
      setCreateOpen(false);
      setUID('');
      cache.invalidateQueries({ queryKey: ['indexes', id] });
      notifySuccess('索引已创建。');
    },
    onError: notifyError,
  });
  if (instance.isPending) return <Loading />;
  if (instance.error)
    return <ErrorState error={instance.error} retry={instance.refetch} />;
  if (!i) return null;
  const count = stats.data
    ? Object.values(stats.data.indexes).reduce(
        (n, v) => n + v.numberOfDocuments,
        0,
      )
    : null;
  const indexed = sections.find((x) => x.value === section)?.index;
  return (
    <>
      <Box style={{ marginBottom: 20 }}>
        <Button variant="ghost" size="small" href="/instances">
          {<ArrowLeft size={14} />}
          搜索实例
        </Button>
      </Box>
      <PageTitle
        title={i.name}
        description={i.description || undefined}
        titleExtra={
          <Box style={{ width: 240 }}>
            <Combobox
              placeholder="选择索引"
              onChange={setSelected}
              disabled={!list.length || i.status !== 'running'}
              options={list.map((x) => ({ value: x.uid, label: x.uid }))}
              label="当前索引"
              value={index ?? ''}
            />
          </Box>
        }
      >
        <Group>
          <Status value={i.status} />
          {i.canControl && i.status !== 'archived' ? (
            i.status === 'running' ? (
              <Button onClick={() => setAction('stop')} variant="secondary">
                {<Square size={14} />}
                停止
              </Button>
            ) : (
              <Button
                disabled={['provisioning', 'starting', 'stopping'].includes(
                  i.status,
                )}
                onClick={() => setAction('start')}
                variant="primary"
              >
                {<Play size={15} />}
                启动
              </Button>
            )
          ) : null}
          <Menu
            label="实例操作"
            trigger={<MoreHorizontal size={19} />}
            items={[
              ...(i.canControl && i.status === 'running'
                ? [
                    {
                      label: '重启实例',
                      icon: <RotateCw size={15} />,
                      action: () => setAction('restart'),
                    },
                  ]
                : []),
              {
                label: '查看操作记录',
                icon: <ListChecks size={15} />,
                action: () => setSection('operations'),
              },
              ...(i.status !== 'archived' &&
              (i.provider === 'external' || i.canControl)
                ? [
                    {
                      label: '归档实例',
                      icon: <Archive size={15} />,
                      danger: true,
                      action: () => setAction('archive'),
                    },
                  ]
                : []),
            ]}
          />
        </Group>
      </PageTitle>
      <Paper p="lg" mb="xl">
        <Descriptions
          columns={4}
          layout="vertical"
          label="实例信息"
          items={[
            {
              key: 'address',
              label: '服务地址',
              children: (
                <Text size="xs" truncate title={i.host}>
                  {i.host}
                </Text>
              ),
            },
            { key: 'version', label: '引擎版本', children: i.version || '—' },
            {
              key: 'documents',
              label: '索引 / 文档',
              children: `${indexes.data?.total ?? '—'} / ${count ?? '—'}`,
            },
            {
              key: 'size',
              label: '数据库大小',
              children: stats.data
                ? `${(stats.data.databaseSize / 1048576).toFixed(1)} MiB`
                : '—',
            },
          ]}
        />
      </Paper>
      {i.error ? (
        <Box style={{ marginBottom: 20 }}>
          <Alert tone={'danger'}>{i.error}</Alert>
        </Box>
      ) : null}
      <SettingsLayout
        value={section}
        onChange={setSection}
        groups={[
          { id: 'overview', label: '概览', values: ['overview'] },
          {
            id: 'content',
            label: '内容与搜索',
            values: ['indexes', 'documents', 'settings', 'tasks'],
          },
          { id: 'access', label: '接入与权限', values: ['sites', 'keys'] },
          {
            id: 'activity',
            label: '运行记录',
            values: ['history', 'operations', 'logs'],
          },
        ].map(({ id, label, values }) => ({
          id,
          label,
          items: sections
            .filter((item) => values.includes(item.value))
            .map(({ value, label, icon: Icon }) => ({
              value,
              label,
              icon: <Icon size={17} />,
            })),
        }))}
      >
        <div className="instance-content">
          {!['logs', 'overview', 'operations', 'history'].includes(section) &&
          i.status !== 'running' ? (
            <Empty
              title={i.status === 'archived' ? '实例已归档' : '实例未运行'}
            >
              {i.canControl && i.status === 'stopped' ? (
                <Button onClick={() => setAction('start')} variant="primary">
                  启动实例
                </Button>
              ) : null}
            </Empty>
          ) : indexed && !index ? (
            <Empty title="暂无索引">
              <Button
                onClick={() => {
                  setSection('indexes');
                  setCreateOpen(true);
                }}
                variant="primary"
              >
                创建索引
              </Button>
            </Empty>
          ) : (
            <>
              {section === 'overview' ? <InstanceStats id={id} /> : null}
              {section === 'operations' ? <InstanceOperations id={id} /> : null}
              {section === 'history' ? (
                <History
                  key={id}
                  instanceId={id}
                  indexUID={index || undefined}
                />
              ) : null}
              {section === 'indexes' ? (
                <>
                  <Group justify="space-between" mb="lg">
                    <Title order={3}>索引</Title>
                    <Button
                      onClick={() => setCreateOpen(true)}
                      variant="primary"
                    >
                      {<Plus size={16} />}
                      创建索引
                    </Button>
                  </Group>
                  {indexes.isPending ? (
                    <Loading />
                  ) : indexes.error ? (
                    <ErrorState error={indexes.error} retry={indexes.refetch} />
                  ) : !list.length ? (
                    <Empty title="暂无索引" />
                  ) : (
                    <Paper withBorder>
                      <Table.ScrollContainer minWidth={570}>
                        <Table>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>索引</Table.Th>
                              <Table.Th>文档</Table.Th>
                              <Table.Th>主键</Table.Th>
                              <Table.Th>更新时间</Table.Th>
                              <Table.Th />
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {list.map((x) => (
                              <Table.Tr key={x.uid}>
                                <Table.Td>
                                  <UnstyledButton
                                    onClick={() =>
                                      selectIndex(x.uid, 'documents')
                                    }
                                    variant="link"
                                  >
                                    {x.uid}
                                  </UnstyledButton>
                                </Table.Td>
                                <Table.Td>
                                  {stats.data?.indexes[x.uid]
                                    ?.numberOfDocuments ?? '—'}
                                </Table.Td>
                                <Table.Td>
                                  <Code>{x.primaryKey || '自动'}</Code>
                                </Table.Td>
                                <Table.Td>
                                  <Text size="xs" c="dimmed">
                                    {formatDate(x.updatedAt)}
                                  </Text>
                                </Table.Td>
                                <Table.Td>
                                  <Group gap={4} wrap="nowrap">
                                    <Button
                                      onClick={() => {
                                        selectIndex(x.uid, 'documents');
                                      }}
                                      variant="ghost"
                                      size="small"
                                    >
                                      文档
                                    </Button>
                                    <Button
                                      onClick={() => {
                                        selectIndex(x.uid, 'settings');
                                      }}
                                      variant="ghost"
                                      size="small"
                                    >
                                      设置
                                    </Button>
                                  </Group>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </Table.ScrollContainer>
                    </Paper>
                  )}
                </>
              ) : null}
              {section === 'documents' && index ? (
                <Documents
                  key={index}
                  id={id}
                  uid={index}
                  primaryKey={
                    list.find((x) => x.uid === index)?.primaryKey || 'id'
                  }
                />
              ) : null}
              {section === 'settings' && index ? (
                <Settings
                  key={index}
                  id={id}
                  uid={index}
                  onDeleted={() => {
                    setParams((previous) => {
                      const next = new URLSearchParams(previous);
                      next.delete('index');
                      next.set('view', 'indexes');
                      return next;
                    });
                    cache.invalidateQueries({ queryKey: ['indexes', id] });
                  }}
                />
              ) : null}
              {section === 'sites' && index ? (
                <SitePolicy key={index} id={id} uid={index} />
              ) : null}
              {section === 'tasks' ? (
                <Tasks id={id} indexUID={index || undefined} />
              ) : null}
              {section === 'keys' ? (
                <Keys
                  key={`${id}:${index}`}
                  id={id}
                  indexes={list.map((x) => x.uid)}
                  indexUID={index || undefined}
                />
              ) : null}
              {section === 'logs' ? <Logs id={id} /> : null}
            </>
          )}
        </div>
      </SettingsLayout>
      <Modal
        onClose={() => setAction('')}
        title={
          {
            stop: '停止实例',
            start: '启动实例',
            restart: '重启实例',
            archive: '归档实例',
          }[action] || '实例操作'
        }
        open={!!action}
      >
        <Stack gap="lg">
          <Text size="sm">
            {action === 'archive'
              ? '归档后保留数据，外部服务不会被停止。'
              : action === 'stop'
                ? '停止后该实例暂停提供搜索，数据保留。'
                : action === 'restart'
                  ? '重启期间搜索会短暂中断。'
                  : '启动此实例。'}
          </Text>
          <Group justify="flex-end" className="form-actions">
            <Button onClick={() => setAction('')} variant="secondary">
              取消
            </Button>
            <Button
              loading={actionMutation.isPending}
              onClick={() => actionMutation.mutate()}
              variant="primary"
            >
              确认
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        onClose={() => setCreateOpen(false)}
        title="创建索引"
        open={createOpen}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Stack gap="lg">
            <TextInput
              label="索引 UID"
              placeholder="blog_articles"
              value={uid}
              onChange={(e) => setUID(e.currentTarget.value)}
              required
              pattern="[A-Za-z0-9_-]+"
              hint="英文字母、数字、短横线或下划线"
            />
            <TextInput
              label="文档主键"
              value={primaryKey}
              onChange={(e) => setPrimaryKey(e.currentTarget.value)}
            />
            <Group justify="flex-end" className="form-actions">
              <Button onClick={() => setCreateOpen(false)} variant="secondary">
                取消
              </Button>
              <Button
                type="submit"
                loading={create.isPending}
                variant="primary"
              >
                创建索引
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
