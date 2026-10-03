import { useQuery } from '@tanstack/react-query';
import {
  Avatar,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api } from './api';
import { Loading, ErrorState } from './components';
export default function Account() {
  const q = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ username: string }>('/auth/me'),
  });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <Paper withBorder p="xl" className="account-panel">
      <Stack gap="xl">
        <Group>
          <Avatar size={64} radius="xl" color="victoria">
            {q.data.username.slice(0, 1).toUpperCase()}
          </Avatar>
          <Title order={3}>账户资料</Title>
        </Group>
        <TextInput label="用户名" value={q.data.username} readOnly />
        <Text size="sm" c="dimmed">
          管理员账户由首次启动配置创建。
        </Text>
      </Stack>
    </Paper>
  );
}
