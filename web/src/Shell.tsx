import {
  ActionIcon,
  Avatar,
  Drawer,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  ArrowUpRight,
  Archive,
  Grid2X2,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  ChevronsUpDown,
  UserRound,
  Sun,
} from 'lucide-react';
import {
  Link,
  NavLink as RouterLink,
  Outlet,
  useNavigate,
} from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import InstanceTree from './InstanceTree';
import { api, notifyError, type System, type AccountInfo } from './api';
const items = [
  { label: '工作台', path: '/', icon: Grid2X2 },
  { label: '备份', path: '/backups', icon: Archive },
  { label: '账户设置', path: '/account', icon: UserRound },
];
function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<AccountInfo>('/auth/me'),
  });
  const username = me.data?.username || 'admin';
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      cache.clear();
      navigate('/login');
    } catch (e) {
      notifyError(e);
    }
  }
  return (
    <div className="sidebar-inner">
      <Link to="/" className="brand" onClick={onNavigate}>
        <img src="/mark.svg" width={36} height={36} alt="" />
        <span>OneSearch</span>
      </Link>
      <ScrollArea className="sidebar-navigation">
        <Stack gap={5}>
          {items.slice(0, 1).map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              component={RouterLink}
              to={path}
              end={path === '/'}
              label={label}
              leftSection={<Icon size={19} strokeWidth={1.7} />}
              className="studio-nav"
              onClick={onNavigate}
            />
          ))}
          <InstanceTree onNavigate={onNavigate} />
          {items.slice(1).map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              component={RouterLink}
              to={path}
              label={label}
              leftSection={<Icon size={19} strokeWidth={1.7} />}
              className="studio-nav"
              onClick={onNavigate}
            />
          ))}
        </Stack>
      </ScrollArea>
      <div className="sidebar-bottom">
        <a
          className="docs-link"
          href="https://www.meilisearch.com/docs"
          target="_blank"
          rel="noreferrer"
        >
          <span>Meilisearch 文档</span>
          <ArrowUpRight size={15} />
        </a>
        <SegmentedControl
          className="theme-switch"
          aria-label="外观主题"
          fullWidth
          value={colorScheme}
          onChange={(value) =>
            setColorScheme(value as 'light' | 'dark' | 'auto')
          }
          data={[
            {
              value: 'light',
              label: (
                <span className="theme-option">
                  <Sun size={14} />
                  浅色
                </span>
              ),
            },
            {
              value: 'dark',
              label: (
                <span className="theme-option">
                  <Moon size={14} />
                  深色
                </span>
              ),
            },
            {
              value: 'auto',
              label: (
                <span className="theme-option">
                  <Monitor size={14} />
                  系统
                </span>
              ),
            },
          ]}
        />
        <Menu position="top-start" width={212} offset={10}>
          <Menu.Target>
            <UnstyledButton className="account-switch" aria-label="账户菜单">
              <Avatar
                src={me.data?.avatarUrl || undefined}
                size={34}
                radius={11}
                color="victoria"
              >
                {(me.data?.name || username).slice(0, 1).toUpperCase()}
              </Avatar>
              <span className="account-label">
                <Text fw={600} size="sm" truncate>
                  {me.data?.name || username}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  @{username}
                </Text>
              </span>
              <ChevronsUpDown size={16} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>账户</Menu.Label>
            <Menu.Item
              component={Link}
              to="/account"
              leftSection={<UserRound size={16} />}
              onClick={onNavigate}
            >
              账户设置
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<LogOut size={16} />}
              onClick={() => void logout()}
            >
              退出登录
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
    </div>
  );
}
export default function Shell() {
  const system = useQuery({
    queryKey: ['system'],
    queryFn: () => api<System>('/system'),
    staleTime: 60000,
  });
  const [opened, { open, close }] = useDisclosure();
  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <Sidebar onNavigate={close} />
      </aside>
      <ActionIcon
        className="mobile-toggle"
        variant="default"
        size={40}
        aria-label="打开导航"
        onClick={open}
      >
        <PanelLeft size={20} />
      </ActionIcon>
      <Drawer
        opened={opened}
        onClose={close}
        size={270}
        title="OneSearch"
        padding={0}
      >
        <div style={{ height: 'calc(100dvh - 64px)' }}>
          <Sidebar onNavigate={close} />
        </div>
      </Drawer>
      <main className="studio-main">
        <header className="topbar">
          <Text size="xs" c="dimmed">
            WORKSPACE / 搜索管理
          </Text>
          <Group gap={7}>
            <span className="connection-dot" />
            <Text size="xs" c="dimmed">
              {system.data?.mode === 'production'
                ? '服务已连接'
                : '本地开发环境'}
            </Text>
          </Group>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
