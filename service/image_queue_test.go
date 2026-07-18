package service

import (
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
)

func TestImageJobQueuePayloadEncrypted(t *testing.T) {
	config.Cfg.JWTSecret = "test-secret"
	jobRequest := imageJobRequest{
		Path:        "/images/generations",
		Token:       "secret-token",
		ContentType: "application/json",
		Body:        []byte(`{"model":"gpt-image-2"}`),
		BaseURL:     "https://example.test",
		Model:       "gpt-image-2",
	}
	encoded, err := encodeImageJobRequest(jobRequest)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(encoded, "secret-token") {
		t.Fatal("encrypted queue payload should not expose the token")
	}
	decoded, err := decodeImageJobRequest(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Token != jobRequest.Token || decoded.Model != jobRequest.Model || string(decoded.Body) != string(jobRequest.Body) {
		t.Fatalf("decoded request mismatch: %#v", decoded)
	}
}
