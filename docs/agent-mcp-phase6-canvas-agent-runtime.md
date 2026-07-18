# Phase 6: Built-in Canvas Agent Runtime

Phase 6 uses a native server-side tool loop. It does not require Codex, Remote MCP, or a customer-installed runtime.

## Runtime flow

```text
Browser creates one Agent Run
  -> POST /api/agent/turn (request-scoped SSE)
  -> OpenAI-compatible Responses API with native function tools
  -> model returns function_call
  -> server validates and emits tool.requested
  -> browser applies the canvas operation
  -> browser posts the result to /api/agent/runs/:runId/tool-results
  -> Redis delivers the result to the active server instance
  -> server sends function_call_output to the same model turn
  -> model may call more tools or return the final answer
```

The browser no longer starts a second model turn after each tool. One user message maps to one Run, one Turn, and one assistant message.

## Storage and concurrency

- Agent Run coordination uses Redis with expiring keys and Pub/Sub.
- Tool results contain compact canvas state only. API keys, base64 images, and browser Blob URLs are not stored in Redis.
- Canvas projects and chat history keep using the existing browser project store.
- Image jobs keep using the existing backend queue and polling flow.
- No SQLite storage is introduced for Agent runtime state.

## Native tools

- `canvas_read`: read nodes, connections, selection, models, and task state.
- `canvas_generate_images`: create one or more independent image workflows and run them.
- `canvas_generate_text`: create and run a text workflow.
- `canvas_apply_operations`: create, update, move, resize, remove, connect, select, and focus nodes.
- `canvas_layout`: arrange workflows without changing node dimensions.
- `canvas_query_image_jobs`: inspect image jobs represented by the canvas.

The server accepts at most 12 tool calls per Run, blocks duplicate calls, logs raw model output and validation failures, and retries twice when a mutation request returns no tool call.

## Layout policy

```text
Canvas: independent tasks are rows from top to bottom.
Task: references -> prompt -> config -> results, from left to right.
References: vertical stack to the left of the prompt/config stages.
Results: grid with at most two columns to the right of config.
Branches: vertical around their parent.
Follow-up work: continue to the right in the same task row.
Independent work: start a new task row.
```

Layout operations only change node positions. Generated images resize around their placeholder center and preserve the source aspect ratio.

## Events and logs

Each event carries `runId`, `turnId`, `toolCallId`, timestamp, and sequence number. Generation events also carry `generationRunId` and `imageJobId`.

The UI displays reasoning summaries, tool validation, canvas application, image polling, tool results, and final Run completion in one structured message timeline.
