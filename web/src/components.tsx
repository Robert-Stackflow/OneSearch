import { Alert } from '@robert-stackflow/oneui/Alert';
import { Badge } from '@robert-stackflow/oneui/Badge';
import { Button } from '@robert-stackflow/oneui/Button';
import {
  Center,
  Surface as Paper,
  Stack,
  Text,
} from '@robert-stackflow/oneui/Layout';
import { PageHeading } from '@robert-stackflow/oneui/Page';
import { EmptyState } from '@robert-stackflow/oneui/EmptyState';
import { SearchX } from 'lucide-react';
import { LoadingState } from '@robert-stackflow/oneui/LoadingState';
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
    <PageHeading
      title={title}
      description={description}
      titleExtra={titleExtra}
      actions={children}
    />
  );
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        value === 'running' || value === 'succeeded'
          ? 'success'
          : value === 'failed' || value === 'unhealthy'
            ? 'danger'
            : value === 'stopped' || value === 'archived'
              ? 'neutral'
              : 'accent'
      }
    >
      {stateLabels[value] || value}
    </Badge>
  );
}
export function Loading() {
  return (
    <Center mih={240}>
      <LoadingState showLabel={false} />
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
    <Alert title="暂时无法显示内容" tone={'danger'}>
      <Stack gap="sm">
        <Text size="sm">{error.message}</Text>
        <Button onClick={() => void retry()} variant="danger">
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
  embedded = false,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  embedded?: boolean;
}) {
  const content = (
    <EmptyState
      title={title}
      description={description}
      icon={<SearchX size={26} />}
      action={children}
    />
  );
  return embedded ? content : <Paper>{content}</Paper>;
}
