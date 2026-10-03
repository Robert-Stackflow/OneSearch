import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Code,
  CopyButton,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Title,
} from '@mantine/core';
import { Copy } from 'lucide-react';
import { Toggle } from './Toggle';
import { api, notifyError, notifySuccess } from './api';
import { Loading, ErrorState } from './components';

interface Policy {
  enabled: boolean;
  origins: string[];
  requireOrigin: boolean;
  rate: number;
  maxLimit: number;
}
export default function SitePolicy({ id, uid }: { id: string; uid: string }) {
  const q = useQuery({
    queryKey: ['policy', id, uid],
    queryFn: () => api<Policy>(`/instances/${id}/sites/${uid}`),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return <Editor key={uid} id={id} uid={uid} initial={q.data} />;
}
function Editor({
  id,
  uid,
  initial,
}: {
  id: string;
  uid: string;
  initial: Policy;
}) {
  const cache = useQueryClient();
  const [p, setP] = useState(initial);
  const app = useQuery({
    queryKey: ['application', id, uid],
    queryFn: () =>
      api<{ appId: string } | null>(
        `/instances/${id}/sites/${uid}/application`,
      ),
  });
  const endpoint = app.data
    ? `${window.location.origin}/api/apps/${app.data.appId}/search`
    : `${window.location.origin}/api/search/${id}/${uid}`;
  const save = useMutation({
    mutationFn: () =>
      api<Policy>(`/instances/${id}/sites/${uid}`, {
        method: 'PUT',
        body: JSON.stringify(p),
      }),
    onSuccess: (value) => {
      cache.setQueryData(['policy', id, uid], value);
      notifySuccess('站点访问规则已保存。');
    },
    onError: notifyError,
  });
  return (
    <Stack gap="lg">
      <Title order={3}>站点访问</Title>
      <Paper withBorder>
        <div className="site-setting">
          <div className="site-setting-head">
            <div>
              <Text size="sm" fw={600}>
                公开搜索入口
              </Text>
              <Text size="xs" c="dimmed" mt={6}>
                允许网站通过 OneSearch 搜索当前索引。
              </Text>
            </div>
            <Toggle
              aria-label="启用公开搜索入口"
              checked={p.enabled}
              onChange={(e) => {
                const enabled = e.currentTarget.checked;
                setP((v) => ({ ...v, enabled }));
              }}
            />
          </div>
        </div>
        <div className="site-setting">
          <Text size="sm" fw={600}>
            来源限制
          </Text>
          <div className="site-setting-body">
            <TagsInput
              label="允许的站点"
              description="填写协议与域名，可包含端口。例如 https://blog.example.com"
              placeholder="输入站点后按回车"
              value={p.origins}
              onChange={(origins) => setP((v) => ({ ...v, origins }))}
            />
          </div>
          <div className="site-setting-head" style={{ marginTop: 20 }}>
            <div>
              <Text size="sm">必须提供来源</Text>
              <Text size="xs" c="dimmed" mt={5}>
                检查 Origin 或 Referer；关闭后允许无来源的服务器请求。
              </Text>
            </div>
            <Toggle
              aria-label="必须提供来源"
              checked={p.requireOrigin}
              onChange={(e) => {
                const requireOrigin = e.currentTarget.checked;
                setP((v) => ({ ...v, requireOrigin }));
              }}
            />
          </div>
        </div>
        <div className="site-setting">
          <Text size="sm" fw={600} mb="md">
            请求限制
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <NumberInput
              label="每个 IP 的请求频率"
              suffix=" 次 / 分钟"
              min={1}
              max={1000}
              value={p.rate}
              onChange={(value) => setP((v) => ({ ...v, rate: Number(value) }))}
            />
            <NumberInput
              label="每次返回结果上限"
              suffix=" 条"
              min={1}
              max={100}
              value={p.maxLimit}
              onChange={(value) =>
                setP((v) => ({ ...v, maxLimit: Number(value) }))
              }
            />
          </SimpleGrid>
        </div>
        <div className="save-bar">
          <Text size="xs" c="dimmed">
            规则只作用于下方公开入口。
          </Text>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            保存规则
          </Button>
        </div>
      </Paper>
      <Paper withBorder p="lg">
        <Group justify="space-between" mb="sm">
          <Text size="sm" fw={600}>
            网站接入
          </Text>
          <CopyButton value={endpoint}>
            {({ copy, copied }) => (
              <Button
                size="xs"
                variant="subtle"
                leftSection={<Copy size={14} />}
                onClick={copy}
              >
                {copied ? '已复制' : '复制地址'}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Code block style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
          {endpoint}
        </Code>
        <Text size="xs" c="dimmed" mt="md">
          POST JSON · Authorization: Bearer 搜索密钥
        </Text>
        <Text size="xs" c="dimmed" mt={6}>
          在「访问密钥」创建仅含 search 权限、绑定 {uid}{' '}
          的密钥。引擎端口仅向后端开放，避免绕过访问规则。来源检查需配合密钥权限与限流。
        </Text>
      </Paper>
    </Stack>
  );
}
