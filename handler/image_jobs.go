package handler

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/basketikun/infinite-canvas/config"
)

type imageJobStatus string

const (
	imageJobPending   imageJobStatus = "pending"
	imageJobRunning   imageJobStatus = "running"
	imageJobSucceeded imageJobStatus = "succeeded"
	imageJobFailed    imageJobStatus = "failed"
)

type imageJob struct {
	ID        string         `json:"id"`
	Status    imageJobStatus `json:"status"`
	Data      any            `json:"data,omitempty"`
	Error     string         `json:"error,omitempty"`
	CreatedAt int64          `json:"createdAt"`
	UpdatedAt int64          `json:"updatedAt"`
}

var imageJobs = struct {
	sync.RWMutex
	items map[string]imageJob
}{items: map[string]imageJob{}}

const (
	imageJobTTL     = 30 * time.Minute
	maxImageJobKeep = 300
)

func ImageJobCreate(w http.ResponseWriter, r *http.Request, kind string) {
	targetPath := imageJobTargetPath(kind)
	if targetPath == "" {
		http.Error(w, "unsupported image job type", http.StatusNotFound)
		return
	}
	token := bearerToken(r)
	if token == "" {
		Fail(w, "Missing pool API key")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		Fail(w, "Failed to read image job request")
		return
	}

	job := newImageJob()
	setImageJob(job)
	contentType := r.Header.Get("Content-Type")
	go runImageJob(job.ID, targetPath, token, contentType, body)

	OK(w, map[string]any{"id": job.ID, "status": job.Status})
}

func ImageJobStatus(w http.ResponseWriter, _ *http.Request, id string) {
	cleanupImageJobs()
	imageJobs.RLock()
	job, ok := imageJobs.items[id]
	imageJobs.RUnlock()
	if !ok {
		http.Error(w, "image job not found or expired", http.StatusNotFound)
		return
	}
	OK(w, job)
}

func runImageJob(id string, targetPath string, token string, contentType string, body []byte) {
	updateImageJob(id, imageJob{Status: imageJobRunning})
	payload, err := forwardPoolImageRequest(targetPath, token, contentType, body)
	if err != nil {
		updateImageJob(id, imageJob{Status: imageJobFailed, Error: err.Error()})
		return
	}
	updateImageJob(id, imageJob{Status: imageJobSucceeded, Data: payload})
}

func forwardPoolImageRequest(path string, token string, contentType string, body []byte) (any, error) {
	target := strings.TrimRight(config.Cfg.PoolAPIBaseURL, "/") + "/v1" + path
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

func imageJobTargetPath(kind string) string {
	switch kind {
	case "generations":
		return "/images/generations"
	case "edits":
		return "/images/edits"
	default:
		return ""
	}
}

func newImageJob() imageJob {
	now := time.Now().UnixMilli()
	return imageJob{ID: randomImageJobID(), Status: imageJobPending, CreatedAt: now, UpdatedAt: now}
}

func setImageJob(job imageJob) {
	cleanupImageJobs()
	imageJobs.Lock()
	imageJobs.items[job.ID] = job
	imageJobs.Unlock()
}

func updateImageJob(id string, patch imageJob) {
	imageJobs.Lock()
	defer imageJobs.Unlock()
	job, ok := imageJobs.items[id]
	if !ok {
		return
	}
	if patch.Status != "" {
		job.Status = patch.Status
	}
	if patch.Data != nil {
		job.Data = patch.Data
	}
	if patch.Error != "" {
		job.Error = patch.Error
	}
	job.UpdatedAt = time.Now().UnixMilli()
	imageJobs.items[id] = job
}

func cleanupImageJobs() {
	cutoff := time.Now().Add(-imageJobTTL).UnixMilli()
	imageJobs.Lock()
	defer imageJobs.Unlock()
	for id, job := range imageJobs.items {
		if job.UpdatedAt < cutoff {
			delete(imageJobs.items, id)
		}
	}
	if len(imageJobs.items) <= maxImageJobKeep {
		return
	}
	for id := range imageJobs.items {
		delete(imageJobs.items, id)
		if len(imageJobs.items) <= maxImageJobKeep {
			return
		}
	}
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

type imageJobError string

func (err imageJobError) Error() string {
	return string(err)
}
