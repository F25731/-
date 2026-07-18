package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

const (
	EventTopicImageJob = "image-job"
	EventTopicAgent    = "agent"

	EventTypeJobQueued    = "job.queued"
	EventTypeJobStarted   = "job.started"
	EventTypeJobSucceeded = "job.succeeded"
	EventTypeJobFailed    = "job.failed"
	EventTypeJobCanceled  = "job.canceled"
)

type Event struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Topic     string `json:"topic"`
	Timestamp int64  `json:"timestamp"`
	UserID    string `json:"userId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	JobID     string `json:"jobId,omitempty"`
	ProjectID string `json:"projectId,omitempty"`
	Payload   any    `json:"payload,omitempty"`
}

type EventFilter struct {
	Topics    map[string]bool
	JobID     string
	ProjectID string
	SessionID string
	AfterID   string
}

type EventSubscription struct {
	Events <-chan Event
	cancel func()
}

func (subscription EventSubscription) Cancel() {
	if subscription.cancel != nil {
		subscription.cancel()
	}
}

type eventSubscriber struct {
	filter EventFilter
	ch     chan Event
}

type eventBus struct {
	mu          sync.Mutex
	events      []Event
	subscribers map[string]eventSubscriber
}

const eventReplayLimit = 512

var globalEventBus = &eventBus{subscribers: map[string]eventSubscriber{}}

func SubscribeEvents(ctx context.Context, filter EventFilter) EventSubscription {
	id := randomEventID()
	ch := make(chan Event, 64)
	subCtx, cancel := context.WithCancel(ctx)
	globalEventBus.mu.Lock()
	replay := replayEventsLocked(filter)
	globalEventBus.subscribers[id] = eventSubscriber{filter: filter, ch: ch}
	globalEventBus.mu.Unlock()

	go func() {
		defer func() {
			globalEventBus.mu.Lock()
			delete(globalEventBus.subscribers, id)
			globalEventBus.mu.Unlock()
			close(ch)
		}()
		for _, event := range replay {
			select {
			case ch <- event:
			case <-subCtx.Done():
				return
			}
		}
		<-subCtx.Done()
	}()

	return EventSubscription{Events: ch, cancel: cancel}
}

func PublishEvent(event Event) Event {
	event.ID = strings.TrimSpace(event.ID)
	if event.ID == "" {
		event.ID = newMonotonicEventID()
	}
	if event.Timestamp == 0 {
		event.Timestamp = time.Now().UnixMilli()
	}

	globalEventBus.mu.Lock()
	globalEventBus.events = append(globalEventBus.events, event)
	if len(globalEventBus.events) > eventReplayLimit {
		globalEventBus.events = globalEventBus.events[len(globalEventBus.events)-eventReplayLimit:]
	}
	for _, subscriber := range globalEventBus.subscribers {
		if !eventMatchesFilter(event, subscriber.filter) {
			continue
		}
		select {
		case subscriber.ch <- event:
		default:
		}
	}
	globalEventBus.mu.Unlock()
	return event
}

func NewEventFilter(topics []string, jobID string, projectID string, sessionID string, afterID string) EventFilter {
	filter := EventFilter{
		Topics:    map[string]bool{},
		JobID:     strings.TrimSpace(jobID),
		ProjectID: strings.TrimSpace(projectID),
		SessionID: strings.TrimSpace(sessionID),
		AfterID:   strings.TrimSpace(afterID),
	}
	for _, topic := range topics {
		topic = strings.TrimSpace(topic)
		if topic != "" {
			filter.Topics[topic] = true
		}
	}
	return filter
}

func replayEventsLocked(filter EventFilter) []Event {
	result := []Event{}
	start := 0
	if filter.AfterID != "" {
		for index, event := range globalEventBus.events {
			if event.ID == filter.AfterID {
				start = index + 1
				break
			}
		}
	}
	for _, event := range globalEventBus.events[start:] {
		if eventMatchesFilter(event, filter) {
			result = append(result, event)
		}
	}
	return result
}

func eventMatchesFilter(event Event, filter EventFilter) bool {
	if len(filter.Topics) > 0 && !filter.Topics[event.Topic] {
		return false
	}
	if filter.JobID != "" && event.JobID != filter.JobID {
		return false
	}
	if filter.ProjectID != "" && event.ProjectID != filter.ProjectID {
		return false
	}
	if filter.SessionID != "" && event.SessionID != filter.SessionID {
		return false
	}
	return true
}

func publishImageJobEvent(eventType string, job ImageJob) {
	PublishEvent(Event{
		Type:  eventType,
		Topic: EventTopicImageJob,
		JobID: job.ID,
		Payload: map[string]any{
			"id":        job.ID,
			"status":    job.Status,
			"data":      job.Data,
			"error":     job.Error,
			"createdAt": job.CreatedAt,
			"updatedAt": job.UpdatedAt,
		},
	})
}

func imageJobEventType(status ImageJobStatus) string {
	switch status {
	case ImageJobPending:
		return EventTypeJobQueued
	case ImageJobRunning:
		return EventTypeJobStarted
	case ImageJobSucceeded:
		return EventTypeJobSucceeded
	case ImageJobFailed:
		return EventTypeJobFailed
	case ImageJobCanceled:
		return EventTypeJobCanceled
	default:
		return ""
	}
}

func newMonotonicEventID() string {
	return time.Now().UTC().Format("20060102150405.000000000") + "-" + randomEventID()
}

func randomEventID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return time.Now().Format("150405.000000000")
	}
	return hex.EncodeToString(buf)
}
