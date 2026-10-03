import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Group,
  Paper,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { api, notifyError, notifySuccess } from './api';
export default function Password() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otp, setOTP] = useState('');
  const cache = useQueryClient();
  const change = useMutation({
    mutationFn: () => {
      if (next !== confirm) throw new Error('两次输入的新密码不一致');
      return api('/account/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: current,
          newPassword: next,
          otp,
        }),
      });
    },
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setOTP('');
      cache.invalidateQueries({ queryKey: ['sessions'] });
      notifySuccess('密码已修改，其它登录会话已撤销。');
    },
    onError: notifyError,
  });
  return (
    <Paper withBorder className="account-panel">
      <div className="account-panel-heading">
        <Title order={3}>修改密码</Title>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Stack gap="lg" className="account-password-fields">
          <PasswordInput
            label="当前密码"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.currentTarget.value)}
          />
          <PasswordInput
            label="新密码"
            required
            autoComplete="new-password"
            description="12–72 字节"
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
          />
          <PasswordInput
            label="确认新密码"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            error={confirm && confirm !== next ? '两次密码不一致' : null}
          />
          <TextInput
            label="双因素验证码或恢复码"
            description="已开启双因素认证时填写"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOTP(e.currentTarget.value)}
          />
          <Group justify="flex-end" className="form-actions">
            <Button
              type="submit"
              disabled={
                !current ||
                new TextEncoder().encode(next).length < 12 ||
                next !== confirm
              }
              loading={change.isPending}
            >
              修改密码
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
