import { Suspense } from 'react';
import { SettingsLayout } from '@robert-stackflow/oneui/SettingsLayout';
import {
  Fingerprint,
  KeyRound,
  Monitor,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Loading, PageTitle } from './components';
const sections = [
  { path: '/account', label: '账户资料', icon: UserRound },
  { path: '/account/security', label: '登录安全', icon: Fingerprint },
  { path: '/account/password', label: '修改密码', icon: KeyRound },
  { path: '/account/sessions', label: '登录会话', icon: Monitor },
  { path: '/account/audit', label: '审计日志', icon: ShieldCheck },
];
export default function AccountLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <PageTitle title="账户设置" />
      <SettingsLayout
        value={pathname.replace(/\/$/, '')}
        onChange={navigate}
        groups={[
          {
            id: 'account',
            items: sections.map(({ path, label, icon: Icon }) => ({
              value: path,
              label,
              icon: <Icon size={17} />,
            })),
          },
        ]}
      >
        <div className="account-content">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </div>
      </SettingsLayout>
    </>
  );
}
