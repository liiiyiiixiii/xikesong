import { z } from 'zod';
import { version, uuid } from './common.ts';

export const errorDefinitions = {
  INVALID_REQUEST: { status: 400, retryable: false, message: '请求格式不正确' },
  UNAUTHENTICATED: { status: 401, retryable: false, message: '请先完成认证' },
  FORBIDDEN: { status: 403, retryable: false, message: '没有执行该操作的权限' },
  NOT_FOUND: { status: 404, retryable: false, message: '请求的对象不存在' },
  METHOD_NOT_ALLOWED: { status: 405, retryable: false, message: '接口不支持此方法' },
  VERSION_CONFLICT: { status: 409, retryable: false, message: '记录已更新，请刷新后重试' },
  ID_CONFLICT: { status: 409, retryable: false, message: '同一请求编号不能使用不同内容' },
  INVALID_TRANSITION: { status: 409, retryable: false, message: '当前状态不允许此操作' },
  REPORT_REVISION_CHANGED: { status: 409, retryable: false, message: '报表版本已更新，请刷新后导出' },
  REPORT_REBUILDING: { status: 409, retryable: false, message: '报表正在更新，请稍后刷新' },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, message: '请求内容过大' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, retryable: false, message: '请使用 application/json' },
  RATE_LIMITED: { status: 429, retryable: true, message: '请求过于频繁，请稍后重试' },
  INTERNAL_ERROR: { status: 500, retryable: false, message: '处理失败，请保留请求编号以便核对' },
  NOT_IMPLEMENTED: { status: 501, retryable: false, message: '当前仅提供接口契约，业务服务尚未启用，数据未保存' },
  UNAVAILABLE: { status: 503, retryable: true, message: '服务暂不可用，请稍后重试' },
} as const;
export type ErrorCode = keyof typeof errorDefinitions;
export const errorCode = z.enum(Object.keys(errorDefinitions) as [ErrorCode, ...ErrorCode[]]);
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCode, message: z.string().min(1).max(500), retryable: z.boolean(),
    currentVersion: version.optional(), retryAfterSeconds: z.number().int().positive().max(3600).optional(),
    issues: z.array(z.object({ path: z.string().max(300), message: z.string().max(500) }).strict()).max(50).optional(),
  }).strict(),
  requestId: uuid.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.error.retryable !== errorDefinitions[v.error.code].retryable) ctx.addIssue({ code: 'custom', path: ['error', 'retryable'], message: '重试标记与错误码不一致' });
  if (v.error.retryable && !v.error.retryAfterSeconds) ctx.addIssue({ code: 'custom', path: ['error', 'retryAfterSeconds'], message: '可重试错误需要等待时间' });
});
export type ApiErrorResponse = z.infer<typeof errorResponseSchema>;
export function apiError(code: ErrorCode, requestId: string | null = null, extra: Partial<Pick<ApiErrorResponse['error'], 'issues' | 'currentVersion' | 'retryAfterSeconds'>> = {}): ApiErrorResponse {
  const definition = errorDefinitions[code];
  return errorResponseSchema.parse({ requestId, error: {
    code, message: definition.message, retryable: definition.retryable,
    ...(definition.retryable ? { retryAfterSeconds: 5 } : {}), ...extra,
  } });
}
