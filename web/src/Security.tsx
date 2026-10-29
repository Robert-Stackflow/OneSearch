import { Alert } from '@robert-stackflow/oneui/Alert';
import { Badge } from '@robert-stackflow/oneui/Badge';
import { Button } from '@robert-stackflow/oneui/Button';
import {
  Code,
  Group,
  Surface as Paper,
  Stack,
  Text,
  Heading as Title,
  Box,
} from '@robert-stackflow/oneui/Layout';
import { CopyButton } from '@robert-stackflow/oneui/CopyButton';
import { Dialog as Modal } from '@robert-stackflow/oneui/Dialog';
import { PasswordField as PasswordInput } from '@robert-stackflow/oneui/PasswordField';
import { Input as TextInput } from '@robert-stackflow/oneui/Input';
import { PasskeyItem } from '@robert-stackflow/oneui/PasskeyItem';
import { SessionItem } from '@robert-stackflow/oneui/SessionItem';
import { deviceInfo } from './devices';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { ApiError, api, formatDate, notifyError, notifySuccess } from './api';
import { registerPasskey } from './passkeys';
import { PageTitle, Loading, ErrorState } from './components';
interface SecurityInfo {
  verifiedUntil: number;
  totpEnabled: boolean;
  passkeyCount: number;
  recoveryRemaining: number;
  rpOrigin: string;
}
interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  rpID: string;
}
interface Session {
  id: string;
  ip: string;
  userAgent: string;
  current: boolean;
  createdAt: string;
  lastSeen: string;
  method: string;
}
export default function Security({
  sessionsOnly = false,
  embedded = false,
}: {
  sessionsOnly?: boolean;
  embedded?: boolean;
}) {
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: ['security'],
    queryFn: () => api<SecurityInfo>('/security'),
  });
  const keys = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => api<Passkey[]>('/passkeys'),
  });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<Session[]>('/sessions'),
    refetchInterval: 10000,
  });
  const pendingAction = useRef<{
    f: () => Promise<unknown>;
    message?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [password, setPassword] = useState('');
  const [otp, setOTP] = useState('');
  const [keyModal, setKeyModal] = useState(false);
  const [keyName, setKeyName] = useState('我的设备');
  const [setup, setSetup] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [disable, setDisable] = useState(false);
  const [remove, setRemove] = useState<Passkey | null>(null);
  async function run(
    f: () => Promise<unknown>,
    message?: string,
    verification = false,
  ) {
    if (verification && (q.data?.verifiedUntil || 0) <= Date.now()) {
      pendingAction.current = { f, message };
      setReauth(true);
      return;
    }
    setBusy(true);
    try {
      await f();
      if (message) notifySuccess(message);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['security'] }),
        cache.invalidateQueries({ queryKey: ['passkeys'] }),
        cache.invalidateQueries({ queryKey: ['sessions'] }),
      ]);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 403 &&
        e.message === '请重新验证身份后继续此操作'
      ) {
        pendingAction.current = { f, message };
        setReauth(true);
      } else notifyError(e);
    } finally {
      setBusy(false);
    }
  }
  async function verifyIdentity() {
    setBusy(true);
    try {
      await api('/auth/reauth', {
        method: 'POST',
        body: JSON.stringify({ password, otp }),
      });
      setPassword('');
      setOTP('');
      setReauth(false);
      await cache.invalidateQueries({ queryKey: ['security'] });
      const action = pendingAction.current;
      pendingAction.current = null;
      if (action) await run(action.f, action.message);
      else notifySuccess('身份已验证。');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }
  function closeReauth() {
    setReauth(false);
    pendingAction.current = null;
    setPassword('');
    setOTP('');
  }
  if (q.isPending || sessions.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <>
      {!embedded ? (
        <PageTitle title={sessionsOnly ? '登录会话' : '账户安全'} />
      ) : null}
      <Stack gap="xl">
        {!sessionsOnly ? (
          <>
            <Paper withBorder p="xl" className="account-panel">
              <Group justify="space-between" mb="lg">
                <Group>
                  <KeyRound size={22} />
                  <div>
                    <Title order={3}>通行密钥</Title>
                    <Text size="sm" c="dimmed" mt={5}>
                      使用 Windows Hello、手机或安全密钥。
                    </Text>
                  </div>
                </Group>
                <Button
                  onClick={() => setKeyModal(true)}
                  disabled={!window.PublicKeyCredential}
                  variant="primary"
                >
                  {<Plus size={16} />}
                  添加通行密钥
                </Button>
              </Group>
              {keys.error ? (
                <ErrorState error={keys.error} retry={keys.refetch} />
              ) : keys.data?.length ? (
                <Stack role="list" aria-label="通行密钥" gap="sm">
                  {keys.data.map((k) => (
                    <PasskeyItem
                      key={k.id}
                      name={k.name}
                      createdAt={formatDate(k.createdAt)}
                      lastUsedAt={
                        k.lastUsedAt ? formatDate(k.lastUsedAt) : undefined
                      }
                      disabled={busy}
                      onRemove={() => setRemove(k)}
                    />
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  还没有添加通行密钥。
                </Text>
              )}
            </Paper>
            <Paper withBorder p="xl" className="account-panel">
              <Group justify="space-between">
                <Group>
                  <ShieldCheck size={22} />
                  <div>
                    <Title order={3}>双因素认证</Title>
                    <Text size="sm" c="dimmed" mt={5}>
                      标准 TOTP 验证器，支持一次性恢复码。
                    </Text>
                  </div>
                </Group>
                <Group gap="sm">
                  {' '}
                  <Badge tone={q.data.totpEnabled ? 'success' : 'neutral'}>
                    {q.data.totpEnabled ? '已开启' : '未开启'}
                  </Badge>{' '}
                  {q.data.totpEnabled ? (
                    <Button
                      onClick={() => {
                        setCode('');
                        setDisable(true);
                      }}
                      variant="danger"
                    >
                      关闭双因素认证
                    </Button>
                  ) : (
                    <Button
                      loading={busy}
                      onClick={() =>
                        void run(
                          async () => {
                            setSetup(
                              await api('/security/totp/begin', {
                                method: 'POST',
                              }),
                            );
                            setCode('');
                          },
                          undefined,
                          true,
                        )
                      }
                      variant="primary"
                    >
                      设置验证器
                    </Button>
                  )}
                </Group>
              </Group>
              <Group justify="space-between" mt="xl">
                <Text size="sm" c="dimmed">
                  {q.data.totpEnabled
                    ? `剩余恢复码 ${q.data.recoveryRemaining} 个`
                    : '使用验证器生成每 30 秒更新的验证码。'}
                </Text>
              </Group>
            </Paper>
          </>
        ) : null}
        {sessionsOnly ? (
          <Paper withBorder p="xl" className="account-panel">
            <Group justify="space-between" mb="lg">
              <div>
                <Title order={3}>登录会话</Title>
                <Text size="sm" c="dimmed" mt={5}>
                  会话最长有效 24 小时，撤销后下一次请求需重新登录。
                </Text>
              </div>
              <Button
                loading={busy}
                onClick={() =>
                  void run(
                    () => api('/sessions/others', { method: 'DELETE' }),
                    '其它会话已撤销。',
                  )
                }
                variant="secondary"
              >
                撤销其它会话
              </Button>
            </Group>
            {sessions.error ? (
              <ErrorState error={sessions.error} retry={sessions.refetch} />
            ) : (
              <Stack role="list" aria-label="登录会话" gap="sm">
                {sessions.data?.map((session) => (
                  <SessionItem
                    key={session.id}
                    device={deviceInfo(session.userAgent).label}
                    deviceType={deviceInfo(session.userAgent).type}
                    current={session.current}
                    metadata={[
                      { label: 'IP', value: session.ip },
                      {
                        label: '登录方式',
                        value:
                          session.method === 'passkey' ? '通行密钥' : '密码',
                      },
                      {
                        label: '最近活跃',
                        value: formatDate(session.lastSeen),
                      },
                    ]}
                    disabled={busy}
                    onRevoke={
                      session.current
                        ? undefined
                        : () =>
                            void run(
                              () =>
                                api(`/sessions/${session.id}`, {
                                  method: 'DELETE',
                                }),
                              '会话已撤销。',
                            )
                    }
                  />
                ))}
              </Stack>
            )}
          </Paper>
        ) : null}
      </Stack>
      <Modal onClose={closeReauth} title="验证身份" open={reauth}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verifyIdentity();
          }}
        >
          <Stack gap="lg">
            <Text size="sm" c="dimmed">
              继续此安全操作前，请验证当前账户。
            </Text>
            <PasswordInput
              label="当前密码"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e)}
            />
            {q.data.totpEnabled ? (
              <TextInput
                label="双因素验证码或恢复码"
                required
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOTP(e.currentTarget.value)}
              />
            ) : null}
            <Group justify="flex-end" className="form-actions">
              <Button onClick={closeReauth} variant="secondary">
                取消
              </Button>
              <Button type="submit" loading={busy} variant="primary">
                验证并继续
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
      <Modal
        onClose={() => setKeyModal(false)}
        title="添加通行密钥"
        open={keyModal}
      >
        <Stack>
          <TextInput
            label="名称"
            value={keyName}
            onChange={(e) => setKeyName(e.currentTarget.value)}
          />
          <Text size="sm" c="dimmed">
            浏览器会让你选择设备或安全密钥，并验证指纹、面容或 PIN。
          </Text>
          <Button
            loading={busy}
            disabled={!keyName.trim()}
            onClick={() =>
              void run(async () => {
                await registerPasskey(keyName);
                setKeyModal(false);
              }, '通行密钥已添加。')
            }
            variant="primary"
          >
            继续注册
          </Button>
        </Stack>
      </Modal>
      <Modal
        onClose={() => setSetup(null)}
        title="设置双因素认证"
        open={!!setup}
      >
        <Stack align="center">
          <Text size="sm">在验证器中扫描二维码，或手动输入密钥。</Text>
          {setup ? (
            <>
              <Paper p="md" bg="white">
                <QRCodeSVG value={setup.uri} size={180} />
              </Paper>
              <Code block>{setup.secret}</Code>
              <CopyButton value={setup.secret}>
                {({ copy, copied }) => (
                  <Button onClick={copy} variant="ghost" size="small">
                    {copied ? '已复制' : '复制设置密钥'}
                  </Button>
                )}
              </CopyButton>
            </>
          ) : null}
          <Box style={{ width: '100%' }}>
            <TextInput
              label="验证器中的 6 位验证码"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              autoComplete="one-time-code"
            />
          </Box>
          <Button
            loading={busy}
            onClick={() =>
              void run(
                async () => {
                  const r = await api<{
                    recoveryCodes: string[];
                  }>('/security/totp/confirm', {
                    method: 'POST',
                    body: JSON.stringify({ code }),
                  });
                  setRecovery(r.recoveryCodes);
                  setSetup(null);
                  setCode('');
                },
                '双因素认证已开启。',
                true,
              )
            }
            variant="primary"
            style={{ width: '100%' }}
          >
            验证并开启
          </Button>
        </Stack>
      </Modal>
      <Modal
        onClose={() => setRecovery([])}
        title="保存恢复码"
        open={!!recovery.length}
      >
        <Stack>
          <Alert tone={'warning'}>
            只显示这一次。每个恢复码只能使用一次；请保存到安全的位置。
          </Alert>
          <Code block>{recovery.join('\n')}</Code>
          <CopyButton value={recovery.join('\n')}>
            {({ copy, copied }) => (
              <Button onClick={copy} variant="primary">
                {copied ? '已复制' : '复制恢复码'}
              </Button>
            )}
          </CopyButton>
        </Stack>
      </Modal>
      <Modal
        onClose={() => setDisable(false)}
        title="关闭双因素认证"
        open={disable}
      >
        <Stack>
          <TextInput
            label="验证码或恢复码"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
          />
          <Button
            loading={busy}
            onClick={() =>
              void run(
                async () => {
                  await api('/security/totp/disable', {
                    method: 'POST',
                    body: JSON.stringify({ code }),
                  });
                  setDisable(false);
                },
                '双因素认证已关闭。',
                true,
              )
            }
            variant="danger"
          >
            确认关闭
          </Button>
        </Stack>
      </Modal>
      <Modal
        onClose={() => setRemove(null)}
        title="移除通行密钥"
        open={!!remove}
      >
        <Stack>
          <Text size="sm">此设备将无法再使用该通行密钥登录。</Text>
          <Button
            loading={busy}
            onClick={() =>
              void run(
                async () => {
                  await api(`/passkeys/${remove!.id}`, { method: 'DELETE' });
                  setRemove(null);
                },
                '通行密钥已移除。',
                true,
              )
            }
            variant="danger"
          >
            确认移除
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
