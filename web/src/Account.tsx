import { Avatar } from '@robert-stackflow/oneui/Avatar';
import { Button } from '@robert-stackflow/oneui/Button';
import {
  Group,
  Surface as Paper,
  Stack,
  Text,
  Heading as Title,
} from '@robert-stackflow/oneui/Layout';
import { Input as TextInput } from '@robert-stackflow/oneui/Input';
import { FilePicker } from '@robert-stackflow/oneui/FilePicker';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, notifyError, notifySuccess, type AccountInfo } from './api';
import { Loading, ErrorState } from './components';
export default function Account() {
  const q = useQuery({
    queryKey: ['me'],
    queryFn: () => api<AccountInfo>('/auth/me'),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <ProfileForm
      key={q.data.username}
      account={{
        ...q.data,
        name: q.data.name || q.data.username,
        avatarUrl: q.data.avatarUrl || '',
      }}
    />
  );
}
function ProfileForm({ account }: { account: AccountInfo }) {
  const [name, setName] = useState(account.name);
  const cache = useQueryClient();
  function saved(info: AccountInfo) {
    cache.setQueryData(['me'], info);
    notifySuccess('账户资料已更新。');
  }
  const save = useMutation({
    mutationFn: () =>
      api<AccountInfo>('/account', {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: saved,
    onError: notifyError,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 5 * 1024 * 1024) throw new Error('头像最多 5 MiB');
      const body = new FormData();
      body.append('avatar', file);
      const res = await fetch('/api/account/avatar', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { 'X-OneSearch-Request': '1' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || '头像上传失败');
      return data.data as AccountInfo;
    },
    onSuccess: saved,
    onError: notifyError,
  });
  return (
    <Paper withBorder p="xl" className="account-panel">
      <Stack gap="xl">
        <Group>
          <Avatar
            name={account.name || account.username}
            src={account.avatarUrl || undefined}
            size={64}
            fallback={<>{account.name.slice(0, 1).toUpperCase()}</>}
          />
          <Title order={3}>账户资料</Title>
        </Group>
        <Group className="profile-upload">
          <FilePicker
            label="上传头像"
            accept="image/jpeg,image/png,image/gif"
            maxSize={5 * 1024 * 1024}
            disabled={upload.isPending}
            onFiles={(files) => upload.mutate(files[0])}
          />

          <Text size="xs" c="dimmed">
            JPG、PNG、GIF · 最大 5 MiB
          </Text>
        </Group>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Stack gap="lg">
            <TextInput label="登录用户名" value={account.username} readOnly />
            <TextInput
              label="显示名称"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button
                type="submit"
                loading={save.isPending}
                disabled={!name.trim() || name === account.name}
                variant="primary"
              >
                保存资料
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
