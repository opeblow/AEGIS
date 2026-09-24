/**
 * Contract for the standardized error envelope every Aegis API error returns.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
