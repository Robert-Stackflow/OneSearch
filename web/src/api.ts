import { notifications } from '@mantine/notifications';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-OneSearch-Request', '1');
  const response = await fetch('/api' + path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (response.status === 204) return null as T;
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(body.error?.message || '请求失败', response.status);
  return body.data as T;
}
export function notifyError(error: unknown) {
  notifications.show({
    title: '操作未完成',
    message: error instanceof Error ? error.message : String(error),
    color: 'red',
  });
}
export function notifySuccess(message: string) {
  notifications.show({ title: '已完成', message, color: 'teal' });
}
export interface AccountInfo {
  username: string;
  name: string;
  avatarUrl: string;
  mode: string;
}
export interface Instance {
  id: string;
  name: string;
  description: string;
  provider: 'native' | 'docker' | 'external';
  host: string;
  port: number;
  memoryMB: number;
  threads: number;
  status: string;
  desiredState: string;
  version: string;
  error?: string;
  createdAt: string;
  canControl: boolean;
}
export interface Operation {
  id: string;
  instanceId: string;
  instanceName: string;
  action: string;
  status: string;
  message: string;
  createdAt: string;
  finishedAt?: string;
}
export interface Index {
  uid: string;
  primaryKey: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Task {
  uid: number;
  status: string;
  type: string;
  indexUid: string | null;
  enqueuedAt: string;
  duration: string | null;
  error?: { message: string } | null;
}
export interface TaskRef {
  taskUid: number;
  status: string;
}
export interface APIKey {
  uid: string;
  name: string | null;
  description: string | null;
  actions: string[];
  indexes: string[];
  expiresAt: string | null;
  createdAt: string;
  key?: string;
}
export interface Page<T> {
  results: T[];
  total: number;
  limit: number;
  offset?: number;
  next?: number | null;
}
export interface System {
  mode: string;
  runtime: string;
  runtimeAvailable: boolean;
  engineVersion: string;
  dockerAvailable: boolean;
  origin: string;
}
export function engine<T>(
  id: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return api(`/instances/${id}/engine/${path}`, init);
}
export async function waitTask(id: string, task: TaskRef): Promise<Task> {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const t = await engine<Task>(id, `tasks/${task.taskUid}`);
    if (t.status === 'succeeded') return t;
    if (t.status === 'failed' || t.status === 'canceled')
      throw new Error(t.error?.message || '索引任务未成功');
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('任务仍在处理中，请到任务页查看最终状态');
}
export const stateLabels: Record<string, string> = {
  running: '运行中',
  stopped: '已停止',
  failed: '失败',
  archived: '已归档',
  provisioning: '创建中',
  starting: '启动中',
  stopping: '停止中',
  unhealthy: '连接异常',
  queued: '等待执行',
  succeeded: '成功',
  enqueued: '等待执行',
  processing: '处理中',
  canceled: '已取消',
};
export const actionLabels: Record<string, string> = {
  start: '启动',
  stop: '停止',
  restart: '重启',
  archive: '归档',
};
export function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
