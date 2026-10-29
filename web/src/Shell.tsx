import { useColorScheme } from './Theme';
import { Avatar } from '@robert-stackflow/oneui/Avatar';
import { Menu } from '@robert-stackflow/oneui/Menu';
import { lazy, Suspense, useEffect, useState } from 'react';
import { AppShell } from '@robert-stackflow/oneui/AppShell';
import { Segmented } from '@robert-stackflow/oneui/Segmented';
import { Tooltip } from '@robert-stackflow/oneui/Tooltip';
import {
  Archive,
  Grid2X2,
  LogOut,
  ChevronsUpDown,
  UserRound,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useInstanceNavigation } from './InstanceTree';
import { api, notifyError, type AccountInfo } from './api';
const CreateInstance = lazy(() =>
  import('./Instances').then((module) => ({ default: module.CreateInstance })),
);
function initialCollapsed() {
  try {
    return localStorage.getItem('onesearch-sidebar-collapsed') === 'true';
  } catch {
    return false;
  }
}
function SidebarFooter() {
  const { colorScheme, setColorScheme } = useColorScheme();
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
    <div className="sidebar-footer">
      <div className="sidebar-appearance">
        <Segmented
          label="外观主题"
          value={colorScheme}
          onChange={setColorScheme}
          options={[
            {
              value: 'light',
              label: (
                <Tooltip content="浅色">
                  <Sun
                    size={16}
                    role="img"
                    aria-label="浅色"
                    aria-hidden={false}
                  />
                </Tooltip>
              ),
            },
            {
              value: 'dark',
              label: (
                <Tooltip content="深色">
                  <Moon
                    size={16}
                    role="img"
                    aria-label="深色"
                    aria-hidden={false}
                  />
                </Tooltip>
              ),
            },
            {
              value: 'auto',
              label: (
                <Tooltip content="跟随系统">
                  <Monitor
                    size={16}
                    role="img"
                    aria-label="跟随系统"
                    aria-hidden={false}
                  />
                </Tooltip>
              ),
            },
          ]}
        />
      </div>
      <Menu
        label="账户菜单"
        variant="ghost"
        className="account-switch"
        trigger={
          <>
            <Avatar
              name={me.data?.name || username}
              src={me.data?.avatarUrl || undefined}
              size={30}
            />
            <span className="account-label">{me.data?.name || username}</span>
            <ChevronsUpDown className="account-chevron" size={14} />
          </>
        }
        items={[
          {
            label: '账户设置',
            icon: <UserRound size={16} />,
            action: () => navigate('/account'),
          },
          {
            label: 'Meilisearch 文档',
            action: () => {
              window.open(
                'https://www.meilisearch.com/docs',
                '_blank',
                'noopener,noreferrer',
              );
            },
          },
          {
            label: '退出登录',
            icon: <LogOut size={16} />,
            danger: true,
            action: () => void logout(),
          },
        ]}
      />
    </div>
  );
}
export default function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [expanded, setExpanded] = useState<string[]>(['instances']);
  const [createOpened, setCreateOpened] = useState(false);
  const { navigation, active } = useInstanceNavigation(expanded, () =>
    setCreateOpened(true),
  );
  useEffect(() => {
    const id = location.pathname.match(/^\/instances\/([^/]+)/)?.[1];
    if (id)
      setExpanded((previous) => [...new Set([...previous, 'instances', id])]);
  }, [location.pathname, location.search]);
  return (
    <>
      <AppShell
        brandName="OneSearch"
        brandIcon={<img src="/mark.svg" width={32} height={32} alt="" />}
        title=""
        collapsed={collapsed}
        onCollapsedChange={(value) => {
          setCollapsed(value);
          try {
            localStorage.setItem('onesearch-sidebar-collapsed', String(value));
          } catch {
            /* Storage can be unavailable in private contexts. */
          }
        }}
        navigation={[
          {
            id: 'home',
            path: '/',
            label: '工作台',
            icon: <Grid2X2 size={18} />,
          },
          navigation,
          {
            id: 'backups',
            path: '/backups',
            label: '备份',
            icon: <Archive size={18} />,
          },
          {
            id: 'account',
            path: '/account',
            label: '账户设置',
            icon: <UserRound size={18} />,
          },
        ]}
        active={
          location.pathname === '/'
            ? 'home'
            : location.pathname.startsWith('/account')
              ? 'account'
              : location.pathname === '/backups'
                ? 'backups'
                : active
        }
        onNavigate={navigate}
        expandedIds={expanded}
        onExpandedChange={setExpanded}
        sidebarFooter={<SidebarFooter />}
      >
        <Outlet />
      </AppShell>
      {createOpened && (
        <Suspense fallback={null}>
          <CreateInstance opened onClose={() => setCreateOpened(false)} />
        </Suspense>
      )}
    </>
  );
}
