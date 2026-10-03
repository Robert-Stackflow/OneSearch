import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { stateLabels } from './api';
export function PageTitle({
  title,
  description,
  children,
  titleExtra,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  titleExtra?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="center" mb={28}>
      <div>
        <Group gap="lg">
          <Title order={2}>{title}</Title>
          {titleExtra}
        </Group>
        {description ? (
          <Text c="dimmed" size="sm" mt={8}>
            {description}
          </Text>
        ) : null}
      </div>
      {children}
    </Group>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      variant="light"
      color={
        value === 'running' || value === 'succeeded'
          ? 'teal'
          : value === 'failed' || value === 'unhealthy'
            ? 'red'
            : value === 'stopped' || value === 'archived'
              ? 'gray'
              : 'blue'
      }
    >
      {stateLabels[value] || value}
    </Badge>
  );
}
export function Loading() {
  return (
    <Center mih={240}>
      <Loader aria-label="正在加载" />
    </Center>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry: () => unknown;
}) {
  return (
    <Alert title="暂时无法显示内容" color="red">
      <Stack gap="sm">
        <Text size="sm">{error.message}</Text>
        <Button variant="light" color="red" onClick={() => void retry()}>
          重试
        </Button>
      </Stack>
    </Alert>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Paper withBorder p="xl">
      <Center mih={220}>
        <Stack align="center" gap="md">
          <SearchX size={34} strokeWidth={1.5} color="var(--os-muted)" />
          <Title order={4}>{title}</Title>
          {description ? (
            <Text c="dimmed" size="sm" ta="center" maw={420}>
              {description}
            </Text>
          ) : null}
          {children}
        </Stack>
      </Center>
    </Paper>
  );
}
