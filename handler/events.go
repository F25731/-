package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/service"
)

func Events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	query := r.URL.Query()
	filter := service.NewEventFilter(
		splitCSV(query.Get("topics")),
		query.Get("jobId"),
		query.Get("projectId"),
		query.Get("sessionId"),
		firstNonEmpty(r.Header.Get("Last-Event-ID"), query.Get("lastEventId")),
	)
	subscription := service.SubscribeEvents(r.Context(), filter)
	defer subscription.Cancel()

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case event, ok := <-subscription.Events:
			if !ok {
				return
			}
			if err := writeSSEEvent(w, event); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			_, _ = fmt.Fprintf(w, ": heartbeat %d\n\n", time.Now().UnixMilli())
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func writeSSEEvent(w http.ResponseWriter, event service.Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %s\n", event.ID); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\n", event.Type); err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "data: %s\n\n", payload)
	return err
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}
