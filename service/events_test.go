package service

import (
	"context"
	"testing"
	"time"
)

func TestEventSubscriptionReplaysAndFiltersByJob(t *testing.T) {
	resetEventBusForTest()
	first := PublishEvent(Event{Type: EventTypeJobQueued, Topic: EventTopicImageJob, JobID: "job-a"})
	PublishEvent(Event{Type: EventTypeJobQueued, Topic: EventTopicImageJob, JobID: "job-b"})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	subscription := SubscribeEvents(ctx, NewEventFilter([]string{EventTopicImageJob}, "job-a", "", "", ""))
	defer subscription.Cancel()

	event := readTestEvent(t, subscription.Events)
	if event.ID != first.ID || event.JobID != "job-a" {
		t.Fatalf("unexpected replay event: %+v", event)
	}

	PublishEvent(Event{Type: EventTypeJobStarted, Topic: EventTopicImageJob, JobID: "job-b"})
	PublishEvent(Event{Type: EventTypeJobStarted, Topic: EventTopicImageJob, JobID: "job-a"})

	event = readTestEvent(t, subscription.Events)
	if event.Type != EventTypeJobStarted || event.JobID != "job-a" {
		t.Fatalf("unexpected live event: %+v", event)
	}
}

func TestEventSubscriptionHonorsLastEventID(t *testing.T) {
	resetEventBusForTest()
	first := PublishEvent(Event{Type: EventTypeJobQueued, Topic: EventTopicImageJob, JobID: "job-a"})
	second := PublishEvent(Event{Type: EventTypeJobStarted, Topic: EventTopicImageJob, JobID: "job-a"})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	subscription := SubscribeEvents(ctx, NewEventFilter([]string{EventTopicImageJob}, "job-a", "", "", first.ID))
	defer subscription.Cancel()

	event := readTestEvent(t, subscription.Events)
	if event.ID != second.ID {
		t.Fatalf("expected replay after first event, got %+v", event)
	}
}

func readTestEvent(t *testing.T, events <-chan Event) Event {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event")
		return Event{}
	}
}

func resetEventBusForTest() {
	globalEventBus.mu.Lock()
	globalEventBus.events = nil
	globalEventBus.subscribers = map[string]eventSubscriber{}
	globalEventBus.mu.Unlock()
}
