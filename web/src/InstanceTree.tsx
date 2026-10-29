import { useQueries, useQuery } from '@tanstack/react-query';
import { Button } from '@robert-stackflow/oneui/Button';
import type { NavigationItem } from '@robert-stackflow/oneui/AppShell';
import { Boxes, Database, Plus, Server } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api, engine, type Index, type Instance, type Page } from './api';

export function useInstanceNavigation(
  expandedIds: readonly string[],
  onCreate: () => void,
) {
  const location = useLocation();
  const query = useQuery({
    queryKey: ['instances'],
    queryFn: () => api<Instance[]>('/instances'),
    refetchInterval: 4000,
  });
  const instances = (query.data || []).filter((i) => i.status !== 'archived');
  const indexes = useQueries({
    queries: instances.map((i) => ({
      queryKey: ['indexes', i.id],
      queryFn: () => engine<Page<Index>>(i.id, 'indexes?limit=100'),
      enabled:
        expandedIds.includes('instances') &&
        expandedIds.includes(i.id) &&
        i.status === 'running',
      staleTime: 10000,
    })),
  });
  const selected = new URLSearchParams(location.search).get('index');
  const current = location.pathname.match(/^\/instances\/([^/]+)/)?.[1];
  const navigation: NavigationItem = {
    id: 'instances',
    path: '/instances',
    label: '搜索实例',
    icon: <Boxes size={18} />,
    expandable: true,
    content: query.isPending ? (
      <p className="navigation-note" role="status">
        加载中
      </p>
    ) : query.error ? (
      <Button size="small" variant="ghost" onClick={() => void query.refetch()}>
        重试加载实例
      </Button>
    ) : !instances.length ? (
      <Button size="small" variant="ghost" onClick={onCreate}>
        <Plus size={14} />
        创建实例
      </Button>
    ) : undefined,
    children: instances.map((i, position) => {
      const q = indexes[position];
      return {
        id: i.id,
        path: `/instances/${i.id}?view=overview`,
        label: i.name,
        icon: <Server size={16} />,
        expandable: true,
        content:
          i.status !== 'running' ? (
            <p className="navigation-note">
              {i.status === 'stopped' ? '已停止' : '未运行'}
            </p>
          ) : q.isPending ? (
            <p className="navigation-note" role="status">
              加载索引
            </p>
          ) : q.error ? (
            <Button
              size="small"
              variant="ghost"
              onClick={() => void q.refetch()}
            >
              重试加载索引
            </Button>
          ) : undefined,
        children:
          i.status !== 'running' || q.isPending || q.error
            ? []
            : q.data.results.length
              ? q.data.results.map((x) => ({
                  id: `${i.id}:${x.uid}`,
                  path: `/instances/${i.id}?view=documents&index=${encodeURIComponent(x.uid)}`,
                  label: x.uid,
                  icon: <Database size={14} />,
                }))
              : [
                  {
                    id: `${i.id}:create`,
                    path: `/instances/${i.id}?view=indexes&action=create-index`,
                    label: '创建索引',
                    icon: <Plus size={14} />,
                  },
                ],
      };
    }),
  };
  return {
    navigation,
    active: current
      ? selected
        ? `${current}:${selected}`
        : current
      : 'instances',
  };
}
