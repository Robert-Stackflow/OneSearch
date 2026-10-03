import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Toggle } from './Toggle';
import { api, ApiError, notifyError, notifySuccess } from './api';
import { ErrorState, Loading } from './components';
interface Schedule {
  enabled: boolean;
  time: string;
  keep: number;
  includeDumps: boolean;
  hasPassword: boolean;
  lastRun: string;
}
export default function AutoBackups() {
  const q = useQuery({
    queryKey: ['backup-schedule'],
    queryFn: () => api<Schedule>('/backups/schedule'),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return <ScheduleForm settings={q.data} />;
}
function ScheduleForm({ settings }: { settings: Schedule }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [time, setTime] = useState(settings.time);
  const [keep, setKeep] = useState<string | number>(settings.keep);
  const [dumps, setDumps] = useState(settings.includeDumps);
  const [password, setPassword] = useState('');
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [otp, setOTP] = useState('');
  const cache = useQueryClient();
  const security = useQuery({
    queryKey: ['security'],
    queryFn: () => api<{ totpEnabled: boolean }>('/security'),
  });
  const save = useMutation({
    mutationFn: () =>
      api<Schedule>('/backups/schedule', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          time,
          keep: Number(keep),
          includeDumps: dumps,
          password,
        }),
      }),
    onSuccess: (s) => {
      cache.setQueryData(['backup-schedule'], s);
      setPassword('');
      notifySuccess('自动备份设置已保存。');
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
      save.mutate();
    },
    onError: notifyError,
  });
  return (
    <>
      <Paper withBorder p="xl" mb="xl">
        <Group justify="space-between" mb="lg">
          <Title order={4}>自动备份</Title>
          <Toggle
            label="启用自动备份"
            checked={enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
          />
        </Group>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="每日执行时间"
                description="北京时间；每天最多执行一次"
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.currentTarget.value)}
              />
              <NumberInput
                label="保留份数"
                description="平台及每个实例分别保留成功备份；手动备份不清理"
                min={1}
                max={100}
                required
                value={keep}
                onChange={setKeep}
              />
            </SimpleGrid>
            <Toggle
              label="同时备份运行中的实例数据"
              checked={dumps}
              onChange={(e) => setDumps(e.currentTarget.checked)}
            />
            <PasswordInput
              label={settings.hasPassword ? '更新备份密码' : '备份密码'}
              description={
                settings.hasPassword
                  ? '留空保留现有密码'
                  : '至少 12 位，请单独保存，恢复时需要'
              }
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {settings.lastRun
                  ? `最近执行日期 ${settings.lastRun}`
                  : '尚未执行自动备份'}
              </Text>
              <Button
                type="submit"
                loading={save.isPending}
                disabled={
                  enabled && !settings.hasPassword && password.length < 12
                }
              >
                保存设置
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
      <Modal
        opened={verifyOpen}
        onClose={() => {
          setVerifyOpen(false);
          setCurrentPassword('');
          setOTP('');
        }}
        title="验证身份"
        centered
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
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            />
            {security.data?.totpEnabled ? (
              <TextInput
                label="双因素验证码或恢复码"
                required
                value={otp}
                onChange={(e) => setOTP(e.currentTarget.value)}
              />
            ) : null}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setVerifyOpen(false)}>
                取消
              </Button>
              <Button type="submit" loading={verify.isPending}>
                验证并保存
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
