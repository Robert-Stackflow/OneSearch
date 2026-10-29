import { SearchField } from '@robert-stackflow/oneui/SearchField';
import { ResourceCard } from '@robert-stackflow/oneui/ResourceCard';
import { useLinkClickHandler } from 'react-router-dom';
import { Statistic } from '@robert-stackflow/oneui/Statistic';
import { Card } from '@robert-stackflow/oneui/Card';
import { Alert } from '@robert-stackflow/oneui/Alert';
import { Button } from '@robert-stackflow/oneui/Button';
import {
  Group,
  SimpleGrid,
  Stack,
  Text,
  Heading as Title,
  Box,
} from '@robert-stackflow/oneui/Layout';
import { Dialog as Modal } from '@robert-stackflow/oneui/Dialog';
import { NumberInput } from '@robert-stackflow/oneui/NumberInput';
import { Segmented as SegmentedControl } from '@robert-stackflow/oneui/Segmented';
import { Input as TextInput } from '@robert-stackflow/oneui/Input';
import { Textarea } from '@robert-stackflow/oneui/Textarea';
import { FormField } from '@robert-stackflow/oneui/FormField';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Server, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  notifyError,
  notifySuccess,
  type Instance,
  type System,
} from './api';
import { Calendar } from './Analytics';
import { Empty, ErrorState, Loading, PageTitle, Status } from './components';
export function CreateInstance({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const sys = useQuery({
    queryKey: ['system'],
    queryFn: () => api<System>('/system'),
    staleTime: 60000,
  });
  const production = sys.data?.mode === 'production';
  const [provider, setProvider] = useState('native');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [host, setHost] = useState('http://127.0.0.1:7700');
  const [key, setKey] = useState('');
  const [memory, setMemory] = useState<string | number>(512);
  const [threads, setThreads] = useState<string | number>(2);
  const cache = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () =>
      api<{
        instance: Instance;
      }>('/instances', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          provider,
          host: provider === 'external' ? host : '',
          apiKey: provider === 'external' ? key : '',
          memoryMB: Number(memory),
          threads: Number(threads),
        }),
      }),
    onSuccess: (r) => {
      cache.invalidateQueries({ queryKey: ['instances'] });
      onClose();
      setName('');
      setDescription('');
      setKey('');
      notifySuccess(
        provider === 'native'
          ? '实例已创建，正在启动搜索服务。'
          : '实例已连接。',
      );
      navigate(`/instances/${r.instance.id}`);
    },
    onError: notifyError,
  });
  return (
    <Modal onClose={onClose} title="添加搜索实例" open={opened} size="large">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Stack gap="lg">
          <SegmentedControl
            value={provider}
            onChange={setProvider}
            label="实例添加方式"
            options={[
              { value: 'native', label: '创建实例' },
              ...(!production
                ? [{ value: 'external', label: '接入已有实例' }]
                : []),
            ]}
          />
          <TextInput
            label="实例名称"
            placeholder="例如：站点搜索"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={60}
          />
          <Textarea
            label="描述"
            placeholder="可选"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            maxLength={300}
            rows={3}
          />
          {provider === 'native' ? (
            <>
              <SimpleGrid cols={2}>
                <FormField label="索引内存预算">
                  <NumberInput
                    label="索引内存预算"
                    min={128}
                    max={8192}
                    step={128}
                    onChange={setMemory}
                    value={Number(memory)}
                    unit=" MiB"
                  />
                </FormField>
                <FormField label="索引线程">
                  <NumberInput
                    label="索引线程"
                    min={1}
                    max={16}
                    onChange={setThreads}
                    value={Number(threads)}
                  />
                </FormField>
              </SimpleGrid>
              <Text size="xs" c="dimmed">
                {production
                  ? '内存预算只用于索引过程。'
                  : '端口自动分配；内存预算只用于索引过程。'}
              </Text>
            </>
          ) : (
            <>
              <TextInput
                label="服务地址"
                required
                value={host}
                onChange={(e) => setHost(e.currentTarget.value)}
              />
              <TextInput
                label="管理 API 密钥"
                type="password"
                autoComplete="off"
                required
                value={key}
                onChange={(e) => setKey(e.currentTarget.value)}
              />
              <Text size="xs" c="dimmed">
                dev 阶段仅接入本机地址。凭据加密保存于 Go 后端，前端不保存。
              </Text>
            </>
          )}
          <Group justify="flex-end" className="form-actions">
            <Button onClick={onClose} variant="secondary">
              取消
            </Button>
            <Button
              type="submit"
              loading={mutation.isPending}
              variant="primary"
            >
              {provider === 'native' ? '创建实例' : '连接实例'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
function InstanceCard({ instance: i }: { instance: Instance }) {
  const href = `/instances/${i.id}`;
  const navigate = useLinkClickHandler(href);
  return (
    <ResourceCard
      href={href}
      onClick={navigate}
      title={i.name}
      icon={<Server />}
      status={<Status value={i.status} />}
      subtitle={
        i.provider === 'docker'
          ? '托管实例'
          : i.provider === 'external'
            ? '外部实例'
            : '本地实例'
      }
      description={i.description || undefined}
      metadata={[
        i.version ? `v${i.version}` : '准备中',
        i.provider === 'external'
          ? i.host
          : `${i.memoryMB} MiB · ${i.threads} 线程`,
      ]}
    />
  );
}
export default function Instances({
  dashboard = false,
}: {
  dashboard?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('running');
  const query = useQuery({
    queryKey: ['instances'],
    queryFn: () => api<Instance[]>('/instances'),
    refetchInterval: 4000,
  });
  const sys = useQuery({
    queryKey: ['system'],
    queryFn: () => api<System>('/system'),
    staleTime: 60000,
  });
  const all = query.data || [];
  const live = all.filter((i) => i.status !== 'archived');
  const filtered = (dashboard ? live : all).filter((i) => {
    const matchesState =
      dashboard ||
      filter === 'all' ||
      i.status === filter ||
      (filter === 'starting' && i.status === 'provisioning');
    return (
      matchesState &&
      (i.name + i.description).toLowerCase().includes(search.toLowerCase())
    );
  });
  const metrics = [
    { label: '搜索实例', value: live.length },
    {
      label: '正在运行',
      value: live.filter((i) => i.status === 'running').length,
    },
    {
      label: '已停止',
      value: live.filter((i) => i.status === 'stopped').length,
    },
    {
      label: '运行环境',
      value: sys.data?.runtime === 'docker' ? 'Docker' : 'Native',
    },
  ];
  return (
    <>
      <PageTitle title={dashboard ? '工作台' : '搜索实例'}>
        <Button onClick={() => setOpened(true)} variant="primary">
          {<Plus size={17} />}
          添加实例
        </Button>
      </PageTitle>
      {dashboard ? (
        <>
          <div className="dashboard-summary">
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              {metrics.map((metric) => (
                <Card key={metric.label}>
                  <Statistic
                    title={metric.label}
                    value={metric.value}
                    loading={query.isPending}
                    animate={false}
                  />
                </Card>
              ))}
            </SimpleGrid>
          </div>
          <Calendar />
          <Group justify="space-between" mb={18}>
            <Title order={3}>搜索实例</Title>
            <Button variant="ghost" href="/instances">
              查看全部
              {<ArrowUpRight size={16} />}
            </Button>
          </Group>
        </>
      ) : (
        <Group className="instance-filter" justify="space-between" mb={22}>
          <Box style={{ width: 300 }}>
            <SearchField
              label="搜索实例"
              placeholder="搜索名称或描述"
              value={search}
              onChange={setSearch}
            />
          </Box>
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            label="实例状态"
            options={[
              { value: 'all', label: '全部' },
              { value: 'running', label: '运行中' },
              { value: 'starting', label: '启动中' },
              { value: 'stopped', label: '已停止' },
              { value: 'archived', label: '已归档' },
            ]}
          />
        </Group>
      )}
      {sys.data && !sys.data.runtimeAvailable ? (
        <Box style={{ marginBottom: 20 }}>
          <Alert title="搜索运行时尚未就绪" tone={'warning'}>
            {sys.data.mode === 'production'
              ? '请检查 Docker 服务和搜索引擎镜像。'
              : '请设置 MEILISEARCH_BINARY 后重启后端；也可先接入已有实例。'}
          </Alert>
        </Box>
      ) : null}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : filtered.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
          {filtered.map((i) => (
            <InstanceCard key={i.id} instance={i} />
          ))}
        </SimpleGrid>
      ) : (
        <Empty
          title={
            search || (!dashboard && filter !== 'all')
              ? '没有符合条件的实例'
              : '还没有搜索实例'
          }
        >
          {!dashboard && (search || filter !== 'all') ? (
            <Button
              onClick={() => {
                setSearch('');
                setFilter('all');
              }}
              variant="secondary"
            >
              查看全部
            </Button>
          ) : (
            <Button onClick={() => setOpened(true)} variant="primary">
              {<Plus size={17} />}
              添加实例
            </Button>
          )}
        </Empty>
      )}
      <CreateInstance opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}
