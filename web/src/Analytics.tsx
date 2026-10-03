import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { Activity, Search, ShieldCheck, Timer } from 'lucide-react';
import { api, formatDate, actionLabels, type Operation } from './api';
import { Loading, ErrorState, Empty, Status } from './components';
export interface Daily {
  date: string;
  requests: number;
  successes: number;
  zeroResults: number;
  durationMs: number;
  results: number;
  public: number;
  admin: number;
}
interface Statistics {
  days: Daily[];
  requests: number;
  successes: number;
  errors: number;
  zeroResults: number;
  averageMs: number;
  public: number;
  admin: number;
  uniqueIPs: number;
  topQueries: { query: string; count: number }[];
}
export function Calendar() {
  const q = useQuery({
    queryKey: ['calendar'],
    queryFn: () =>
      api<{ days: Daily[]; since: string; timezone: string }>('/calendar'),
    refetchInterval: 15000,
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const days = q.data.days;
  const firstWeekday = new Date(days[0].date + 'T00:00:00Z').getUTCDay();
  const cells: (Daily | null)[] = [...Array(firstWeekday).fill(null), ...days];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => cells[w * 7 + d] || null),
  );
  const peak = Math.max(1, ...days.map((d) => d.requests));
  const total = days.reduce((n, d) => n + d.requests, 0);
  return (
    <Paper withBorder p="xl" mb={28}>
      <Group justify="space-between" mb="lg">
        <Title order={3}>搜索活动</Title>
        <Text size="sm" c="dimmed">
          过去一年 · {total.toLocaleString()} 次请求
        </Text>
      </Group>
      <div className="calendar-scroll">
        <div className="calendar-labels">
          <span>一</span>
          <span>三</span>
          <span>五</span>
        </div>
        <div className="calendar-weeks">
          {weeks.map((week, w) => (
            <div className="calendar-week" key={w}>
              <span className="calendar-month">
                {week
                  .find((d) => d && (w === 0 || d.date.endsWith('-01')))
                  ?.date.slice(5, 7)
                  .replace(/^0/, '') || ''}
                {week.some((d) => d && (w === 0 || d.date.endsWith('-01')))
                  ? '月'
                  : ''}
              </span>
              {week.map((d, n) => {
                const known = d && d.date >= q.data.since;
                const level =
                  !d || !d.requests
                    ? 0
                    : Math.min(
                        4,
                        Math.max(1, Math.ceil((d.requests / peak) * 4)),
                      );
                return (
                  <Tooltip
                    key={n}
                    label={
                      d
                        ? `${d.date} · ${known ? d.requests + ' 次请求' : '未记录'}（UTC）`
                        : ''
                    }
                    disabled={!d}
                    withArrow
                  >
                    <span
                      className={`calendar-cell level-${level}${!known ? ' unknown' : ''}`}
                      tabIndex={d ? 0 : undefined}
                      aria-label={
                        d
                          ? `${d.date} ${known ? d.requests + ' 次请求' : '未记录'}`
                          : undefined
                      }
                    />
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <Group justify="space-between" mt="md">
        <Text size="xs" c="dimmed">
          {q.data.since} 起记录
        </Text>
        <Group gap={5}>
          <Text size="xs" c="dimmed" mr={4}>
            少
          </Text>
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className={`calendar-cell level-${n}`} />
          ))}
          <Text size="xs" c="dimmed" ml={4}>
            多
          </Text>
        </Group>
      </Group>
    </Paper>
  );
}
export function InstanceStats({ id }: { id: string }) {
  const [period, setPeriod] = useState('30');
  const q = useQuery({
    queryKey: ['analytics', id, period],
    queryFn: () => api<Statistics>(`/instances/${id}/analytics?days=${period}`),
    refetchInterval: 10000,
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const s = q.data;
  const rate = s.requests
    ? ((s.successes / s.requests) * 100).toFixed(1) + '%'
    : '—';
  const metrics = [
    { label: '搜索请求', value: s.requests.toLocaleString(), icon: Search },
    { label: '成功率', value: rate, icon: ShieldCheck },
    {
      label: '平均耗时',
      value: s.requests ? s.averageMs.toFixed(1) + ' ms' : '—',
      icon: Timer,
    },
    { label: '访问 IP', value: s.uniqueIPs, icon: Activity },
  ];
  const peak = Math.max(1, ...s.days.map((d) => d.requests));
  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <Title order={3}>统计</Title>
        <Select
          aria-label="统计周期"
          data={[
            { value: '7', label: '近 7 天' },
            { value: '30', label: '近 30 天' },
          ]}
          value={period}
          onChange={(v) => setPeriod(v || '30')}
          w={130}
        />
      </Group>
      <SimpleGrid cols={{ base: 2, xl: 4 }}>
        {metrics.map((m) => (
          <Paper key={m.label} withBorder p="lg">
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {m.label}
              </Text>
              <m.icon size={17} color="var(--os-accent)" />
            </Group>
            <Text fz={26} fw={650} mt={12}>
              {m.value}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      <Paper withBorder p="xl">
        <Group justify="space-between" mb="xl">
          <Title order={4}>每日请求</Title>
          <Group gap={14}>
            <Text size="xs" c="dimmed">
              网站 {s.public}
            </Text>
            <Text size="xs" c="dimmed">
              管理页 {s.admin}
            </Text>
          </Group>
        </Group>
        <div
          className="request-bars"
          role="img"
          aria-label={`近 ${period} 天共 ${s.requests} 次搜索请求`}
        >
          {s.days.map((d) => (
            <Tooltip
              key={d.date}
              label={`${d.date} · ${d.requests} 次（网站 ${d.public} / 管理页 ${d.admin}）`}
              withArrow
            >
              <div className="request-bar-column">
                <div
                  className="request-bar"
                  style={{ height: `${(d.requests / peak) * 132}px` }}
                />
                <span>{d.date.slice(5)}</span>
              </div>
            </Tooltip>
          ))}
        </div>
        <Group mt="xl" gap="xl">
          <Text size="xs" c="dimmed">
            失败请求 {s.errors}
          </Text>
          <Text size="xs" c="dimmed">
            无结果查询 {s.zeroResults}
          </Text>
          <Text size="xs" c="dimmed">
            UTC 日期
          </Text>
        </Group>
      </Paper>
      <Paper withBorder p="xl">
        <Title order={4} mb="lg">
          热门搜索词
        </Title>
        {s.topQueries.length ? (
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>关键词</Table.Th>
                <Table.Th ta="right">次数</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {s.topQueries.map((x) => (
                <Table.Tr key={x.query}>
                  <Table.Td>{x.query}</Table.Td>
                  <Table.Td ta="right">{x.count}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm" c="dimmed">
            暂无搜索记录
          </Text>
        )}
      </Paper>
    </Stack>
  );
}
export function InstanceOperations({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['instance-operations', id],
    queryFn: () => api<Operation[]>(`/instances/${id}/operations`),
    refetchInterval: 5000,
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return !q.data.length ? (
    <Empty title="暂无操作记录" />
  ) : (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={580}>
        <Table horizontalSpacing="xl" verticalSpacing="lg">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>操作</Table.Th>
              <Table.Th>状态</Table.Th>
              <Table.Th>提交时间</Table.Th>
              <Table.Th>完成时间</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {q.data.map((o) => (
              <Table.Tr key={o.id}>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {actionLabels[o.action] || o.action}
                  </Text>
                  {o.message ? (
                    <Text size="xs" c="dimmed" maw={340}>
                      {o.message}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td>
                  <Status value={o.status} />
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{formatDate(o.createdAt)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {o.finishedAt ? formatDate(o.finishedAt) : '—'}
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
