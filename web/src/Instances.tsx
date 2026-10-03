import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  ArrowRight,
  Boxes,
  Check,
  CirclePause,
  Cpu,
  HardDrive,
  Plus,
  Search,
  Server,
  ArrowUpRight,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
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
      api<{ instance: Instance }>('/instances', {
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
    <Modal
      opened={opened}
      onClose={onClose}
      title="添加搜索实例"
      size="lg"
      centered
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Stack gap="lg">
          <SegmentedControl
            aria-label="实例添加方式"
            fullWidth
            value={provider}
            onChange={setProvider}
            data={[
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
            minRows={3}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            maxLength={300}
          />
          {provider === 'native' ? (
            <>
              <SimpleGrid cols={2}>
                <NumberInput
                  label="索引内存预算"
                  suffix=" MiB"
                  min={128}
                  max={8192}
                  step={128}
                  value={memory}
                  onChange={setMemory}
                />
                <NumberInput
                  label="索引线程"
                  min={1}
                  max={16}
                  value={threads}
                  onChange={setThreads}
                />
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
            <Button variant="default" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {provider === 'native' ? '创建实例' : '连接实例'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
function InstanceCard({ instance: i }: { instance: Instance }) {
  return (
    <Paper
      component={Link}
      to={`/instances/${i.id}`}
      withBorder
      p="xl"
      className="instance-card"
    >
      <Group justify="space-between" align="flex-start">
        <ThemeIcon variant="light" size={45} radius={13}>
          <Server size={22} strokeWidth={1.6} />
        </ThemeIcon>
        <Status value={i.status} />
      </Group>
      <Title order={4} mt={20}>
        {i.name}
      </Title>
      <Text size="sm" c="dimmed" mt={7} mih={42} lineClamp={2}>
        {i.description}
      </Text>
      <div className="instance-meta">
        <Group gap={7}>
          <HardDrive size={14} />
          <Text size="xs">
            {i.provider !== 'external'
              ? `${i.memoryMB} MiB 索引预算`
              : '已接入服务'}
          </Text>
        </Group>
        <Group gap={7}>
          <Cpu size={14} />
          <Text size="xs">{i.version ? `v${i.version}` : '正在准备'}</Text>
        </Group>
      </div>
      <Group justify="space-between" pt="md" mt="md" className="card-bottom">
        <Text size="xs" c="dimmed">
          {i.provider === 'docker' ? '内部服务' : `127.0.0.1:${i.port}`}
        </Text>
        <Group gap={6}>
          <Text size="xs" fw={600}>
            管理实例
          </Text>
          <ArrowRight size={15} />
        </Group>
      </Group>
    </Paper>
  );
}
export default function Instances({
  dashboard = false,
}: {
  dashboard?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
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
  const filtered = (
    filter === 'archived' ? all.filter((i) => i.status === 'archived') : live
  ).filter((i) =>
    (i.name + i.description).toLowerCase().includes(search.toLowerCase()),
  );
  const metrics = [
    { label: '搜索实例', value: live.length, icon: Boxes },
    {
      label: '正在运行',
      value: live.filter((i) => i.status === 'running').length,
      icon: Check,
    },
    {
      label: '已停止',
      value: live.filter((i) => i.status === 'stopped').length,
      icon: CirclePause,
    },
    {
      label: '运行环境',
      value: sys.data?.runtime === 'docker' ? 'Docker' : 'Native',
      icon: Cpu,
    },
  ];
  return (
    <>
      <PageTitle title={dashboard ? '工作台' : '搜索实例'}>
        <Button
          leftSection={<Plus size={17} />}
          onClick={() => setOpened(true)}
        >
          添加实例
        </Button>
      </PageTitle>
      {dashboard ? (
        <>
          <SimpleGrid cols={{ base: 2, lg: 4 }} mb={28}>
            {metrics.map((m) => (
              <Paper withBorder p="xl" key={m.label}>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    {m.label}
                  </Text>
                  <m.icon
                    size={20}
                    strokeWidth={1.5}
                    color="var(--os-accent)"
                  />
                </Group>
                <Text fz={32} fw={650} mt={10}>
                  {query.isPending ? '—' : m.value}
                </Text>
              </Paper>
            ))}
          </SimpleGrid>
          <Calendar />
          <Group justify="space-between" mb={18}>
            <Title order={3}>搜索实例</Title>
            <Button
              component={Link}
              to="/instances"
              variant="subtle"
              rightSection={<ArrowUpRight size={16} />}
            >
              查看全部
            </Button>
          </Group>
        </>
      ) : (
        <Group justify="space-between" mb={22}>
          <TextInput
            placeholder="搜索名称或描述"
            leftSection={<Search size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={300}
          />
          <SegmentedControl
            aria-label="实例状态"
            value={filter}
            onChange={setFilter}
            data={[
              { value: 'active', label: '使用中' },
              { value: 'archived', label: '已归档' },
            ]}
          />
        </Group>
      )}
      {sys.data && !sys.data.runtimeAvailable ? (
        <Alert color="orange" mb="lg" title="搜索运行时尚未就绪">
          {sys.data.mode === 'production'
            ? '请检查 Docker 服务和搜索引擎镜像。'
            : '请设置 MEILISEARCH_BINARY 后重启后端；也可先接入已有实例。'}
        </Alert>
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
        <Empty title={search ? '没有匹配的实例' : '还没有搜索实例'}>
          <Button
            onClick={() => setOpened(true)}
            leftSection={<Plus size={17} />}
          >
            添加实例
          </Button>
        </Empty>
      )}
      <CreateInstance opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}
