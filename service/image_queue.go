package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/repository"
)

const (
	imageJobQueueStream = "queue:image-jobs:v2"
	imageJobQueueGroup  = "image-workers"
)

var (
	imageJobQueueOnce sync.Once

	imageJobCancelMu  sync.Mutex
	imageJobCancelers = map[string]context.CancelFunc{}

	imageJobLimiterOnce  sync.Once
	imageJobLimiterState *imageJobLimiter
)

type imageJobLimiter struct {
	global chan struct{}
	mu     sync.Mutex
	users  map[string]chan struct{}
	models map[string]chan struct{}
}

func createQueuedImageJob(request *http.Request, kind string, targetPath string, token string, body []byte) (ImageJob, error) {
	client, err := repository.Redis()
	if err != nil {
		return ImageJob{}, err
	}
	idempotencyKey := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if idempotencyKey != "" {
		key := imageJobIdempotencyKey(kind, token, idempotencyKey)
		if payload, err := client.Get(backgroundContext(), key); err == nil {
			if job, ok, loadErr := loadImageJob(string(payload)); loadErr == nil && ok {
				return job, nil
			}
		}
	}

	job := newImageJob()
	job.WorkerID = ""
	if idempotencyKey != "" {
		key := imageJobIdempotencyKey(kind, token, idempotencyKey)
		ok, err := client.SetNX(backgroundContext(), key, []byte(job.ID), imageJobTTL)
		if err != nil {
			return ImageJob{}, err
		}
		if !ok {
			payload, err := client.Get(backgroundContext(), key)
			if err == nil {
				if existing, ok, loadErr := loadImageJob(string(payload)); loadErr == nil && ok {
					return existing, nil
				}
			}
		}
	}
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
	payload, err := encodeImageJobRequest(jobRequest)
	if err != nil {
		return ImageJob{}, err
	}
	if _, err := client.XAdd(backgroundContext(), imageJobQueueStream, map[string]string{"jobId": job.ID, "payload": payload}); err != nil {
		_ = updateImageJob(job.ID, func(item *ImageJob) {
			item.Status = ImageJobFailed
			item.Error = "图片任务入队失败"
		})
		return ImageJob{}, err
	}
	publishImageJobEvent(EventTypeJobQueued, job)
	return job, nil
}

func startImageJobQueueWorkers() {
	imageJobQueueOnce.Do(func() {
		go runImageJobQueueWorkers()
	})
}

func runImageJobQueueWorkers() {
	for {
		client, err := repository.Redis()
		if err != nil {
			log.Printf("image job queue init failed: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}
		if err := client.XGroupCreateMkStream(backgroundContext(), imageJobQueueStream, imageJobQueueGroup); err != nil {
			log.Printf("image job queue group init failed: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}
		workers := positiveInt(config.Cfg.ImageWorkers, 32)
		for i := 0; i < workers; i++ {
			consumer := imageJobWorkerID + "-" + strconv.Itoa(i+1)
			go imageJobQueueWorker(consumer)
		}
		log.Printf("image job queue workers started: workers=%d global=%d perUser=%d perModel=%d", workers, positiveInt(config.Cfg.ImageGlobalConcurrency, 32), positiveInt(config.Cfg.ImagePerUserConcurrency, 4), positiveInt(config.Cfg.ImagePerModelConcurrency, 12))
		return
	}
}

func imageJobQueueWorker(consumer string) {
	claimStart := "0-0"
	for {
		client, err := repository.Redis()
		if err != nil {
			log.Printf("image job queue redis unavailable: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}
		messages, nextClaimStart, err := client.XAutoClaim(backgroundContext(), imageJobQueueStream, imageJobQueueGroup, consumer, imageJobPendingMinIdle(), claimStart, 1)
		claimStart = nextClaimStart
		if claimStart == "0-0" || claimStart == "0" {
			claimStart = "0-0"
		}
		if err != nil {
			log.Printf("image job queue reclaim failed: %v", err)
		}
		if len(messages) == 0 {
			ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
			messages, err = client.XReadGroup(ctx, imageJobQueueStream, imageJobQueueGroup, consumer, 1, 5*time.Second)
			cancel()
		}
		if err != nil {
			log.Printf("image job queue read failed: %v", err)
			time.Sleep(time.Second)
			continue
		}
		for _, message := range messages {
			if err := handleQueuedImageJob(message); err != nil {
				log.Printf("image job queue handle failed: streamId=%s error=%v", message.ID, err)
			}
			if err := client.XAck(backgroundContext(), imageJobQueueStream, imageJobQueueGroup, message.ID); err != nil {
				log.Printf("image job queue ack failed: streamId=%s error=%v", message.ID, err)
			}
		}
	}
}

func imageJobPendingMinIdle() time.Duration {
	return time.Duration(positiveInt(config.Cfg.ImageJobTimeoutSeconds, 480)+60) * time.Second
}

func handleQueuedImageJob(message repository.RedisStreamMessage) error {
	jobID := strings.TrimSpace(message.Values["jobId"])
	payload := strings.TrimSpace(message.Values["payload"])
	if jobID == "" || payload == "" {
		return errors.New("invalid image queue message")
	}
	jobRequest, err := decodeImageJobRequest(payload)
	if err != nil {
		_ = updateImageJob(jobID, func(job *ImageJob) {
			job.Status = ImageJobFailed
			job.Error = "图片任务载荷解析失败"
		})
		return err
	}
	if imageJobCanceled(jobID) {
		return nil
	}
	release, err := imageJobLimiterInstance().acquire(backgroundContext(), imageJobUserKey(jobRequest.Token), imageJobModelKey(jobRequest.Model))
	if err != nil {
		return err
	}
	defer release()

	if imageJobCanceled(jobID) {
		return nil
	}
	timeout := time.Duration(positiveInt(config.Cfg.ImageJobTimeoutSeconds, 480)) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	registerImageJobCancel(jobID, cancel)
	runImageJobWithContext(ctx, jobID, jobRequest)
	unregisterImageJobCancel(jobID)
	cancel()
	return nil
}

func CancelImageJob(id string) (ImageJob, bool, error) {
	job, ok, err := loadImageJob(id)
	if err != nil || !ok {
		return job, ok, err
	}
	if job.Status == ImageJobSucceeded || job.Status == ImageJobFailed || job.Status == ImageJobCanceled {
		return job, true, nil
	}
	job.Status = ImageJobCanceled
	job.Error = "图片任务已取消"
	job.UpdatedAt = time.Now().UnixMilli()
	if err := saveImageJob(job); err != nil {
		return ImageJob{}, false, err
	}
	publishImageJobEvent(EventTypeJobCanceled, job)
	imageJobCancelMu.Lock()
	cancel := imageJobCancelers[id]
	imageJobCancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
	return job, true, nil
}

func imageJobCanceled(id string) bool {
	job, ok, err := loadImageJob(id)
	return err == nil && ok && job.Status == ImageJobCanceled
}

func registerImageJobCancel(id string, cancel context.CancelFunc) {
	imageJobCancelMu.Lock()
	imageJobCancelers[id] = cancel
	imageJobCancelMu.Unlock()
}

func unregisterImageJobCancel(id string) {
	imageJobCancelMu.Lock()
	delete(imageJobCancelers, id)
	imageJobCancelMu.Unlock()
}

func imageJobLimiterInstance() *imageJobLimiter {
	imageJobLimiterOnce.Do(func() {
		imageJobLimiterState = &imageJobLimiter{
			global: make(chan struct{}, positiveInt(config.Cfg.ImageGlobalConcurrency, 32)),
			users:  map[string]chan struct{}{},
			models: map[string]chan struct{}{},
		}
	})
	return imageJobLimiterState
}

func (limiter *imageJobLimiter) acquire(ctx context.Context, user string, model string) (func(), error) {
	releases := []func(){}
	acquire := func(ch chan struct{}) error {
		select {
		case ch <- struct{}{}:
			releases = append(releases, func() { <-ch })
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if err := acquire(limiter.global); err != nil {
		return nil, err
	}
	if err := acquire(limiter.userSlot(user)); err != nil {
		releaseAll(releases)
		return nil, err
	}
	if err := acquire(limiter.modelSlot(model)); err != nil {
		releaseAll(releases)
		return nil, err
	}
	return func() { releaseAll(releases) }, nil
}

func (limiter *imageJobLimiter) userSlot(user string) chan struct{} {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if user == "" {
		user = "unknown"
	}
	if limiter.users[user] == nil {
		limiter.users[user] = make(chan struct{}, positiveInt(config.Cfg.ImagePerUserConcurrency, 4))
	}
	return limiter.users[user]
}

func (limiter *imageJobLimiter) modelSlot(model string) chan struct{} {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if model == "" {
		model = "default"
	}
	if limiter.models[model] == nil {
		limiter.models[model] = make(chan struct{}, positiveInt(config.Cfg.ImagePerModelConcurrency, 12))
	}
	return limiter.models[model]
}

func releaseAll(releases []func()) {
	for i := len(releases) - 1; i >= 0; i-- {
		releases[i]()
	}
}

func encodeImageJobRequest(jobRequest imageJobRequest) (string, error) {
	payload, err := json.Marshal(jobRequest)
	if err != nil {
		return "", err
	}
	aead, err := imageJobQueueCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, payload, nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func decodeImageJobRequest(value string) (imageJobRequest, error) {
	var jobRequest imageJobRequest
	payload, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return jobRequest, err
	}
	aead, err := imageJobQueueCipher()
	if err != nil {
		return jobRequest, err
	}
	if len(payload) < aead.NonceSize() {
		return jobRequest, errors.New("invalid encrypted image job payload")
	}
	nonce := payload[:aead.NonceSize()]
	ciphertext := payload[aead.NonceSize():]
	plain, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return jobRequest, err
	}
	err = json.Unmarshal(plain, &jobRequest)
	return jobRequest, err
}

func imageJobQueueCipher() (cipher.AEAD, error) {
	key := sha256.Sum256([]byte(config.Cfg.JWTSecret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func imageJobIdempotencyKey(kind string, token string, key string) string {
	tokenHash := sha256.Sum256([]byte(token))
	keyHash := sha256.Sum256([]byte(key))
	return "image-job-idem:" + kind + ":" + hex.EncodeToString(tokenHash[:8]) + ":" + hex.EncodeToString(keyHash[:12])
}

func imageJobUserKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:8])
}

func imageJobModelKey(model string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return "default"
	}
	return model
}

func positiveInt(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}
