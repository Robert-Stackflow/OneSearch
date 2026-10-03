import { lazy, Suspense, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Divider,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { KeyRound, ArrowRight } from 'lucide-react';
import { api, ApiError, notifyError } from './api';
import { Loading, ErrorState } from './components';
import { loginPasskey } from './passkeys';
import Shell from './Shell';
import AccountLayout from './AccountLayout';
const Password = lazy(() => import('./Password'));
const Account = lazy(() => import('./Account'));
const Instances = lazy(() => import('./Instances'));
const Detail = lazy(() => import('./InstancePage'));
const Activity = lazy(() => import('./Activity'));
const Security = lazy(() => import('./Security'));
const Backups = lazy(() => import('./Backups'));
function Protected() {
  const q = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ username: string }>('/auth/me'),
  });
  if (q.isPending) return <Loading />;
  if (q.error)
    return q.error instanceof ApiError && q.error.status === 401 ? (
      <Navigate to="/login" replace />
    ) : (
      <ErrorState error={q.error} retry={q.refetch} />
    );
  return <Shell />;
}
function Login() {
  const [name, setName] = useState('admin');
  const [password, setPassword] = useState('');
  const [otp, setOTP] = useState('');
  const [secondFactor, setSecondFactor] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const nav = useNavigate();
  const cache = useQueryClient();
  const login = useMutation({
    mutationFn: () =>
      api<{ requiresTwoFactor?: boolean }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: name, password, otp }),
      }),
    onSuccess: (result) => {
      if (result.requiresTwoFactor) {
        setSecondFactor(true);
        setOTP('');
        return;
      }
      setPassword('');
      setOTP('');
      cache.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    },
    onError: notifyError,
  });
  async function passkey() {
    setPasskeyBusy(true);
    try {
      await loginPasskey(name);
      setPassword('');
      setOTP('');
      cache.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    } catch (e) {
      notifyError(e);
    } finally {
      setPasskeyBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-brand">
        <img src="/mark.svg" width={52} height={52} alt="" />
        <Title order={2}>OneSearch</Title>
      </div>
      <Paper withBorder p={32} w="100%" maw={430}>
        <Title order={3} mb={6}>
          {secondFactor ? '双因素身份验证' : '登录工作空间'}
        </Title>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <Stack>
            {!secondFactor ? (
              <>
                <TextInput
                  label="用户名"
                  autoComplete="username"
                  required
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
                <PasswordInput
                  label="密码"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
              </>
            ) : (
              <>
                <Text size="sm" c="dimmed">
                  正在验证 {name}
                </Text>
                <TextInput
                  label="双因素验证码或恢复码"
                  description="输入验证器中的验证码，或使用一次性恢复码"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={otp}
                  onChange={(e) => setOTP(e.currentTarget.value)}
                />
              </>
            )}
            <Button
              type="submit"
              loading={login.isPending}
              rightSection={<ArrowRight size={16} />}
            >
              {secondFactor ? '验证并登录' : '登录'}
            </Button>
            {secondFactor ? (
              <Button
                variant="subtle"
                disabled={login.isPending}
                onClick={() => {
                  setSecondFactor(false);
                  setOTP('');
                  setPassword('');
                  login.reset();
                }}
              >
                返回密码登录
              </Button>
            ) : null}
          </Stack>
        </form>
        <Divider label="或" my="lg" />
        <Button
          fullWidth
          variant="default"
          leftSection={<KeyRound size={16} />}
          loading={passkeyBusy}
          disabled={!window.PublicKeyCredential}
          onClick={() => void passkey()}
        >
          使用通行密钥
        </Button>
      </Paper>
      <Text size="xs" c="dimmed" mt="lg">
        初始登录信息由部署管理员提供
      </Text>
    </div>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route index element={<Instances dashboard />} />
            <Route path="instances" element={<Instances />} />
            <Route path="instances/:id" element={<Detail />} />
            <Route
              path="operations"
              element={<Navigate to="/instances" replace />}
            />
            <Route
              path="audit"
              element={<Navigate to="/account/audit" replace />}
            />
            <Route path="settings" element={<Navigate to="/" replace />} />
            <Route
              path="security"
              element={<Navigate to="/account/security" replace />}
            />
            <Route
              path="sessions"
              element={<Navigate to="/account/sessions" replace />}
            />
            <Route path="account" element={<AccountLayout />}>
              <Route index element={<Account />} />
              <Route path="security" element={<Security embedded />} />
              <Route
                path="sessions"
                element={<Security sessionsOnly embedded />}
              />
              <Route path="password" element={<Password />} />
              <Route
                path="audit"
                element={<Activity kind="audit" embedded />}
              />
            </Route>
            <Route
              path="history"
              element={<Navigate to="/instances" replace />}
            />
            <Route path="backups" element={<Backups />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
