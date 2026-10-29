import { Card } from '@robert-stackflow/oneui/Card';
import { SettingRow } from '@robert-stackflow/oneui/SettingRow';
import { Button } from '@robert-stackflow/oneui/Button';
import {
  Code,
  Group,
  Surface as Paper,
  SimpleGrid,
  Stack,
  Text,
  Heading as Title,
} from '@robert-stackflow/oneui/Layout';
import { CopyButton } from '@robert-stackflow/oneui/CopyButton';
import { NumberInput } from '@robert-stackflow/oneui/NumberInput';
import { TagInput as TagsInput } from '@robert-stackflow/oneui/TagInput';
import { FormField } from '@robert-stackflow/oneui/FormField';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
      api<{
        appId: string;
      } | null>(`/instances/${id}/sites/${uid}/application`),
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
      setP(value);
      cache.setQueryData(['policy', id, uid], value);
      notifySuccess('站点访问规则已保存。');
    },
    onError: notifyError,
  });
  return (
    <Stack gap="lg">
      <Title order={3}>站点访问</Title>
      <Card>
        <Stack gap="xl">
          <SettingRow
            title="公开搜索入口"
            description="允许网站通过 OneSearch 搜索当前索引。"
            divider={false}
          >
            <Toggle
              aria-label="启用公开搜索入口"
              checked={p.enabled}
              onChange={(enabled) => setP((v) => ({ ...v, enabled }))}
            />
          </SettingRow>
          <TagsInput
            label="允许的站点"
            placeholder="输入站点后按回车"
            value={p.origins}
            onChange={(origins) => setP((v) => ({ ...v, origins }))}
            hint="填写协议与域名，可包含端口；不支持具体页面路径。"
            maxTagLength={2048}
            caseSensitive
          />
          <SettingRow
            title="必须提供来源"
            description="检查 Origin 或 Referer；关闭后允许无来源的服务器请求。"
            divider={false}
          >
            <Toggle
              aria-label="必须提供来源"
              checked={p.requireOrigin}
              onChange={(requireOrigin) =>
                setP((v) => ({ ...v, requireOrigin }))
              }
            />
          </SettingRow>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <FormField label="每个 IP 的请求频率">
              <NumberInput
                label="每个 IP 的请求频率"
                min={1}
                max={1000}
                value={Number(p.rate)}
                onChange={(rate) => setP((v) => ({ ...v, rate: Number(rate) }))}
                unit="次 / 分钟"
              />
            </FormField>
            <FormField label="每次返回结果上限">
              <NumberInput
                label="每次返回结果上限"
                min={1}
                max={100}
                value={Number(p.maxLimit)}
                onChange={(maxLimit) =>
                  setP((v) => ({ ...v, maxLimit: Number(maxLimit) }))
                }
                unit="条"
              />
            </FormField>
          </SimpleGrid>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              规则只作用于下方公开入口。
            </Text>
            <Button
              loading={save.isPending}
              onClick={() => save.mutate()}
              variant="primary"
            >
              保存规则
            </Button>
          </Group>
        </Stack>
      </Card>
      <Paper withBorder p="lg">
        <Group justify="space-between" mb="sm">
          <Text size="sm" fw={600}>
            网站接入
          </Text>
          <CopyButton value={endpoint}>
            {({ copy, copied }) => (
              <Button onClick={copy} variant="ghost" size="small">
                {<Copy size={14} />}
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
