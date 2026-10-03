import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Button,
  FileButton,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Upload } from 'lucide-react';
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
            src={account.avatarUrl || undefined}
            size={64}
            radius="xl"
            color="victoria"
          >
            {account.name.slice(0, 1).toUpperCase()}
          </Avatar>
          <Title order={3}>账户资料</Title>
        </Group>
        <Group className="profile-upload">
          <FileButton
            onChange={(file) => {
              if (file) upload.mutate(file);
            }}
            accept="image/jpeg,image/png,image/gif"
          >
            {(props) => (
              <Button
                {...props}
                variant="light"
                loading={upload.isPending}
                leftSection={<Upload size={16} />}
              >
                上传头像
              </Button>
            )}
          </FileButton>
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
