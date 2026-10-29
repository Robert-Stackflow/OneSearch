import { Statistic } from '@robert-stackflow/oneui/Statistic';
import { Card } from '@robert-stackflow/oneui/Card';
import { ContributionCalendar } from '@robert-stackflow/oneui/ContributionCalendar';
import { BarChart } from '@robert-stackflow/oneui/BarChart';
import {
  Group,
  Surface as Paper,
  SimpleGrid,
  Stack,
  Text,
  Heading as Title,
  Box,
} from '@robert-stackflow/oneui/Layout';
import { Select } from '@robert-stackflow/oneui/Select';
import { TableMarkup as Table } from '@robert-stackflow/oneui/TableMarkup';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  topQueries: {
    query: string;
    count: number;
  }[];
}
export function Calendar() {
  const q = useQuery({
    queryKey: ['calendar'],
    queryFn: () =>
      api<{
        days: Daily[];
        since: string;
        timezone: string;
      }>('/calendar'),
    refetchInterval: 15000,
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const days = q.data.days;
  if (!days.length) return null;
  const peak = Math.max(1, ...days.map((day) => day.requests));
  return (
    <div className="dashboard-summary">
      <ContributionCalendar
        label="搜索活动"
        unit="次请求"
        color="var(--accent)"
        data={days
          .filter((day) => day.date >= q.data.since)
          .map((day) => ({ date: day.date, count: day.requests }))}
        startDate={days[0].date}
        endDate={days[days.length - 1].date}
        today={days[days.length - 1].date}
        weekStartsOn={0}
        emptyMode="missing"
        thresholds={[peak / 4, peak / 2, (peak * 3) / 4, peak]}
      />
    </div>
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
  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <Title order={3}>统计</Title>
        <Box style={{ width: 130 }}>
          <Select
            onChange={(v) => setPeriod(v || '30')}
            options={[
              { value: '7', label: '近 7 天' },
              { value: '30', label: '近 30 天' },
            ]}
            label="统计周期"
            value={period ?? ''}
          />
        </Box>
      </Group>
      <SimpleGrid cols={{ base: 2, xl: 4 }}>
        {metrics.map((m) => (
          <Card key={m.label}>
            <Statistic title={m.label} value={m.value} animate={false} />
          </Card>
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
        <BarChart
          label={`近 ${period} 天共 ${s.requests} 次搜索请求`}
          data={s.days.map((day) => ({
            label: day.date.slice(5),
            value: day.requests,
            description: `${day.date} · ${day.requests} 次（网站 ${day.public} / 管理页 ${day.admin}）`,
          }))}
        />
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
          <Table>
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
        <Table>
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
