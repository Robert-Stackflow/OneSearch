import { Toggle as Switch } from './Toggle';
import { useState, useRef, useLayoutEffect } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Code,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Table,
  TagsInput,
  Text,
  Textarea,
  Title,
} from '@mantine/core';

import {
  api,
  engine,
  formatDate,
  notifyError,
  notifySuccess,
  waitTask,
  type Page,
  type Task,
  type TaskRef,
} from './api';
import { ErrorState, Loading, Status } from './components';

export function Settings({
  id,
  uid,
  onDeleted,
}: {
  id: string;
  uid: string;
  onDeleted: () => void;
}) {
  const q = useQuery({
    queryKey: ['index-settings', id, uid],
    queryFn: () =>
      engine<Record<string, unknown>>(id, `indexes/${uid}/settings`),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <SettingsForm
      key={JSON.stringify(q.data)}
      id={id}
      uid={uid}
      initial={q.data!}
      onDeleted={onDeleted}
    />
  );
}
function SettingsForm({
  id,
  uid,
  initial,
  onDeleted,
}: {
  id: string;
  uid: string;
  initial: Record<string, unknown>;
  onDeleted: () => void;
}) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [advanced, setAdvanced] = useState(false);
  const [searchable, setSearchable] = useState(
    (initial.searchableAttributes || ['*']) as string[],
  );
  const [displayed, setDisplayed] = useState(
    (initial.displayedAttributes || ['*']) as string[],
  );
  const [filterable, setFilterable] = useState(
    ((initial.filterableAttributes || []) as unknown[]).filter(
      (v: unknown) => typeof v === 'string',
    ) as string[],
  );
  const [sortable, setSortable] = useState(
    (initial.sortableAttributes || []) as string[],
  );
  const [stopWords, setStopWords] = useState(
    (initial.stopWords || []) as string[],
  );
  const [synonyms, setSynonyms] = useState(
    JSON.stringify(initial.synonyms || {}, null, 2),
  );
  const [typo, setTypo] = useState(
    (initial.typoTolerance as { enabled: boolean })?.enabled ?? true,
  );
  const [remove, setRemove] = useState(false);
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      const data = advanced
        ? JSON.parse(text)
        : {
            searchableAttributes: searchable,
            displayedAttributes: displayed,
            filterableAttributes: filterable,
            sortableAttributes: sortable,
            stopWords,
            synonyms: JSON.parse(synonyms),
            typoTolerance: {
              ...(initial.typoTolerance as object),
              enabled: typo,
            },
          };
      const t = await engine<TaskRef>(id, `indexes/${uid}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      await waitTask(id, t);
    },
    onSuccess: () => {
      cache.invalidateQueries({ queryKey: ['index-settings', id, uid] });
      notifySuccess('搜索设置已生效。');
    },
    onError: notifyError,
  });
  const del = useMutation({
    mutationFn: async () => {
      const t = await engine<TaskRef>(id, `indexes/${uid}`, {
        method: 'DELETE',
      });
      await waitTask(id, t);
    },
    onSuccess: () => {
      setRemove(false);
      onDeleted();
      notifySuccess('索引已删除。');
    },
    onError: notifyError,
  });
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={3}>搜索规则</Title>
          <Text size="sm" c="dimmed" mt={5}>
            当前索引：{uid}
          </Text>
        </div>
        <Switch
          label="高级 JSON 编辑"
          checked={advanced}
          onChange={(e) => setAdvanced(e.currentTarget.checked)}
        />
      </Group>
      <Paper withBorder>
        {advanced ? (
          <div className="settings-body">
            <Textarea
              label="完整索引配置"
              minRows={22}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              styles={{ input: { fontFamily: 'monospace' } }}
            />
          </div>
        ) : (
          <>
            <div className="setting-row">
              <div>
                <Text fw={600} size="sm">
                  可搜索字段
                </Text>
                <Text size="xs" c="dimmed" mt={6}>
                  字段排列顺序影响相关性，通常将标题排在正文前。
                </Text>
              </div>
              <TagsInput
                aria-label="可搜索字段"
                value={searchable}
                onChange={setSearchable}
                placeholder="title, content"
                splitChars={[',']}
              />
            </div>
            <div className="setting-row">
              <div>
                <Text fw={600} size="sm">
                  返回字段
                </Text>
                <Text size="xs" c="dimmed" mt={6}>
                  网站搜索结果允许显示哪些字段。
                </Text>
              </div>
              <TagsInput
                aria-label="返回字段"
                value={displayed}
                onChange={setDisplayed}
                splitChars={[',']}
              />
            </div>
            <div className="setting-row">
              <div>
                <Text fw={600} size="sm">
                  过滤与排序
                </Text>
                <Text size="xs" c="dimmed" mt={6}>
                  为分类、标签或日期等字段启用筛选与排序。
                </Text>
              </div>
              <Stack gap="sm">
                <TagsInput
                  label="可过滤字段"
                  value={filterable}
                  onChange={setFilterable}
                  splitChars={[',']}
                />
                <TagsInput
                  label="可排序字段"
                  value={sortable}
                  onChange={setSortable}
                  splitChars={[',']}
                />
              </Stack>
            </div>
            <div className="setting-row">
              <div>
                <Text fw={600} size="sm">
                  拼写容错
                </Text>
                <Text size="xs" c="dimmed" mt={6}>
                  在输入存在拼写错误时，仍返回相关内容。
                </Text>
              </div>
              <Switch
                label="启用拼写容错"
                checked={typo}
                onChange={(e) => setTypo(e.currentTarget.checked)}
              />
            </div>
            <div className="setting-row">
              <div>
                <Text fw={600} size="sm">
                  停用词
                </Text>
                <Text size="xs" c="dimmed" mt={6}>
                  忽略不影响搜索意义的词。
                </Text>
              </div>
              <TagsInput
                aria-label="停用词"
                value={stopWords}
                onChange={setStopWords}
                splitChars={[',']}
              />
            </div>
            <div className="setting-row">
              <div>
                <Text fw={600} size="sm">
                  同义词
                </Text>
                <Text size="xs" c="dimmed" mt={6}>
                  JSON 对象，例如：{`{"LLM":["大语言模型"]}`}。
                </Text>
              </div>
              <Textarea
                aria-label="同义词"
                value={synonyms}
                onChange={(e) => setSynonyms(e.currentTarget.value)}
                minRows={4}
                styles={{ input: { fontFamily: 'monospace' } }}
              />
            </div>
          </>
        )}
        <div className="save-bar">
          <Text c="dimmed" size="xs">
            设置保存后会产生一个索引任务。
          </Text>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            保存搜索设置
          </Button>
        </div>
      </Paper>
      <Paper withBorder p="xl">
        <Group justify="space-between">
          <div>
            <Text fw={600} size="sm">
              删除索引
            </Text>
            <Text size="xs" c="dimmed" mt={6}>
              移除该索引及文档。请先保存备份或确保有可重新导入的源数据。
            </Text>
          </div>
          <Button color="red" variant="light" onClick={() => setRemove(true)}>
            删除索引
          </Button>
        </Group>
      </Paper>
      <Modal
        opened={remove}
        onClose={() => setRemove(false)}
        title={`删除 ${uid}`}
        centered
      >
        <Text size="sm">
          该索引的文档和搜索设置都会被删除，此操作无法直接撤销。
        </Text>
        <Group justify="flex-end" mt="xl">
          <Button variant="default" onClick={() => setRemove(false)}>
            取消
          </Button>
          <Button
            color="red"
            loading={del.isPending}
            onClick={() => del.mutate()}
          >
            确认删除索引
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
export function Tasks({ id, indexUID }: { id: string; indexUID?: string }) {
  const q = useQuery({
    queryKey: ['tasks', id, indexUID],
    queryFn: () =>
      engine<Page<Task>>(
        id,
        'tasks?limit=100' +
          (indexUID ? '&indexUids=' + encodeURIComponent(indexUID) : ''),
      ),
    refetchInterval: 3000,
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={600}>
        <Table horizontalSpacing="xl" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>任务</Table.Th>
              <Table.Th>索引 / 类型</Table.Th>
              <Table.Th>状态</Table.Th>
              <Table.Th>提交时间</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {q.data.results.map((t) => (
              <Table.Tr key={t.uid}>
                <Table.Td>
                  <Code>#{t.uid}</Code>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{t.indexUid || '实例任务'}</Text>
                  <Text size="xs" c="dimmed">
                    {t.type}
                  </Text>
                  {t.error ? (
                    <Text size="xs" c="red" maw={400}>
                      {t.error.message}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td>
                  <Status value={t.status} />
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {formatDate(t.enqueuedAt)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}
export function Logs({ id }: { id: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const q = useQuery({
    queryKey: ['logs', id],
    queryFn: () => api<{ text: string }>(`/instances/${id}/logs`),
    refetchInterval: 5000,
  });
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [q.data?.text]);
  return (
    <Paper withBorder p="xl">
      <Group justify="space-between" mb="lg">
        <Title order={3}>引擎运行日志</Title>
        <Button size="xs" variant="default" onClick={() => void q.refetch()}>
          刷新
        </Button>
      </Group>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} retry={q.refetch} />
      ) : (
        <ScrollArea
          h={480}
          viewportRef={viewport}
          onScrollPositionChange={() => {
            const element = viewport.current;
            if (element)
              follow.current =
                element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop <
                32;
          }}
        >
          <pre className="log-output">{q.data.text}</pre>
        </ScrollArea>
      )}
    </Paper>
  );
}
