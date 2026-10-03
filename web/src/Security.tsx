import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
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
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(
    null,
  );
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
                  leftSection={<Plus size={16} />}
                  onClick={() => setKeyModal(true)}
                  disabled={!window.PublicKeyCredential}
                >
                  添加通行密钥
                </Button>
              </Group>
              {keys.error ? (
                <ErrorState error={keys.error} retry={keys.refetch} />
              ) : keys.data?.length ? (
                <Stack>
                  {keys.data.map((k) => (
                    <Group
                      key={k.id}
                      justify="space-between"
                      className="passkey-entry"
                    >
                      <Group gap="sm">
                        <span className="credential-icon">
                          <KeyRound size={18} />
                        </span>
                        <div>
                          <Text size="sm" fw={600}>
                            {k.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            创建 {formatDate(k.createdAt)} ·{' '}
                            {k.lastUsedAt
                              ? `最近使用 ${formatDate(k.lastUsedAt)}`
                              : '尚未使用'}
                          </Text>
                        </div>
                      </Group>
                      <Button
                        variant="subtle"
                        color="red"
                        size="xs"
                        onClick={() => setRemove(k)}
                      >
                        移除
                      </Button>
                    </Group>
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
                  <Badge
                    color={q.data.totpEnabled ? 'teal' : 'gray'}
                    variant="light"
                  >
                    {q.data.totpEnabled ? '已开启' : '未开启'}
                  </Badge>{' '}
                  {q.data.totpEnabled ? (
                    <Button
                      variant="light"
                      color="red"
                      onClick={() => {
                        setCode('');
                        setDisable(true);
                      }}
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
                variant="default"
                loading={busy}
                onClick={() =>
                  void run(
                    () => api('/sessions/others', { method: 'DELETE' }),
                    '其它会话已撤销。',
                  )
                }
              >
                撤销其它会话
              </Button>
            </Group>
            {sessions.error ? (
              <ErrorState error={sessions.error} retry={sessions.refetch} />
            ) : (
              <Table.ScrollContainer minWidth={600}>
                <Table verticalSpacing="md">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>设备与 IP</Table.Th>
                      <Table.Th>登录方式</Table.Th>
                      <Table.Th>最近活跃</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sessions.data?.map((s) => (
                      <Table.Tr key={s.id}>
                        <Table.Td>
                          <Group gap={8}>
                            <Text fw={600} size="sm">
                              {s.ip}
                            </Text>
                            {s.current ? (
                              <Badge size="xs" color="teal">
                                当前会话
                              </Badge>
                            ) : null}
                          </Group>
                          <Text size="xs" c="dimmed" lineClamp={2} maw={350}>
                            {s.userAgent || '未提供设备信息'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {s.method === 'passkey' ? '通行密钥' : '密码'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{formatDate(s.lastSeen)}</Text>
                        </Table.Td>
                        <Table.Td>
                          {!s.current ? (
                            <Button
                              size="xs"
                              variant="subtle"
                              color="red"
                              onClick={() =>
                                void run(
                                  () =>
                                    api(`/sessions/${s.id}`, {
                                      method: 'DELETE',
                                    }),
                                  '会话已撤销。',
                                )
                              }
                            >
                              撤销
                            </Button>
                          ) : null}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Paper>
        ) : null}
      </Stack>
      <Modal opened={reauth} onClose={closeReauth} title="验证身份" centered>
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
              onChange={(e) => setPassword(e.currentTarget.value)}
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
              <Button variant="default" onClick={closeReauth}>
                取消
              </Button>
              <Button type="submit" loading={busy}>
                验证并继续
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
      <Modal
        opened={keyModal}
        onClose={() => setKeyModal(false)}
        title="添加通行密钥"
        centered
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
          >
            继续注册
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!setup}
        onClose={() => setSetup(null)}
        title="设置双因素认证"
        centered
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
                  <Button variant="subtle" size="xs" onClick={copy}>
                    {copied ? '已复制' : '复制设置密钥'}
                  </Button>
                )}
              </CopyButton>
            </>
          ) : null}
          <TextInput
            w="100%"
            label="验证器中的 6 位验证码"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            autoComplete="one-time-code"
          />
          <Button
            fullWidth
            loading={busy}
            onClick={() =>
              void run(
                async () => {
                  const r = await api<{ recoveryCodes: string[] }>(
                    '/security/totp/confirm',
                    { method: 'POST', body: JSON.stringify({ code }) },
                  );
                  setRecovery(r.recoveryCodes);
                  setSetup(null);
                  setCode('');
                },
                '双因素认证已开启。',
                true,
              )
            }
          >
            验证并开启
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!recovery.length}
        onClose={() => setRecovery([])}
        title="保存恢复码"
        centered
      >
        <Stack>
          <Alert color="orange">
            只显示这一次。每个恢复码只能使用一次；请保存到安全的位置。
          </Alert>
          <Code block>{recovery.join('\n')}</Code>
          <CopyButton value={recovery.join('\n')}>
            {({ copy, copied }) => (
              <Button onClick={copy}>{copied ? '已复制' : '复制恢复码'}</Button>
            )}
          </CopyButton>
        </Stack>
      </Modal>
      <Modal
        opened={disable}
        onClose={() => setDisable(false)}
        title="关闭双因素认证"
        centered
      >
        <Stack>
          <TextInput
            label="验证码或恢复码"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
          />
          <Button
            color="red"
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
          >
            确认关闭
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!remove}
        onClose={() => setRemove(null)}
        title="移除通行密钥"
        centered
      >
        <Stack>
          <Text size="sm">此设备将无法再使用该通行密钥登录。</Text>
          <Button
            color="red"
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
          >
            确认移除
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
