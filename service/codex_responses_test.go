package service

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBuildCodexResponsesBody(t *testing.T) {
	body, err := buildCodexResponsesBody(codexResponseRequest{
		ModelID:        "gpt-5.5",
		Task:           "请生成中文 JSON",
		ImageDataURL:   "data:image/png;base64,aGVsbG8=",
		PromptCacheKey: "test-cache-key",
		Timeout:        time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	var payload codexResponsesPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Stream || payload.Store {
		t.Fatalf("unexpected streaming flags: stream=%v store=%v", payload.Stream, payload.Store)
	}
	if !bytes.Contains(body, []byte(`"type":"input_image"`)) {
		t.Fatalf("request body does not include the image: %s", body)
	}
	if payload.Input[1].Content[0].Text != "请生成中文 JSON" {
		t.Fatalf("request body changed the task: %q", payload.Input[1].Content[0].Text)
	}
}

func TestFlattenPromptMessages(t *testing.T) {
	content := flattenPromptMessages([]any{
		map[string]any{"role": "developer", "content": "遵循格式"},
		map[string]any{"role": "user", "content": "生成详情方案"},
	})
	if content != "DEVELOPER:\n遵循格式\n\nUSER:\n生成详情方案" {
		t.Fatalf("unexpected flattened content: %q", content)
	}
}

func TestParseCodexResponsesStream(t *testing.T) {
	stream := strings.Join([]string{
		`event: response.output_text.delta`,
		`data: {"type":"response.output_text.delta","delta":"{\"title\":\"\u8be6"}`,
		``,
		`event: response.output_text.delta`,
		`data: {"type":"response.output_text.delta","delta":"\u60c5\"}"}`,
		``,
		`event: response.completed`,
		`data: {"type":"response.completed","response":{"status":"completed"}}`,
		``,
	}, "\n")
	content, err := parseCodexResponsesStream(strings.NewReader(stream))
	if err != nil {
		t.Fatal(err)
	}
	if normalized := normalizeCodexOutput(content); normalized != `{"title":"详情"}` {
		t.Fatalf("unexpected output: %q", normalized)
	}
}

func TestNormalizeCodexOutputUnwrapsQuotedText(t *testing.T) {
	if output := normalizeCodexOutput(`"正常"`); output != "正常" {
		t.Fatalf("unexpected normalized output: %q", output)
	}
}
