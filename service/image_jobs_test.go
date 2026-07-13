package service

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestCompactImageJobPayloadDropsBase64WhenURLExists(t *testing.T) {
	item := map[string]any{"url": "https://example.test/image.png", "b64_json": "aW1hZ2U="}
	payload := map[string]any{"data": []any{item}}

	compacted, results, err := compactImageJobPayload("job", payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 0 {
		t.Fatalf("unexpected stored results: %d", len(results))
	}
	if _, ok := item["b64_json"]; ok {
		t.Fatal("b64_json should be removed when a URL exists")
	}
	encoded, err := json.Marshal(compacted)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) >= 1024 {
		t.Fatalf("compacted payload is too large: %d bytes", len(encoded))
	}
}

func TestCompactImageJobPayloadKeepsLargeStatusLightweight(t *testing.T) {
	item := map[string]any{"url": "https://example.test/image.png", "b64_json": strings.Repeat("A", 3<<20)}
	payload := map[string]any{"data": []any{item}}

	compacted, _, err := compactImageJobPayload("job", payload)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(compacted)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) >= 1024 {
		t.Fatalf("compacted payload is too large: %d bytes", len(encoded))
	}
}

func TestCompactImageJobPayloadMovesBase64ToResult(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nimage-data")
	item := map[string]any{"b64_json": base64.StdEncoding.EncodeToString(png)}
	payload := map[string]any{"data": []any{item}}

	_, results, err := compactImageJobPayload("job-123", payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("stored results = %d, want 1", len(results))
	}
	if results[0].ContentType != "image/png" || string(results[0].Data) != string(png) {
		t.Fatalf("unexpected stored result: %#v", results[0])
	}
	if item["url"] != "/api/image-jobs/result/job-123/0" {
		t.Fatalf("result URL = %v", item["url"])
	}
	if _, ok := item["b64_json"]; ok {
		t.Fatal("b64_json should be removed from the job status payload")
	}
}

func TestImageJobResultPacking(t *testing.T) {
	payload := packImageJobResult("image/webp", []byte("image"))
	contentType, data, ok := unpackImageJobResult(payload)
	if !ok || contentType != "image/webp" || string(data) != "image" {
		t.Fatalf("unpacked result = %q %q %v", contentType, data, ok)
	}
}

func TestCompactImageJobPayloadRejectsInvalidBase64(t *testing.T) {
	payload := map[string]any{"data": []any{map[string]any{"b64_json": "not-base64"}}}
	if _, _, err := compactImageJobPayload("job", payload); err == nil {
		t.Fatal("invalid base64 should fail the image job")
	}
}

func TestNewImageJobTracksWorker(t *testing.T) {
	job := newImageJob()
	if job.WorkerID == "" || job.WorkerID != imageJobWorkerID {
		t.Fatalf("worker ID = %q", job.WorkerID)
	}
}
