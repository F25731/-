package service

import "testing"

func TestSafeMessageErrorCarriesCodeWithoutChangingMessage(t *testing.T) {
	err := newSafeMessageError(ErrorCodeJobMissingAPIKey, "Missing pool API key")
	if err.Error() != "Missing pool API key" || err.SafeMessage() != "Missing pool API key" {
		t.Fatalf("unexpected safe message: error=%q safe=%q", err.Error(), err.SafeMessage())
	}
	if err.Code() != "JOB_MISSING_API_KEY" {
		t.Fatalf("unexpected code: %q", err.Code())
	}
}

func TestAgentErrorCodesBaseline(t *testing.T) {
	if ErrorCodeAgentCanvasOffline.String() != "AGENT_CANVAS_OFFLINE" {
		t.Fatalf("unexpected canvas offline code: %q", ErrorCodeAgentCanvasOffline.String())
	}
	if ErrorCodeAgentRevisionMismatch.String() != "AGENT_REVISION_MISMATCH" {
		t.Fatalf("unexpected revision mismatch code: %q", ErrorCodeAgentRevisionMismatch.String())
	}
}
