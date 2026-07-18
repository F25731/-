export const JOB_ERROR_CODES = {
    unsupportedType: "JOB_UNSUPPORTED_TYPE",
    missingApiKey: "JOB_MISSING_API_KEY",
    notFound: "JOB_NOT_FOUND",
    resultInvalid: "JOB_RESULT_INVALID",
    invalidBase64Result: "JOB_INVALID_BASE64_RESULT",
    referenceDownloadFailed: "JOB_REFERENCE_DOWNLOAD_FAILED",
    referenceUrlInaccessible: "JOB_REFERENCE_URL_INACCESSIBLE",
    referenceTooLarge: "JOB_REFERENCE_TOO_LARGE",
} as const;

export const AGENT_ERROR_CODES = {
    canvasOffline: "AGENT_CANVAS_OFFLINE",
    toolInvalid: "AGENT_TOOL_INVALID",
    toolTimeout: "AGENT_TOOL_TIMEOUT",
    approvalRequired: "AGENT_APPROVAL_REQUIRED",
    permissionDenied: "AGENT_PERMISSION_DENIED",
    revisionMismatch: "AGENT_REVISION_MISMATCH",
    toolCallDuplicate: "AGENT_TOOL_CALL_DUPLICATE",
} as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];
