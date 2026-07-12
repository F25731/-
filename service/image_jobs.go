package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/repository"
)

type ImageJobStatus string

const (
	ImageJobPending   ImageJobStatus = "pending"
	ImageJobRunning   ImageJobStatus = "running"
	ImageJobSucceeded ImageJobStatus = "succeeded"
	ImageJobFailed    ImageJobStatus = "failed"
)

type ImageJob struct {
	ID        string         `json:"id"`
	Status    ImageJobStatus  `json:"status"`
	Data      any            `json:"data,omitempty"`
	Error     string         `json:"error,omitempty"`
	CreatedAt int64          `json:"createdAt"`
	UpdatedAt int64          `json:"updatedAt"`
}

const (
	imageJobTTL        = 30 * time.Minute
	imageJobKeyPrefix  = "image-job:"
	imageJobKindImages = "generations"
	imageJobKindEdits  = "edits"
)

func CreateImageJob(request *http.Request, kind string, body []byte) (ImageJob, error) {
	targetPath := imageJobTargetPath(kind)
	if targetPath == "" {
		return ImageJob{}, safeMessageError{message: "unsupported image job type"}
	}
	token := bearerToken(request)
	if token == "" {
		return ImageJob{}, safeMessageError{message: "Missing pool API key"}
	}
	job := newImageJob()
	if err := saveImageJob(job); err != nil {
		return ImageJob{}, err
	}
	contentType := request.Header.Get("Content-Type")
	baseURL := imageJobBaseURL(request)
	go runImageJob(job.ID, targetPath, token, contentType, body, baseURL)
	return job, nil
}

func GetImageJob(id string) (ImageJob, bool, error) {
	return loadImageJob(id)
}

func runImageJob(id string, targetPath string, token string, contentType string, body []byte, baseURL string) {
	_ = updateImageJob(id, func(job *ImageJob) {
		job.Status = ImageJobRunning
	})
	payload, err := forwardPoolImageRequest(targetPath, token, contentType, body, baseURL)
	if err != nil {
		_ = updateImageJob(id, func(job *ImageJob) {
			job.Status = ImageJobFailed
			job.Error = err.Error()
		})
		return
	}
	_ = updateImageJob(id, func(job *ImageJob) {
		job.Status = ImageJobSucceeded
		job.Data = payload
		job.Error = ""
	})
}

func forwardPoolImageRequest(path string, token string, contentType string, body []byte, baseURL string) (any, error) {
	target := imageJobAPIURL(baseURL, path)
	request, err := http.NewRequest(http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	text, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	payload := parseImageJobPayload(text)
	if response.StatusCode >= http.StatusBadRequest {
		log.Printf("pool image request failed: url=%s status=%d body=%s", target, response.StatusCode, strings.TrimSpace(string(text)))
		return nil, imageJobError(readImageJobError(payload, response.StatusCode))
	}
	return payload, nil
}

func imageJobBaseURL(request *http.Request) string {
	value := strings.TrimSpace(request.Header.Get("x-image-api-base-url"))
	if value == "" {
		value = config.Cfg.PoolAPIBaseURL
	}
	return value
}

func imageJobAPIURL(baseURL string, path string) string {
	base := strings.TrimRight(baseURL, "/")
	if !strings.HasSuffix(base, "/v1") {
		base += "/v1"
	}
	return base + path
}

func imageJobTargetPath(kind string) string {
	switch kind {
	case imageJobKindImages:
		return "/images/generations"
	case imageJobKindEdits:
		return "/images/edits"
	default:
		return ""
	}
}

func newImageJob() ImageJob {
	now := time.Now().UnixMilli()
	return ImageJob{ID: randomImageJobID(), Status: ImageJobPending, CreatedAt: now, UpdatedAt: now}
}

func saveImageJob(job ImageJob) error {
	client, err := repository.Redis()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return client.Set(backgroundContext(), imageJobKey(job.ID), payload, imageJobTTL)
}

func loadImageJob(id string) (ImageJob, bool, error) {
	client, err := repository.Redis()
	if err != nil {
		return ImageJob{}, false, err
	}
	text, err := client.Get(backgroundContext(), imageJobKey(id))
	if err == nil {
		var job ImageJob
		if err := json.Unmarshal(text, &job); err != nil {
			return ImageJob{}, false, err
		}
		return job, true, nil
	}
	if err == repository.ErrRedisNil {
		return ImageJob{}, false, nil
	}
	return ImageJob{}, false, err
}

func updateImageJob(id string, mutate func(*ImageJob)) error {
	job, ok, err := loadImageJob(id)
	if err != nil || !ok {
		return err
	}
	mutate(&job)
	job.UpdatedAt = time.Now().UnixMilli()
	return saveImageJob(job)
}

func imageJobKey(id string) string {
	return imageJobKeyPrefix + id
}

func randomImageJobID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return time.Now().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(buf)
}

func bearerToken(r *http.Request) string {
	return strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
}

func parseImageJobPayload(text []byte) any {
	if len(text) == 0 {
		return nil
	}
	var payload any
	if err := json.Unmarshal(text, &payload); err != nil {
		return map[string]string{"message": string(text)}
	}
	return payload
}

func readImageJobError(payload any, status int) string {
	if data, ok := payload.(map[string]any); ok {
		if message, ok := data["msg"].(string); ok && message != "" {
			return message
		}
		if message, ok := data["message"].(string); ok && message != "" {
			return message
		}
		if errorText, ok := data["error"].(string); ok && errorText != "" {
			return errorText
		}
		if errorObject, ok := data["error"].(map[string]any); ok {
			if message, ok := errorObject["message"].(string); ok && message != "" {
				return message
			}
		}
	}
	return "Image generation failed, HTTP " + http.StatusText(status)
}

func backgroundContext() context.Context {
	return context.Background()
}

type imageJobError string

func (err imageJobError) Error() string {
	return string(err)
}
