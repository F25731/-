package repository

import "testing"

func TestParseStreamMessages(t *testing.T) {
	value := RedisValue{Kind: '*', Array: []RedisValue{
		{Kind: '*', Array: []RedisValue{
			{Kind: '$', Data: []byte("queue:image-jobs:v2")},
			{Kind: '*', Array: []RedisValue{
				{Kind: '*', Array: []RedisValue{
					{Kind: '$', Data: []byte("1-0")},
					{Kind: '*', Array: []RedisValue{
						{Kind: '$', Data: []byte("jobId")},
						{Kind: '$', Data: []byte("job-1")},
						{Kind: '$', Data: []byte("payload")},
						{Kind: '$', Data: []byte("encrypted")},
					}},
				}},
			}},
		}},
	}}
	messages := parseStreamMessages(value)
	if len(messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(messages))
	}
	if messages[0].ID != "1-0" || messages[0].Values["jobId"] != "job-1" || messages[0].Values["payload"] != "encrypted" {
		t.Fatalf("unexpected message: %#v", messages[0])
	}
}

func TestParseClaimedStreamMessages(t *testing.T) {
	value := RedisValue{Kind: '*', Array: []RedisValue{
		{Kind: '*', Array: []RedisValue{
			{Kind: '$', Data: []byte("2-0")},
			{Kind: '*', Array: []RedisValue{
				{Kind: '$', Data: []byte("jobId")},
				{Kind: '$', Data: []byte("job-2")},
			}},
		}},
	}}
	messages := parseClaimedStreamMessages(value)
	if len(messages) != 1 || messages[0].ID != "2-0" || messages[0].Values["jobId"] != "job-2" {
		t.Fatalf("unexpected claimed messages: %#v", messages)
	}
}
