import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  CopyButton,
  FileInput,
  Group,
  Modal,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { Copy, Plus, Search, Trash2 } from 'lucide-react';
import {
  engine,
  notifyError,
  notifySuccess,
  waitTask,
  type Page,
  type TaskRef,
} from './api';
import { Empty, ErrorState, Loading } from './components';

type Document = Record<string, unknown>;
interface SearchResponse {
  hits: Document[];
  totalHits: number;
  totalPages: number;
  page: number;
  hitsPerPage: number;
  processingTimeMs: number;
  query: string;
}
const START = '__ONESEARCH_MATCH_START__';
const END = '__ONESEARCH_MATCH_END__';
const text = (value: unknown): string =>
  value == null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

// Treat document content as text, never as HTML. Only our two delimiters create marks.
function Highlight({ value }: { value: unknown }) {
  const parts: ReactNode[] = [];
  let rest = text(value),
    n = 0;
  while (rest.includes(START)) {
    const start = rest.indexOf(START),
      end = rest.indexOf(END, start + START.length);
    if (end < 0) break;
    parts.push(
      rest.slice(0, start),
      <mark className="search-highlight" key={n++}>
        {rest.slice(start + START.length, end)}
      </mark>,
    );
    rest = rest.slice(end + END.length);
  }
  parts.push(rest);
  return <>{parts}</>;
}
function snippets(document: Document) {
  const formatted = document._formatted as Document | undefined;
  const matches = Object.entries(formatted || {}).filter(
    ([field, value]) =>
      !['id', 'title', 'name', 'url'].includes(field) &&
      text(value).includes(START),
  );
  return matches.length
    ? matches
        .filter(
          ([field]) =>
            field !== 'excerpt' ||
            !matches.some(([name]) => name === 'content'),
        )
        .slice(0, 1)
    : [
        [
          '',
          formatted?.excerpt ??
            formatted?.content ??
            document.excerpt ??
            document.content ??
            '',
        ],
      ];
}

export default function Documents({
  id,
  uid,
  primaryKey = 'id',
}: {
  id: string;
  uid: string;
  primaryKey?: string;
}) {
  const cache = useQueryClient();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState('20');
  const [opened, setOpened] = useState(false);
  const [json, setJSON] = useState('');
  const [remove, setRemove] = useState<string | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const perPage = Number(size);
  const docs = useQuery({
    queryKey: ['documents', id, uid, page, perPage],
    enabled: query === null,
    queryFn: () =>
      engine<Page<Document>>(
        id,
        `indexes/${uid}/documents?limit=${perPage}&offset=${(page - 1) * perPage}`,
      ),
  });
  const search = useQuery({
    queryKey: ['document-search', id, uid, query, page, perPage],
    enabled: query !== null,
    queryFn: () =>
      engine<SearchResponse>(id, `indexes/${uid}/search`, {
        method: 'POST',
        body: JSON.stringify({
          q: query,
          page,
          hitsPerPage: perPage,
          attributesToHighlight: ['*'],
          attributesToCrop: ['content', 'excerpt', 'description'],
          cropLength: 40,
          highlightPreTag: START,
          highlightPostTag: END,
          showMatchesPosition: true,
          showRankingScore: true,
        }),
      }),
  });
  const active = query === null ? docs : search;
  const list =
    query === null ? docs.data?.results || [] : search.data?.hits || [];
  const total =
    query === null ? docs.data?.total || 0 : search.data?.totalHits || 0;
  const pages =
    query === null ? Math.ceil(total / perPage) : search.data?.totalPages || 0;
  useEffect(() => {
    if (active.data && page > Math.max(1, pages)) setPage(Math.max(1, pages));
  }, [active.data, page, pages]);
  async function refresh() {
    setPage(1);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['documents', id, uid] }),
      cache.invalidateQueries({ queryKey: ['document-search', id, uid] }),
      cache.invalidateQueries({ queryKey: ['stats', id] }),
    ]);
  }
  const importer = useMutation({
    mutationFn: async () => {
      let value: unknown;
      try {
        value = JSON.parse(json);
      } catch {
        value = json
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
      }
      if (
        !Array.isArray(value) ||
        !value.every((v) => v && typeof v === 'object' && !Array.isArray(v))
      )
        throw new Error('请提供 JSON 对象数组，或每行一个对象的 NDJSON。');
      const task = await engine<TaskRef>(id, `indexes/${uid}/documents`, {
        method: 'POST',
        body: JSON.stringify(value),
      });
      await waitTask(id, task);
    },
    onSuccess: async () => {
      setOpened(false);
      setJSON('');
      await refresh();
      notifySuccess('文档已写入索引。');
    },
    onError: notifyError,
  });
  const deletion = useMutation({
    mutationFn: async () => {
      const task = await engine<TaskRef>(
        id,
        `indexes/${uid}/documents/${encodeURIComponent(remove!)}`,
        { method: 'DELETE' },
      );
      await waitTask(id, task);
    },
    onSuccess: async () => {
      setRemove(null);
      await refresh();
      notifySuccess('文档已删除。');
    },
    onError: notifyError,
  });
  return (
    <>
      <Group justify="space-between" mb="lg" className="document-toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            if (query === input.trim() && page === 1) void search.refetch();
            else setQuery(input.trim());
          }}
        >
          <Group gap="sm">
            <TextInput
              aria-label="搜索文档"
              placeholder="输入搜索词"
              leftSection={<Search size={16} />}
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
            />
            <Button type="submit" loading={query !== null && search.isFetching}>
              搜索
            </Button>
            {query !== null ? (
              <Button
                variant="subtle"
                onClick={() => {
                  setQuery(null);
                  setInput('');
                  setPage(1);
                }}
              >
                查看全部
              </Button>
            ) : null}
          </Group>
        </form>
        <Button
          leftSection={<Plus size={16} />}
          onClick={() => setOpened(true)}
        >
          导入 / 更新文档
        </Button>
      </Group>
      <Group justify="space-between" mb="md">
        <Text size="xs" c="dimmed">
          {active.data
            ? `${query === null ? '共' : '匹配'} ${total} 篇文档${query !== null ? ` · ${search.data?.processingTimeMs} ms` : ''}`
            : '加载中…'}
        </Text>
        {query !== null && search.data ? (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setDetail(search.data)}
          >
            查看搜索响应
          </Button>
        ) : null}
      </Group>
      {active.isPending ? (
        <Loading />
      ) : active.error ? (
        <ErrorState error={active.error} retry={active.refetch} />
      ) : (
        <Paper withBorder>
          {!list.length ? (
            <Empty
              title={query === null ? '暂无文档' : '没有匹配结果'}
              description={
                query === null
                  ? '导入 JSON 或 NDJSON 文档。'
                  : '尝试其它关键词，或调整搜索规则。'
              }
            />
          ) : (
            <Table.ScrollContainer minWidth={580}>
              <Table verticalSpacing="lg" horizontalSpacing="lg">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>文档</Table.Th>
                    <Table.Th w="25%">地址 / 主键</Table.Th>
                    <Table.Th w={44} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {list.map((d, n) => {
                    const formatted = d._formatted as Document | undefined;
                    const fields = Object.keys(
                      (d._matchesPosition as Document) || {},
                    );
                    return (
                      <Table.Tr key={text(d[primaryKey]) || n}>
                        <Table.Td>
                          <UnstyledButton
                            className="table-text-action"
                            onClick={() => setDetail(d)}
                          >
                            <Highlight
                              value={
                                formatted?.title ??
                                formatted?.name ??
                                d.title ??
                                d.name ??
                                d[primaryKey] ??
                                `文档 ${(page - 1) * perPage + n + 1}`
                              }
                            />
                          </UnstyledButton>
                          {snippets(d).map(([, value], k) =>
                            value ? (
                              <Text
                                key={k}
                                size="xs"
                                c="dimmed"
                                mt={5}
                                lineClamp={3}
                                className="document-summary"
                              >
                                <Highlight value={value} />
                              </Text>
                            ) : null,
                          )}
                          {query !== null && fields.length ? (
                            <Group gap={4} mt={8}>
                              {fields.map((field) => (
                                <Badge
                                  key={field}
                                  title={field}
                                  size="xs"
                                  variant="light"
                                  style={{ textTransform: 'none' }}
                                >
                                  {(
                                    {
                                      title: '标题',
                                      name: '名称',
                                      content: '正文',
                                      excerpt: '摘要',
                                      description: '描述',
                                    } as Record<string, string>
                                  )[field] || field}
                                </Badge>
                              ))}
                            </Group>
                          ) : null}
                        </Table.Td>
                        <Table.Td>
                          <Text
                            size="xs"
                            c="dimmed"
                            lineClamp={2}
                            style={{ overflowWrap: 'anywhere' }}
                          >
                            {text(d.url ?? d[primaryKey])}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {d[primaryKey] != null ? (
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              aria-label={`删除文档 ${text(d.title ?? d[primaryKey])}`}
                              onClick={() => setRemove(text(d[primaryKey]))}
                            >
                              <Trash2 size={16} />
                            </ActionIcon>
                          ) : null}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <Group justify="space-between" className="document-footer">
            <Group gap="xs">
              <Select
                aria-label="每页文档数量"
                value={size}
                onChange={(value) => {
                  setSize(value || '20');
                  setPage(1);
                }}
                data={['5', '10', '20', '50', '100'].map((value) => ({
                  value,
                  label: `${value} / 页`,
                }))}
                w={110}
                size="xs"
              />
              <Text size="xs" c="dimmed">
                {total
                  ? `${(page - 1) * perPage + 1}–${Math.min(page * perPage, total)} / ${total}`
                  : '0 条'}
              </Text>
            </Group>
            <Pagination
              total={Math.max(1, pages)}
              value={page}
              onChange={setPage}
              size="sm"
              siblings={1}
              getControlProps={(control) => ({
                'aria-label': {
                  next: '下一页',
                  previous: '上一页',
                  first: '第一页',
                  last: '最后一页',
                }[control],
              })}
            />
          </Group>
        </Paper>
      )}
      <Modal
        opened={detail !== null}
        onClose={() => setDetail(null)}
        title={
          Array.isArray((detail as SearchResponse)?.hits)
            ? '搜索响应'
            : '文档与命中信息'
        }
        size="xl"
        centered
      >
        <Stack>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {query !== null
                ? '_formatted：高亮摘要 · _matchesPosition：UTF-8 字节位置'
                : `主键字段：${primaryKey}`}
            </Text>
            <CopyButton value={JSON.stringify(detail, null, 2)}>
              {({ copy, copied }) => (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<Copy size={14} />}
                  onClick={copy}
                >
                  {copied ? '已复制' : '复制 JSON'}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Code block className="result-json">
            {JSON.stringify(detail, null, 2)}
          </Code>
        </Stack>
      </Modal>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="导入或更新文档"
        size="xl"
        centered
      >
        <Stack gap="lg">
          <Text size="sm" c="dimmed">
            相同主键会更新已有文档。
          </Text>
          <FileInput
            label="选择 JSON / NDJSON 文件"
            accept=".json,.jsonl,.ndjson"
            onChange={async (file) => {
              if (!file) return;
              if (file.size > 16 * 1024 * 1024) {
                notifyError(new Error('文件超过 16 MiB'));
                return;
              }
              setJSON(await file.text());
            }}
          />
          <Textarea
            label="文档内容"
            value={json}
            onChange={(e) => setJSON(e.currentTarget.value)}
            minRows={12}
            styles={{ input: { fontFamily: 'monospace' } }}
          />
          <Group justify="flex-end" className="form-actions">
            <Button variant="default" onClick={() => setOpened(false)}>
              取消
            </Button>
            <Button
              loading={importer.isPending}
              onClick={() => importer.mutate()}
              disabled={!json.trim()}
            >
              写入索引
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={remove !== null}
        onClose={() => setRemove(null)}
        title="删除文档"
        centered
      >
        <Text size="sm">将从索引删除这篇文档，源网站文件不会改变。</Text>
        <Group justify="flex-end" className="form-actions">
          <Button variant="default" onClick={() => setRemove(null)}>
            取消
          </Button>
          <Button
            color="red"
            loading={deletion.isPending}
            onClick={() => deletion.mutate()}
          >
            删除文档
          </Button>
        </Group>
      </Modal>
    </>
  );
}
