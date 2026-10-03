import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { Search } from 'lucide-react';
import { api, formatDate, type Instance, type Page } from './api';
import { Empty, ErrorState, Loading } from './components';
interface Entry {
  id: string;
  instanceId: string;
  indexUid: string;
  source: string;
  query: string;
  ip: string;
  status: number;
  durationMs: number;
  resultCount: number;
  createdAt: string;
  [key: string]: unknown;
}
export default function History({
  instanceId,
  indexUID,
}: {
  instanceId?: string;
  indexUID?: string;
}) {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [instance, setInstance] = useState(instanceId || '');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Entry | null>(null);
  const instances = useQuery({
    queryKey: ['instances'],
    queryFn: () => api<Instance[]>('/instances'),
  });
  const q = useQuery({
    queryKey: ['history', query, source, instance, indexUID, offset],
    queryFn: () =>
      api<Page<Entry>>(
        `/history?${new URLSearchParams({ q: query, source, instance, index: indexUID || '', offset: String(offset) })}`,
      ),
    refetchInterval: 5000,
  });
  const names = Object.fromEntries(
    (instances.data || []).map((i) => [i.id, i.name]),
  );
  return (
    <>
      <Group mb="xl">
        <TextInput
          aria-label="搜索关键词筛选"
          placeholder="查找搜索词"
          leftSection={<Search size={16} />}
          value={term}
          onChange={(e) => setTerm(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setQuery(term);
              setOffset(0);
            }
          }}
        />
        {!instanceId ? (
          <Select
            aria-label="实例筛选"
            placeholder="全部实例"
            clearable
            data={(instances.data || []).map((i) => ({
              value: i.id,
              label: i.name,
            }))}
            value={instance || null}
            onChange={(v) => {
              setInstance(v || '');
              setOffset(0);
            }}
          />
        ) : null}
        <Select
          aria-label="请求来源筛选"
          placeholder="全部来源"
          clearable
          data={[
            { value: 'public', label: '网站搜索' },
            { value: 'admin', label: '管理页搜索' },
          ]}
          value={source || null}
          onChange={(v) => {
            setSource(v || '');
            setOffset(0);
          }}
        />
        <Button
          variant="default"
          onClick={() => {
            setQuery(term);
            setOffset(0);
          }}
        >
          筛选
        </Button>
      </Group>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} retry={q.refetch} />
      ) : !q.data.results.length ? (
        <Empty
          title="暂无搜索记录"
          description="通过管理页搜索文档，或启用站点访问入口后，这里会出现真实请求。"
        />
      ) : (
        <>
          <Paper withBorder>
            <Table.ScrollContainer minWidth={850}>
              <Table horizontalSpacing="lg" verticalSpacing="lg">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>关键词 / 索引</Table.Th>
                    <Table.Th>IP / 来源</Table.Th>
                    <Table.Th>状态</Table.Th>
                    <Table.Th>耗时 / 结果</Table.Th>
                    <Table.Th>时间</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {q.data.results.map((e) => (
                    <Table.Tr
                      key={e.id}
                      onClick={() => setSelected(e)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Table.Td>
                        <UnstyledButton
                          className="table-text-action"
                          onClick={() => setSelected(e)}
                        >
                          {e.query || '空关键词'}
                        </UnstyledButton>
                        <Text size="xs" c="dimmed">
                          {names[e.instanceId] || e.instanceId} / {e.indexUid}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{e.ip}</Text>
                        <Text size="xs" c="dimmed">
                          {e.source === 'public' ? '网站搜索' : '管理页搜索'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={e.status >= 400 ? 'red' : 'teal'}
                        >
                          {e.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{e.durationMs} ms</Text>
                        <Text size="xs" c="dimmed">
                          {e.resultCount} 个结果
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{formatDate(e.createdAt)}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
          <Group justify="space-between" mt="md">
            <Text size="xs" c="dimmed">
              共 {q.data.total} 条
            </Text>
            <Pagination
              total={Math.max(1, Math.ceil(q.data.total / 50))}
              value={Math.floor(offset / 50) + 1}
              onChange={(page) => setOffset((page - 1) * 50)}
            />
          </Group>
        </>
      )}
      <Drawer
        opened={!!selected}
        onClose={() => setSelected(null)}
        title="请求详情"
        size="lg"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            不保存 Authorization、Cookie、管理密钥或响应文档正文。IP
            来自实际连接或已配置的可信代理。
          </Text>
          <Code
            block
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {JSON.stringify(selected, null, 2)}
          </Code>
        </Stack>
      </Drawer>
    </>
  );
}
