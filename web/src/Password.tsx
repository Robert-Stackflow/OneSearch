import { Card } from '@robert-stackflow/oneui/Card';
import { Button } from '@robert-stackflow/oneui/Button';
import { Group, Stack } from '@robert-stackflow/oneui/Layout';
import { PasswordField as PasswordInput } from '@robert-stackflow/oneui/PasswordField';
import { Input as TextInput } from '@robert-stackflow/oneui/Input';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
    <Card title="修改密码">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Stack gap="lg">
          <PasswordInput
            label="当前密码"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e)}
          />
          <PasswordInput
            label="新密码"
            required
            autoComplete="new-password"
            value={next}
            hint="12–72 字节"
            onChange={(e) => setNext(e)}
          />
          <PasswordInput
            label="确认新密码"
            required
            autoComplete="new-password"
            value={confirm}
            error={confirm && confirm !== next ? '两次密码不一致' : undefined}
            onChange={(e) => setConfirm(e)}
          />
          <TextInput
            label="双因素验证码或恢复码"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOTP(e.currentTarget.value)}
            hint="已开启双因素认证时填写"
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
              variant="primary"
            >
              修改密码
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}
