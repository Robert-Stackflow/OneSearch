import { IconButton as ActionIcon } from '@robert-stackflow/oneui/IconButton';
import { Alert } from '@robert-stackflow/oneui/Alert';
import { Badge } from '@robert-stackflow/oneui/Badge';
import { Button } from '@robert-stackflow/oneui/Button';
import {
  Code,
  Group,
  Surface as Paper,
  Stack,
  Text,
  Heading as Title,
} from '@robert-stackflow/oneui/Layout';
import { CopyButton } from '@robert-stackflow/oneui/CopyButton';
import { Dialog as Modal } from '@robert-stackflow/oneui/Dialog';
import { Select } from '@robert-stackflow/oneui/Select';
import { TableMarkup as Table } from '@robert-stackflow/oneui/TableMarkup';
import { Textarea } from '@robert-stackflow/oneui/Textarea';
import { Input as TextInput } from '@robert-stackflow/oneui/Input';
import { FormField } from '@robert-stackflow/oneui/FormField';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus, Settings2, Trash2 } from 'lucide-react';
import {
  api,
  engine,
  formatDate,
  notifyError,
  notifySuccess,
  type APIKey,
  type Page,
} from './api';
import { ErrorState, Loading } from './components';
interface Application {
  appId: string;
  instanceId: string;
  indexUid: string;
  name: string;
  createdAt: string;
}
const readActions = [
  'search',
  'documents.get',
  'indexes.get',
  'settings.get',
  'tasks.get',
  'stats.get',
];
const presets: Record<
  string,
  {
    label: string;
    actions: string[];
  }
> = {
  search: { label: 'Search API Key', actions: ['search'] },
  admin: {
    label: 'Admin API Key',
    actions: [
      ...readActions,
      'documents.add',
      'documents.delete',
      'settings.update',
    ],
  },
  readonly: { label: 'Read-Only Admin API Key', actions: readActions },
  chat: { label: 'Chat API Key', actions: ['search', 'chatCompletions'] },
};
function keyType(key: APIKey) {
  if (key.actions.includes('*')) return '引擎管理密钥';
  if (key.actions.includes('chatCompletions')) return presets.chat.label;
  if (
    key.actions.some(
      (a) =>
        a === 'documents.add' ||
        a === 'documents.delete' ||
        a === 'settings.update',
    )
  )
    return presets.admin.label;
  if (key.actions.some((a) => a !== 'search')) return presets.readonly.label;
  return presets.search.label;
}
export default function AppKeys({
  id,
  indexes,
  indexUID,
}: {
  id: string;
  indexes: string[];
  indexUID?: string;
}) {
  const uid = indexUID || indexes[0] || '';
  const path = `/instances/${id}/sites/${uid}/application`;
  const cache = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('search');
  const [expiry, setExpiry] = useState('30');
  const [created, setCreated] = useState('');
  const [remove, setRemove] = useState<APIKey | null>(null);
  const [chatOpened, setChatOpened] = useState(false);
  const [chatConfig, setChatConfig] = useState(
    '{\n  "source": "openAi",\n  "apiKey": "",\n  "baseUrl": null\n}',
  );
  const app = useQuery({
    queryKey: ['application', id, uid],
    queryFn: () => api<Application | null>(path),
    enabled: !!uid,
  });
  const keys = useQuery({
    queryKey: ['keys', id],
    queryFn: () => engine<Page<APIKey>>(id, 'keys?limit=100'),
    enabled: !!uid,
  });
  const createApp = useMutation({
    mutationFn: () => api<Application>(path, { method: 'POST' }),
    onSuccess: (value) => {
      cache.setQueryData(['application', id, uid], value);
      notifySuccess('应用已创建。');
    },
    onError: notifyError,
  });
  const createKey = useMutation({
    mutationFn: () =>
      engine<APIKey>(id, 'keys', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: `OneSearch ${app.data?.appId} ${type}`,
          actions: presets[type].actions,
          indexes: [uid],
          expiresAt:
            expiry === 'never'
              ? null
              : new Date(Date.now() + Number(expiry) * 86400000).toISOString(),
        }),
      }),
    onSuccess: (value) => {
      setOpened(false);
      setCreated(value.key || '');
      setName('');
      cache.invalidateQueries({ queryKey: ['keys', id] });
    },
    onError: notifyError,
  });
  const revoke = useMutation({
    mutationFn: () => engine(id, `keys/${remove!.uid}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemove(null);
      cache.invalidateQueries({ queryKey: ['keys', id] });
      notifySuccess('App Key 已撤销。');
    },
    onError: notifyError,
  });
  const saveChat = useMutation({
    mutationFn: () => {
      const value = JSON.parse(chatConfig);
      if (!value || Array.isArray(value) || typeof value !== 'object')
        throw new Error('请提供 JSON 配置对象');
      return api(path + '/chat-settings', {
        method: 'PATCH',
        body: JSON.stringify(value),
      });
    },
    onSuccess: () => {
      setChatOpened(false);
      setChatConfig('');
      notifySuccess('模型服务已配置。');
    },
    onError: notifyError,
  });
  const openChat = async () => {
    try {
      const value = await api<Record<string, unknown>>(path + '/chat-settings');
      setChatConfig(JSON.stringify(value, null, 2));
    } catch {
      setChatConfig(
        '{\n  "source": "openAi",\n  "apiKey": "",\n  "baseUrl": null\n}',
      );
    }
    setChatOpened(true);
  };
  if (!uid)
    return (
      <Paper withBorder p="xl">
        <Text c="dimmed">创建索引后即可配置应用和访问密钥。</Text>
      </Paper>
    );
  if (app.isPending || keys.isPending) return <Loading />;
  const error = app.error || keys.error;
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          void app.refetch();
          void keys.refetch();
        }}
      />
    );
  const endpoint = `${window.location.origin}/api/apps/${app.data?.appId || ''}`;
  return (
    <Stack gap="lg">
      <Paper withBorder p="xl">
        <Group justify="space-between" align="flex-start">
          <Stack gap="xs">
            <Title order={3}>应用</Title>
            <Text size="sm" c="dimmed">
              {uid}
            </Text>
            {app.data ? (
              <Group gap="sm">
                <Code>{app.data.appId}</Code>
                <CopyButton value={app.data.appId}>
                  {({ copied, copy }) => (
                    <ActionIcon
                      onClick={copy}
                      variant="ghost"
                      label="复制 App ID"
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </ActionIcon>
                  )}
                </CopyButton>
              </Group>
            ) : (
              <Text size="sm" c="dimmed">
                一个应用对应当前索引。
              </Text>
            )}
          </Stack>
          {app.data ? (
            <Button onClick={() => void openChat()} variant="secondary">
              {<Settings2 size={16} />}
              模型服务
            </Button>
          ) : (
            <Button
              loading={createApp.isPending}
              onClick={() => createApp.mutate()}
              variant="primary"
            >
              创建应用
            </Button>
          )}
        </Group>
        {app.data && (
          <Stack gap="xs" mt="lg">
            <Text size="xs" c="dimmed">
              搜索接口
            </Text>
            <Code block>{endpoint}/search</Code>
            <Text size="xs" c="dimmed">
              对话接口
            </Text>
            <Code block>{endpoint}/chat/completions</Code>
          </Stack>
        )}
      </Paper>
      <Group justify="space-between">
        <Title order={3}>App Key</Title>
        <Button
          disabled={!app.data}
          onClick={() => setOpened(true)}
          variant="primary"
        >
          {<Plus size={16} />}
          创建密钥
        </Button>
      </Group>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={540}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>名称 / 类型</Table.Th>
                <Table.Th>权限</Table.Th>
                <Table.Th>有效期</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.data?.results
                .filter(
                  (key) => key.indexes.length === 1 && key.indexes[0] === uid,
                )
                .map((key) => (
                  <Table.Tr key={key.uid}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {key.name || '未命名密钥'}
                      </Text>
                      <Text size="xs" c="dimmed" mt={5}>
                        {keyType(key)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={5} maw={350}>
                        {key.actions.map((action) => (
                          <Badge key={action}>{action}</Badge>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {key.expiresAt ? formatDate(key.expiresAt) : '永久'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        onClick={() => setRemove(key)}
                        variant="ghost"
                        label={`撤销密钥 ${key.name}`}
                      >
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!keys.data?.results.some(
          (key) => key.indexes.length === 1 && key.indexes[0] === uid,
        ) && (
          <Text size="sm" c="dimmed" p="xl">
            暂无 App Key
          </Text>
        )}
      </Paper>
      <Modal
        onClose={() => setOpened(false)}
        title="创建 App Key"
        open={opened}
      >
        <Stack>
          <TextInput
            label="名称"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="博客搜索"
          />
          <FormField label="类型">
            <Select
              label="类型"
              onChange={(value) => setType(value || 'search')}
              options={Object.entries(presets).map(([value, preset]) => ({
                value,
                label: preset.label,
              }))}
              value={type ?? ''}
            />
          </FormField>
          <Text size="xs" c="dimmed">
            {type === 'admin'
              ? '更新该应用的文档与搜索设置。仅放在服务器或发布流程中。'
              : type === 'readonly'
                ? '读取该应用的文档、设置、任务和统计。仅供服务器使用。'
                : type === 'chat'
                  ? '搜索与对话补全。使用前需配置模型服务。'
                  : '只允许搜索该应用的索引，可用于网站前端。'}
          </Text>
          <FormField label="有效期">
            <Select
              label="有效期"
              onChange={(value) => setExpiry(value || '30')}
              options={[
                { value: '7', label: '7 天' },
                { value: '30', label: '30 天' },
                { value: '90', label: '90 天' },
                { value: 'never', label: '永久' },
              ]}
              value={expiry ?? ''}
            />
          </FormField>
          <Group justify="flex-end" mt="sm">
            <Button onClick={() => setOpened(false)} variant="secondary">
              取消
            </Button>
            <Button
              loading={createKey.isPending}
              disabled={!name.trim()}
              onClick={() => createKey.mutate()}
              variant="primary"
            >
              创建密钥
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        onClose={() => setCreated('')}
        title="保存 App Key"
        open={!!created}
      >
        <Stack>
          <Alert>
            密钥仅在创建时显示，请保存到对应网站或发布流程的配置中。
          </Alert>
          <Text size="xs" c="dimmed">
            App ID
          </Text>
          <Code block>{app.data?.appId}</Code>
          <Text size="xs" c="dimmed">
            App Key
          </Text>
          <Code block style={{ overflowWrap: 'anywhere' }}>
            {created}
          </Code>
          <CopyButton value={created}>
            {({ copied, copy }) => (
              <Button onClick={copy} variant="primary">
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? '已复制' : '复制 App Key'}
              </Button>
            )}
          </CopyButton>
        </Stack>
      </Modal>
      <Modal
        onClose={() => setRemove(null)}
        title="撤销 App Key"
        open={!!remove}
      >
        <Text size="sm">使用此密钥的请求将立即失去访问权限。</Text>
        <Group justify="flex-end" mt="xl">
          <Button onClick={() => setRemove(null)} variant="secondary">
            取消
          </Button>
          <Button
            loading={revoke.isPending}
            onClick={() => revoke.mutate()}
            variant="danger"
          >
            撤销密钥
          </Button>
        </Group>
      </Modal>
      <Modal
        onClose={() => {
          setChatOpened(false);
          setChatConfig('');
        }}
        title="模型服务"
        open={chatOpened}
        size="large"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            配置此应用的 Meilisearch Chat
            工作区。保存时启用引擎对话功能，模型服务密钥不会返回到列表中。
          </Text>
          <Textarea
            label="工作区配置"
            value={chatConfig}
            onChange={(e) => setChatConfig(e.currentTarget.value)}
            rows={10}
            style={{ fontFamily: 'monospace' }}
          />
          <Group justify="flex-end">
            <Button
              onClick={() => {
                setChatOpened(false);
                setChatConfig('');
              }}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              loading={saveChat.isPending}
              onClick={() => saveChat.mutate()}
              variant="primary"
            >
              保存配置
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
