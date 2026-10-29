import { Alert } from '@robert-stackflow/oneui/Alert';
import { Button } from '@robert-stackflow/oneui/Button';
import {
  Group,
  Surface as Paper,
  Stack,
  Text,
  Box,
} from '@robert-stackflow/oneui/Layout';
import { Dialog as Modal } from '@robert-stackflow/oneui/Dialog';
import { PasswordField as PasswordInput } from '@robert-stackflow/oneui/PasswordField';
import { Select } from '@robert-stackflow/oneui/Select';
import { TableMarkup as Table } from '@robert-stackflow/oneui/TableMarkup';
import { Input as TextInput } from '@robert-stackflow/oneui/Input';
import { FormField } from '@robert-stackflow/oneui/FormField';
import { useState } from 'react';
import AutoBackups from './AutoBackups';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import {
  ApiError,
  api,
  formatDate,
  notifyError,
  notifySuccess,
  type Instance,
} from './api';
import { PageTitle, Status, Empty, Loading, ErrorState } from './components';
interface Backup {
  id: string;
  kind: string;
  instanceId?: string;
  status: string;
  createdAt: string;
  size: number;
  error?: string;
  sha256?: string;
  automatic?: boolean;
}
export default function Backups() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('platform');
  const [instance, setInstance] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const cache = useQueryClient();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [otp, setOTP] = useState('');
  const security = useQuery({
    queryKey: ['security'],
    queryFn: () =>
      api<{
        totpEnabled: boolean;
        verifiedUntil: number;
      }>('/security'),
  });
  const q = useQuery({
    queryKey: ['backups'],
    queryFn: () => api<Backup[]>('/backups'),
    refetchInterval: 3000,
  });
  const instances = useQuery({
    queryKey: ['instances'],
    queryFn: () => api<Instance[]>('/instances'),
  });
  const create = useMutation({
    mutationFn: () =>
      api('/backups', {
        method: 'POST',
        body: JSON.stringify({ kind, instanceId: instance || '', password }),
      }),
    onSuccess: () => {
      setOpen(false);
      setPassword('');
      cache.invalidateQueries({ queryKey: ['backups'] });
      notifySuccess('备份已开始，完成后可下载。');
    },
    onError: (e) => {
      if (
        e instanceof ApiError &&
        e.status === 403 &&
        e.message === '请重新验证身份后继续此操作'
      )
        setVerifyOpen(true);
      else notifyError(e);
    },
  });
  const verify = useMutation({
    mutationFn: () =>
      api('/auth/reauth', {
        method: 'POST',
        body: JSON.stringify({ password: currentPassword, otp }),
      }),
    onSuccess: () => {
      setVerifyOpen(false);
      setCurrentPassword('');
      setOTP('');
      cache.invalidateQueries({ queryKey: ['security'] });
      create.mutate();
    },
    onError: notifyError,
  });
  return (
    <>
      <PageTitle
        title="备份"
        description="把平台配置和搜索数据分别备份，文件使用你提供的密码加密。"
      >
        <Button onClick={() => setOpen(true)} variant="primary">
          {<Plus size={16} />}
          创建备份
        </Button>
      </PageTitle>
      <Box style={{ marginBottom: 24 }}>
        <Alert tone={'info'}>
          平台备份包含账户、通行密钥、设置、请求历史和实例凭据，不包含搜索数据及登录会话。搜索数据备份使用
          Meilisearch dump。恢复操作使用离线工具，操作说明见设计文档。
        </Alert>
      </Box>
      <AutoBackups />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} retry={q.refetch} />
      ) : !q.data.length ? (
        <Empty
          title="尚未创建备份"
          description="手动备份密码不保存；自动备份密码加密保存。恢复时需要对应密码。"
        />
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={640}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>类型</Table.Th>
                  <Table.Th>状态</Table.Th>
                  <Table.Th>大小</Table.Th>
                  <Table.Th>时间</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.map((b) => (
                  <Table.Tr key={b.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {b.kind === 'platform' ? '平台配置' : '搜索数据 dump'}
                        {b.automatic ? ' · 自动' : ''}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {
                          instances.data?.find((i) => i.id === b.instanceId)
                            ?.name
                        }
                      </Text>
                      {b.error ? (
                        <Text c="red" size="xs">
                          {b.error}
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Status value={b.status} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {b.size ? (b.size / 1048576).toFixed(2) + ' MiB' : '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{formatDate(b.createdAt)}</Text>
                    </Table.Td>
                    <Table.Td>
                      {b.status === 'succeeded' ? (
                        <Button
                          href={`/api/backups/${b.id}/download`}
                          variant="secondary"
                          size="small"
                        >
                          {<Download size={14} />}
                          下载
                        </Button>
                      ) : null}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      <Modal
        onClose={() => {
          setOpen(false);
          setPassword('');
        }}
        title="创建加密备份"
        open={open}
      >
        <Stack>
          <FormField label="备份类型">
            <Select
              label="备份类型"
              onChange={(v) => setKind(v || 'platform')}
              options={[
                { value: 'platform', label: '平台配置（不含搜索数据）' },
                { value: 'dump', label: '搜索数据（单实例 dump）' },
              ]}
              value={kind ?? ''}
            />
          </FormField>
          {kind === 'dump' ? (
            <FormField label="实例" required>
              <Select
                label="实例"
                required
                onChange={setInstance}
                placeholder="选择运行中的托管实例"
                options={(instances.data || [])
                  .filter(
                    (i) => i.provider !== 'external' && i.status === 'running',
                  )
                  .map((i) => ({ value: i.id, label: i.name }))}
                value={instance ?? ''}
              />
            </FormField>
          ) : null}
          <PasswordInput
            label="备份密码"
            value={password}
            hint="至少 12 位，恢复时需要此密码。平台不保存密码。"
            onChange={(e) => setPassword(e)}
          />
          <Button
            disabled={password.length < 12 || (kind === 'dump' && !instance)}
            loading={create.isPending}
            onClick={() => {
              if ((security.data?.verifiedUntil || 0) <= Date.now())
                setVerifyOpen(true);
              else create.mutate();
            }}
            variant="primary"
          >
            开始备份
          </Button>
        </Stack>
      </Modal>
      <Modal
        onClose={() => {
          setVerifyOpen(false);
          setCurrentPassword('');
          setOTP('');
        }}
        title="验证身份"
        open={verifyOpen}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate();
          }}
        >
          <Stack gap="lg">
            <PasswordInput
              label="当前密码"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e)}
            />
            {security.data?.totpEnabled ? (
              <TextInput
                label="双因素验证码或恢复码"
                required
                value={otp}
                onChange={(e) => setOTP(e.currentTarget.value)}
              />
            ) : null}
            <Group justify="flex-end" className="form-actions">
              <Button
                onClick={() => {
                  setVerifyOpen(false);
                  setCurrentPassword('');
                  setOTP('');
                }}
                variant="secondary"
              >
                取消
              </Button>
              <Button
                type="submit"
                loading={verify.isPending}
                variant="primary"
              >
                验证并继续
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
