package service

type ErrorCode string

const (
	ErrorCodeJobUnsupportedType          ErrorCode = "JOB_UNSUPPORTED_TYPE"
	ErrorCodeJobMissingAPIKey            ErrorCode = "JOB_MISSING_API_KEY"
	ErrorCodeJobNotFound                 ErrorCode = "JOB_NOT_FOUND"
	ErrorCodeJobResultInvalid            ErrorCode = "JOB_RESULT_INVALID"
	ErrorCodeJobInvalidBase64Result      ErrorCode = "JOB_INVALID_BASE64_RESULT"
	ErrorCodeJobReferenceDownloadFailed  ErrorCode = "JOB_REFERENCE_DOWNLOAD_FAILED"
	ErrorCodeJobReferenceURLInaccessible ErrorCode = "JOB_REFERENCE_URL_INACCESSIBLE"
	ErrorCodeJobReferenceTooLarge        ErrorCode = "JOB_REFERENCE_TOO_LARGE"

	ErrorCodeAgentCanvasOffline     ErrorCode = "AGENT_CANVAS_OFFLINE"
	ErrorCodeAgentToolInvalid       ErrorCode = "AGENT_TOOL_INVALID"
	ErrorCodeAgentToolTimeout       ErrorCode = "AGENT_TOOL_TIMEOUT"
	ErrorCodeAgentApprovalRequired  ErrorCode = "AGENT_APPROVAL_REQUIRED"
	ErrorCodeAgentPermissionDenied  ErrorCode = "AGENT_PERMISSION_DENIED"
	ErrorCodeAgentRevisionMismatch  ErrorCode = "AGENT_REVISION_MISMATCH"
	ErrorCodeAgentToolCallDuplicate ErrorCode = "AGENT_TOOL_CALL_DUPLICATE"
)

func (code ErrorCode) String() string {
	return string(code)
}

func newSafeMessageError(code ErrorCode, message string) safeMessageError {
	return safeMessageError{code: code, message: message}
}
