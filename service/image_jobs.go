package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
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
	Status    ImageJobStatus `json:"status"`
	Data      any            `json:"data,omitempty"`
	Error     string         `json:"error,omitempty"`
	WorkerID  string         `json:"workerId,omitempty"`
	CreatedAt int64          `json:"createdAt"`
	UpdatedAt int64          `json:"updatedAt"`
}

const (
	imageJobTTL             = 30 * time.Minute
	imageJobKeyPrefix       = "image-job:"
	imageJobResultKeyPrefix = "image-job-result:"
	imageJobWorkerKeyPrefix = "image-job-worker:"
	imageJobKindImages      = "generations"
	imageJobKindEdits       = "edits"
	imageJobWorkerTTL       = 8 * time.Second
	imageJobHeartbeat       = 2 * time.Second
)

const (
	imageJobRequestModeJSON      = "json"
	imageJobRequestModeMultipart = "multipart"
	maxReferenceImageBytes       = 40 << 20
	imageJobRequestModeTTL       = 6 * time.Hour
)

var (
	imageJobHTTPClient = &http.Client{
		Timeout: 8 * time.Minute,
		Transport: &http.Transport{
			MaxIdleConns:        2048,
			MaxIdleConnsPerHost: 512,
			IdleConnTimeout:     90 * time.Second,
		},
	}
	imageJobDownloadClient = &http.Client{
		Timeout: 60 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        512,
			MaxIdleConnsPerHost: 128,
			IdleConnTimeout:     60 * time.Second,
		},
	}
	imageJobModeCache              sync.Map
	imageJobReferenceDownloadSlots = make(chan struct{}, 512)
	imageJobWorkerID               = randomImageJobID()
	imageJobWorkerOnce             sync.Once
)

type imageJobRequest struct {
	Path        string
	Token       string
	ContentType string
	Body        []byte
	BaseURL     string
	JSON        map[string]any
	Model       string
	Images      []string
}

type imageJobRequestModeCacheEntry struct {
	Mode      string
	ExpiresAt time.Time
}

type imageJobStoredResult struct {
	Index       int
	ContentType string
	Data        []byte
}

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
	jobRequest := imageJobRequest{
		Path:        targetPath,
		Token:       token,
		ContentType: request.Header.Get("Content-Type"),
		Body:        body,
		BaseURL:     imageJobBaseURL(request),
	}
	jobRequest.JSON, jobRequest.Model, jobRequest.Images = parseImageJobJSONRequest(body)
	go runImageJob(job.ID, jobRequest)
	return job, nil
}

func GetImageJob(id string) (ImageJob, bool, error) {
	job, ok, err := loadImageJob(id)
	if err != nil || !ok || (job.Status != ImageJobPending && job.Status != ImageJobRunning) || job.WorkerID == imageJobWorkerID {
		return job, ok, err
	}
	alive, err := imageJobWorkerAlive(job.WorkerID)
	if err != nil || alive {
		return job, ok, err
	}
	job.Status = ImageJobFailed
	job.Error = "图片任务执行服务已重启，请重新生成"
	job.UpdatedAt = time.Now().UnixMilli()
	if err := saveImageJob(job); err != nil {
		return ImageJob{}, false, err
	}
	return job, true, nil
}

func StartImageJobWorker() {
	imageJobWorkerOnce.Do(func() {
		writeImageJobWorkerHeartbeat()
		go func() {
			ticker := time.NewTicker(imageJobHeartbeat)
			defer ticker.Stop()
			for range ticker.C {
				writeImageJobWorkerHeartbeat()
			}
		}()
	})
}

func writeImageJobWorkerHeartbeat() {
	client, err := repository.Redis()
	if err == nil {
		err = client.Set(backgroundContext(), imageJobWorkerKey(imageJobWorkerID), []byte("1"), imageJobWorkerTTL)
	}
	if err != nil {
		log.Printf("image job worker heartbeat failed: %v", err)
	}
}

func imageJobWorkerAlive(workerID string) (bool, error) {
	if workerID == "" {
		return false, nil
	}
	client, err := repository.Redis()
	if err != nil {
		return false, err
	}
	_, err = client.Get(backgroundContext(), imageJobWorkerKey(workerID))
	if err == repository.ErrRedisNil {
		return false, nil
	}
	return err == nil, err
}

func runImageJob(id string, jobRequest imageJobRequest) {
	_ = updateImageJob(id, func(job *ImageJob) {
		job.Status = ImageJobRunning
	})
	payload, err := forwardPoolImageRequest(jobRequest)
	if err != nil {
		_ = updateImageJob(id, func(job *ImageJob) {
			job.Status = ImageJobFailed
			job.Error = err.Error()
		})
		return
	}
	payload, results, err := compactImageJobPayload(id, payload)
	if err == nil {
		err = saveImageJobResults(id, results)
	}
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

func GetImageJobResult(id string, index int) ([]byte, string, bool, error) {
	client, err := repository.Redis()
	if err != nil {
		return nil, "", false, err
	}
	payload, err := client.Get(backgroundContext(), imageJobResultKey(id, index))
	if err == repository.ErrRedisNil {
		return nil, "", false, nil
	}
	if err != nil {
		return nil, "", false, err
	}
	contentType, data, ok := unpackImageJobResult(payload)
	if !ok {
		return nil, "", false, safeMessageError{message: "invalid image job result"}
	}
	return data, contentType, true, nil
}

func compactImageJobPayload(id string, payload any) (any, []imageJobStoredResult, error) {
	object, ok := payload.(map[string]any)
	if !ok {
		return payload, nil, nil
	}
	items, ok := object["data"].([]any)
	if !ok {
		return payload, nil, nil
	}

	results := []imageJobStoredResult{}
	for index, value := range items {
		item, ok := value.(map[string]any)
		if !ok {
			continue
		}
		encoded, _ := item["b64_json"].(string)
		encoded = strings.TrimSpace(encoded)
		if encoded == "" {
			delete(item, "b64_json")
			continue
		}
		if imageURL, _ := item["url"].(string); strings.TrimSpace(imageURL) != "" {
			delete(item, "b64_json")
			continue
		}

		data, contentType, err := decodeImageJobBase64(encoded)
		if err != nil {
			return nil, nil, safeMessageError{message: "invalid base64 image result"}
		}
		results = append(results, imageJobStoredResult{Index: index, ContentType: contentType, Data: data})
		item["url"] = fmt.Sprintf("/api/image-jobs/result/%s/%d", id, index)
		delete(item, "b64_json")
	}
	return payload, results, nil
}

func saveImageJobResults(id string, results []imageJobStoredResult) error {
	if len(results) == 0 {
		return nil
	}
	client, err := repository.Redis()
	if err != nil {
		return err
	}
	for _, result := range results {
		if err := client.Set(backgroundContext(), imageJobResultKey(id, result.Index), packImageJobResult(result.ContentType, result.Data), imageJobTTL); err != nil {
			return err
		}
	}
	return nil
}

func decodeImageJobBase64(value string) ([]byte, string, error) {
	contentType := ""
	if strings.HasPrefix(value, "data:") {
		header, encoded, ok := strings.Cut(value, ",")
		if !ok || !strings.Contains(header, ";base64") {
			return nil, "", errors.New("invalid data url")
		}
		contentType = strings.TrimPrefix(strings.SplitN(header, ";", 2)[0], "data:")
		value = encoded
	}
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		data, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil {
		return nil, "", err
	}
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(data)
	}
	if !strings.HasPrefix(contentType, "image/") {
		contentType = "image/png"
	}
	return data, contentType, nil
}

func packImageJobResult(contentType string, data []byte) []byte {
	return append([]byte(contentType+"\n"), data...)
}

func unpackImageJobResult(payload []byte) (string, []byte, bool) {
	index := bytes.IndexByte(payload, '\n')
	if index <= 0 || index == len(payload)-1 {
		return "", nil, false
	}
	contentType := string(payload[:index])
	if !strings.HasPrefix(contentType, "image/") {
		return "", nil, false
	}
	return contentType, payload[index+1:], true
}

func forwardPoolImageRequest(jobRequest imageJobRequest) (any, error) {
	if jobRequest.JSON == nil || len(jobRequest.Images) == 0 || jobRequest.Path != "/images/edits" {
		return doPoolImageRequest(jobRequest.Path, jobRequest.Token, normalizedContentType(jobRequest.ContentType, jobRequest.JSON != nil), bytes.NewReader(jobRequest.Body), jobRequest.BaseURL)
	}

	cacheKey := imageJobModeCacheKey(jobRequest)
	if mode, ok := imageJobCachedMode(cacheKey); ok && mode == imageJobRequestModeMultipart {
		payload, err := doMultipartPoolImageRequest(jobRequest)
		if err == nil {
			return payload, nil
		}
		if shouldRetryImageJobWithJSON(err.Error()) {
			payload, jsonErr := doJSONPoolImageRequest(jobRequest)
			if jsonErr == nil {
				storeImageJobCachedMode(cacheKey, imageJobRequestModeJSON)
				return payload, nil
			}
			return nil, jsonErr
		}
		return nil, err
	}

	payload, err := doJSONPoolImageRequest(jobRequest)
	if err == nil {
		storeImageJobCachedMode(cacheKey, imageJobRequestModeJSON)
		return payload, nil
	}
	if !shouldRetryImageJobWithMultipart(err.Error()) {
		return nil, err
	}
	log.Printf("pool image request retrying as multipart: path=%s model=%s error=%s", jobRequest.Path, jobRequest.Model, err.Error())
	payload, multipartErr := doMultipartPoolImageRequest(jobRequest)
	if multipartErr == nil {
		storeImageJobCachedMode(cacheKey, imageJobRequestModeMultipart)
		return payload, nil
	}
	return nil, multipartErr
}

func doJSONPoolImageRequest(jobRequest imageJobRequest) (any, error) {
	return doPoolImageRequest(jobRequest.Path, jobRequest.Token, "application/json", bytes.NewReader(jobRequest.Body), jobRequest.BaseURL)
}

func doMultipartPoolImageRequest(jobRequest imageJobRequest) (any, error) {
	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	go func() {
		if err := writeImageJobMultipart(multipartWriter, jobRequest); err != nil {
			_ = writer.CloseWithError(err)
			return
		}
		if closeErr := multipartWriter.Close(); closeErr != nil {
			_ = writer.CloseWithError(closeErr)
			return
		}
		_ = writer.Close()
	}()
	return doPoolImageRequest(jobRequest.Path, jobRequest.Token, multipartWriter.FormDataContentType(), reader, jobRequest.BaseURL)
}

func doPoolImageRequest(targetPath string, token string, contentType string, body io.Reader, baseURL string) (any, error) {
	target := imageJobAPIURL(baseURL, targetPath)
	request, err := http.NewRequest(http.MethodPost, target, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}

	response, err := imageJobHTTPClient.Do(request)
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

func writeImageJobMultipart(writer *multipart.Writer, jobRequest imageJobRequest) error {
	for key, value := range jobRequest.JSON {
		if isImageReferenceField(key) {
			continue
		}
		fieldValue, ok := imageJobMultipartFieldValue(value)
		if !ok {
			continue
		}
		if err := writer.WriteField(key, fieldValue); err != nil {
			return err
		}
	}
	for index, imageURL := range jobRequest.Images {
		if err := writeImageJobMultipartImage(writer, imageURL, index); err != nil {
			return err
		}
	}
	return nil
}

func writeImageJobMultipartImage(writer *multipart.Writer, imageURL string, index int) error {
	imageJobReferenceDownloadSlots <- struct{}{}
	defer func() { <-imageJobReferenceDownloadSlots }()

	request, err := http.NewRequestWithContext(backgroundContext(), http.MethodGet, imageURL, nil)
	if err != nil {
		return err
	}
	response, err := imageJobDownloadClient.Do(request)
	if err != nil {
		return safeMessageError{message: "reference image download failed"}
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return safeMessageError{message: "reference image url is not accessible"}
	}
	if response.ContentLength > maxReferenceImageBytes {
		return safeMessageError{message: "reference image is too large"}
	}
	part, err := writer.CreateFormFile("image", imageJobFileName(imageURL, response.Header.Get("Content-Type"), index))
	if err != nil {
		return err
	}
	written, err := io.Copy(part, io.LimitReader(response.Body, maxReferenceImageBytes+1))
	if err != nil {
		return err
	}
	if written > maxReferenceImageBytes {
		return safeMessageError{message: "reference image is too large"}
	}
	return nil
}

func parseImageJobJSONRequest(body []byte) (map[string]any, string, []string) {
	if !looksLikeJSON(body) {
		return nil, "", nil
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, "", nil
	}
	modelName, _ := payload["model"].(string)
	return payload, strings.TrimSpace(modelName), extractImageJobReferenceURLs(payload)
}

func extractImageJobReferenceURLs(payload map[string]any) []string {
	seen := map[string]bool{}
	result := []string{}
	add := func(value string) {
		value = strings.TrimSpace(value)
		if !isHTTPURL(value) || seen[value] {
			return
		}
		seen[value] = true
		result = append(result, value)
	}
	for _, key := range []string{"image_url", "image"} {
		switch value := payload[key].(type) {
		case string:
			add(value)
		case map[string]any:
			if urlValue, ok := value["url"].(string); ok {
				add(urlValue)
			}
			if urlValue, ok := value["image_url"].(string); ok {
				add(urlValue)
			}
		}
	}
	if values, ok := payload["images"].([]any); ok {
		for _, item := range values {
			switch value := item.(type) {
			case string:
				add(value)
			case map[string]any:
				if urlValue, ok := value["image_url"].(string); ok {
					add(urlValue)
				}
				if urlValue, ok := value["url"].(string); ok {
					add(urlValue)
				}
			}
		}
	}
	return result
}

func imageJobMultipartFieldValue(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, true
	case bool:
		return strconv.FormatBool(typed), true
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10), true
		}
		return strconv.FormatFloat(typed, 'f', -1, 64), true
	case nil:
		return "", false
	default:
		text, err := json.Marshal(typed)
		if err != nil {
			return "", false
		}
		return string(text), true
	}
}

func imageJobFileName(imageURL string, contentType string, index int) string {
	parsed, err := url.Parse(imageURL)
	if err == nil {
		name := path.Base(parsed.Path)
		if name != "." && name != "/" && strings.Contains(name, ".") {
			return name
		}
	}
	extension := ".png"
	if strings.Contains(contentType, "jpeg") || strings.Contains(contentType, "jpg") {
		extension = ".jpg"
	} else if strings.Contains(contentType, "webp") {
		extension = ".webp"
	}
	return fmt.Sprintf("reference-%d%s", index+1, extension)
}

func imageJobModeCacheKey(jobRequest imageJobRequest) string {
	tokenHash := sha256.Sum256([]byte(jobRequest.Token))
	return strings.Join([]string{
		strings.TrimRight(jobRequest.BaseURL, "/"),
		jobRequest.Path,
		jobRequest.Model,
		hex.EncodeToString(tokenHash[:8]),
	}, "|")
}

func imageJobCachedMode(key string) (string, bool) {
	value, ok := imageJobModeCache.Load(key)
	if !ok {
		return "", false
	}
	entry, ok := value.(imageJobRequestModeCacheEntry)
	if !ok || time.Now().After(entry.ExpiresAt) {
		imageJobModeCache.Delete(key)
		return "", false
	}
	return entry.Mode, true
}

func storeImageJobCachedMode(key string, mode string) {
	imageJobModeCache.Store(key, imageJobRequestModeCacheEntry{Mode: mode, ExpiresAt: time.Now().Add(imageJobRequestModeTTL)})
}

func shouldRetryImageJobWithMultipart(message string) bool {
	text := strings.ToLower(message)
	retryHints := []string{
		"multipart boundary not found",
		"missing boundary",
		"invalid content-type",
		"image_url fetch failed",
		"unsupported image_url",
		"invalid_image_input",
		"could not download image",
		"download image failed",
		"failed to fetch image",
		"unable to fetch image",
	}
	for _, hint := range retryHints {
		if strings.Contains(text, hint) {
			return true
		}
	}
	return false
}

func shouldRetryImageJobWithJSON(message string) bool {
	text := strings.ToLower(message)
	retryHints := []string{
		"unsupported multipart",
		"multipart not supported",
		"file upload not supported",
		"unsupported file",
		"expected json",
	}
	for _, hint := range retryHints {
		if strings.Contains(text, hint) {
			return true
		}
	}
	return false
}

func normalizedContentType(contentType string, isJSON bool) string {
	if isJSON {
		return "application/json"
	}
	return contentType
}

func looksLikeJSON(body []byte) bool {
	return bytes.HasPrefix(bytes.TrimSpace(body), []byte("{"))
}

func isImageReferenceField(key string) bool {
	switch key {
	case "image", "images", "image_url":
		return true
	default:
		return false
	}
}

func isHTTPURL(value string) bool {
	return strings.HasPrefix(strings.ToLower(value), "http://") || strings.HasPrefix(strings.ToLower(value), "https://")
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
	return ImageJob{ID: randomImageJobID(), Status: ImageJobPending, WorkerID: imageJobWorkerID, CreatedAt: now, UpdatedAt: now}
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

func imageJobResultKey(id string, index int) string {
	return fmt.Sprintf("%s%s:%d", imageJobResultKeyPrefix, id, index)
}

func imageJobWorkerKey(id string) string {
	return imageJobWorkerKeyPrefix + id
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
