import { SearchField } from '@robert-stackflow/oneui/SearchField';
import { Badge } from '@robert-stackflow/oneui/Badge';
import {
  Button,
  Button as UnstyledButton,
} from '@robert-stackflow/oneui/Button';
import {
  Code,
  Box,
  Group,
  Surface as Paper,
  Stack,
  Text,
} from '@robert-stackflow/oneui/Layout';
import { Drawer } from '@robert-stackflow/oneui/Drawer';
import { Pagination } from '@robert-stackflow/oneui/Pagination';
import { Select } from '@robert-stackflow/oneui/Select';
import { TableMarkup as Table } from '@robert-stackflow/oneui/TableMarkup';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
        <Box style={{ flex: '1 1 200px', minWidth: 0 }}>
          <SearchField
            label="搜索关键词筛选"
            placeholder="查找搜索词"
            value={term}
            onChange={setTerm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setQuery(term);
                setOffset(0);
              }
            }}
          />
        </Box>
        {!instanceId ? (
          <Select
            placeholder="全部实例"
            onChange={(v) => {
              setInstance(v || '');
              setOffset(0);
            }}
            options={[
              { value: '', label: '全部实例' },
              ...(instances.data || []).map((i) => ({
                value: i.id,
                label: i.name,
              })),
            ]}
            label="实例筛选"
            value={(instance || null) ?? ''}
          />
        ) : null}
        <Select
          placeholder="全部来源"
          onChange={(v) => {
            setSource(v || '');
            setOffset(0);
          }}
          options={[
            { value: '', label: '全部来源' },
            { value: 'public', label: '网站搜索' },
            { value: 'admin', label: '管理页搜索' },
          ]}
          label="请求来源筛选"
          value={(source || null) ?? ''}
        />
        <Button
          onClick={() => {
            setQuery(term);
            setOffset(0);
          }}
          variant="secondary"
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
            <Table.ScrollContainer minWidth={640}>
              <Table>
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
                          onClick={() => setSelected(e)}
                          variant="link"
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
                        <Badge tone={e.status >= 400 ? 'danger' : 'success'}>
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
              page={Math.floor(offset / 50) + 1}
              onPageChange={(page) => setOffset((page - 1) * 50)}
              pageSize={1}
              showSummary={false}
              compact={true}
            />
          </Group>
        </>
      )}
      <Drawer
        onClose={() => setSelected(null)}
        title="请求详情"
        size="lg"
        open={!!selected}
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
