import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Button, Collapse, NavLink, Text } from '@mantine/core';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Database,
  Plus,
  Server,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api, engine, type Index, type Instance, type Page } from './api';
const CreateInstance = lazy(() =>
  import('./Instances').then((module) => ({ default: module.CreateInstance })),
);
export default function InstanceTree({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(true);
  const [createOpened, setCreateOpened] = useState(false);
  const q = useQuery({
    queryKey: ['instances'],
    queryFn: () => api<Instance[]>('/instances'),
    refetchInterval: 4000,
  });
  const instances = (q.data || []).filter((i) => i.status !== 'archived');
  return (
    <>
      <NavLink
        component={Link}
        to="/instances"
        label="搜索实例"
        leftSection={<Boxes size={19} strokeWidth={1.7} />}
        active={location.pathname === '/instances'}
        className="studio-nav"
        onClick={onNavigate}
        rightSection={
          <ActionIcon
            variant="subtle"
            color="gray"
            size={23}
            aria-label={expanded ? '收起实例列表' : '展开实例列表'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </ActionIcon>
        }
      />
      <Collapse in={expanded}>
        <div className="instance-tree">
          {q.isPending ? (
            <Text size="xs" c="dimmed" p="sm">
              加载中
            </Text>
          ) : q.error ? (
            <Text size="xs" c="red" p="sm">
              实例读取失败
            </Text>
          ) : instances.length ? (
            instances.map((i) => (
              <TreeInstance key={i.id} instance={i} onNavigate={onNavigate} />
            ))
          ) : (
            <Button
              fullWidth
              variant="subtle"
              size="sm"
              leftSection={<Plus size={15} />}
              onClick={() => setCreateOpened(true)}
            >
              创建实例
            </Button>
          )}
        </div>
      </Collapse>
      {createOpened ? (
        <Suspense fallback={null}>
          <CreateInstance
            opened={createOpened}
            onClose={() => setCreateOpened(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
function TreeInstance({
  instance: i,
  onNavigate,
}: {
  instance: Instance;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const active = location.pathname === `/instances/${i.id}`;
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? active;
  const selected = new URLSearchParams(location.search).get('index');
  const indexes = useQuery({
    queryKey: ['indexes', i.id],
    queryFn: () => engine<Page<Index>>(i.id, 'indexes?limit=100'),
    enabled: expanded && i.status === 'running',
    staleTime: 10000,
  });
  return (
    <>
      <NavLink
        component={Link}
        to={`/instances/${i.id}?view=overview`}
        label={i.name}
        leftSection={<Server size={15} />}
        className="studio-nav tree-instance"
        active={active && !selected}
        onClick={onNavigate}
        rightSection={
          <ActionIcon
            variant="subtle"
            color="gray"
            size={22}
            aria-label={`${expanded ? '收起' : '展开'} ${i.name} 的索引`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setManual(!expanded);
            }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </ActionIcon>
        }
      />
      <Collapse in={expanded}>
        {i.status !== 'running' ? (
          <Text size="xs" c="dimmed" className="tree-note">
            {i.status === 'stopped' ? '已停止' : '未运行'}
          </Text>
        ) : indexes.isPending ? (
          <Text size="xs" c="dimmed" className="tree-note">
            加载索引
          </Text>
        ) : indexes.error ? (
          <Text size="xs" c="red" className="tree-note">
            索引读取失败
          </Text>
        ) : indexes.data?.results.length ? (
          indexes.data.results.map((x) => (
            <NavLink
              key={x.uid}
              component={Link}
              to={`/instances/${i.id}?view=documents&index=${encodeURIComponent(x.uid)}`}
              label={x.uid}
              title={x.uid}
              leftSection={<Database size={13} />}
              className="studio-nav tree-index"
              active={active && selected === x.uid}
              onClick={onNavigate}
            />
          ))
        ) : (
          <NavLink
            component={Link}
            to={`/instances/${i.id}?view=indexes&action=create-index`}
            label="创建索引"
            leftSection={<Plus size={13} />}
            className="studio-nav tree-index tree-create"
            onClick={onNavigate}
          />
        )}
      </Collapse>
    </>
  );
}
