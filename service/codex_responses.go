package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
)

const (
	maxCodexImageBytes = 15 << 20
	maxCodexEventBytes = 8 << 20
)

type codexResponseRequest struct {
	Channel        model.ModelChannel
	ModelID        string
	APIKey         string
	Task           string
	ImageDataURL   string
	PromptCacheKey string
	Timeout        time.Duration
}

type codexInputPart struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	ImageURL string `json:"image_url,omitempty"`
}

type codexInputItem struct {
	Type    string           `json:"type"`
	Role    string           `json:"role"`
	Content []codexInputPart `json:"content"`
}

type codexResponsesPayload struct {
	Model             string            `json:"model"`
	Instructions      string            `json:"instructions"`
	Input             []codexInputItem  `json:"input"`
	Reasoning         map[string]string `json:"reasoning"`
	Include           []string          `json:"include"`
	Tools             []map[string]any  `json:"tools"`
	ToolChoice        string            `json:"tool_choice"`
	ParallelToolCalls bool              `json:"parallel_tool_calls"`
	PromptCacheKey    string            `json:"prompt_cache_key"`
	Stream            bool              `json:"stream"`
	Store             bool              `json:"store"`
}

var codexImageClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialPublicImageAddress,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
	},
	CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return errors.New("图片链接重定向次数过多")
		}
		if request.URL.Scheme != "http" && request.URL.Scheme != "https" {
			return errors.New("图片链接重定向到了不支持的协议")
		}
		return nil
	},
}

var codexResponsesClient = newCodexResponsesClient()

func newCodexResponsesClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 512
	transport.MaxIdleConnsPerHost = 256
	transport.IdleConnTimeout = 90 * time.Second
	transport.ResponseHeaderTimeout = 180 * time.Second
	return &http.Client{Transport: transport}
}

func requestCodexResponse(parent context.Context, input codexResponseRequest) (string, error) {
	body, err := buildCodexResponsesBody(input)
	if err != nil {
		return "", err
	}
	timeout := input.Timeout
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	requestURL := BuildModelChannelURL(input.Channel, "/responses")
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+input.APIKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")

	response, err := codexResponsesClient.Do(request)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", errors.New("Codex 响应超时")
		}
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			return "", errors.New("请求已取消")
		}
		return "", errors.New("Codex 接口连接失败")
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return "", readAdminChannelError(responseBody, response.StatusCode, "Codex 请求失败")
	}

	var content string
	if strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		content, err = parseCodexResponsesStream(response.Body)
	} else {
		responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, maxCodexEventBytes))
		if readErr != nil {
			return "", errors.New("读取 Codex 响应失败")
		}
		content, err = parseCodexResponsesJSON(responseBody)
	}
	if err != nil {
		return "", err
	}
	content = normalizeCodexOutput(content)
	if content == "" {
		return "", errors.New("Codex 没有返回正文")
	}
	return content, nil
}

func buildCodexResponsesBody(input codexResponseRequest) ([]byte, error) {
	if strings.TrimSpace(input.ModelID) == "" {
		return nil, errors.New("Codex 模型不能为空")
	}
	if strings.TrimSpace(input.Task) == "" {
		return nil, errors.New("Codex 任务不能为空")
	}

	parts := []codexInputPart{{Type: "input_text", Text: input.Task}}
	if input.ImageDataURL != "" {
		parts = append(parts, codexInputPart{Type: "input_image", ImageURL: input.ImageDataURL})
	}

	payload := codexResponsesPayload{
		Model:        strings.TrimSpace(input.ModelID),
		Instructions: "You are a concise assistant. Execute the latest user request exactly, return the requested final content, and never call tools.",
		Input: []codexInputItem{
			{
				Type: "message",
				Role: "developer",
				Content: []codexInputPart{{
					Type: "input_text",
					Text: "Return only the final answer requested by the user. Never call the noop tool.",
				}},
			},
			{Type: "message", Role: "user", Content: parts},
		},
		Reasoning:         map[string]string{"effort": "medium", "summary": "auto"},
		Include:           []string{"reasoning.encrypted_content"},
		Tools:             []map[string]any{codexNoopTool()},
		ToolChoice:        "auto",
		ParallelToolCalls: false,
		PromptCacheKey:    strings.TrimSpace(input.PromptCacheKey),
		Stream:            true,
		Store:             false,
	}
	if payload.PromptCacheKey == "" {
		payload.PromptCacheKey = "canvas-codex-v1"
	}
	return json.Marshal(payload)
}

func flattenPromptMessages(messages []any) string {
	sections := make([]string, 0, len(messages))
	for _, rawMessage := range messages {
		message, ok := rawMessage.(map[string]any)
		if !ok {
			continue
		}
		content := extractPromptMessageText(message["content"])
		if content == "" {
			continue
		}
		role, _ := message["role"].(string)
		role = strings.ToLower(strings.TrimSpace(role))
		if role == "system" || role == "developer" || len(messages) > 1 {
			sections = append(sections, strings.ToUpper(role)+":\n"+content)
		} else {
			sections = append(sections, content)
		}
	}
	return strings.TrimSpace(strings.Join(sections, "\n\n"))
}

func extractPromptMessageText(content any) string {
	if text, ok := content.(string); ok {
		return strings.TrimSpace(text)
	}
	parts, ok := content.([]any)
	if !ok {
		return ""
	}
	texts := make([]string, 0, len(parts))
	for _, rawPart := range parts {
		part, ok := rawPart.(map[string]any)
		if !ok {
			continue
		}
		if text, ok := part["text"].(string); ok && strings.TrimSpace(text) != "" {
			texts = append(texts, strings.TrimSpace(text))
		}
	}
	return strings.Join(texts, "\n")
}

func codexNoopTool() map[string]any {
	return map[string]any{
		"type":        "function",
		"name":        "noop",
		"description": "No operation. Never call this tool.",
		"parameters": map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}
}

func parseCodexResponsesStream(reader io.Reader) (string, error) {
	var output strings.Builder
	var completedText string
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), maxCodexEventBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return "", errors.New("Codex 流式响应格式错误")
		}
		eventType, _ := event["type"].(string)
		switch eventType {
		case "response.output_text.delta":
			if delta, ok := event["delta"].(string); ok {
				output.WriteString(delta)
			}
		case "response.output_text.done":
			if text, ok := event["text"].(string); ok {
				completedText = text
			}
		case "response.completed", "response.done":
			if output.Len() == 0 && completedText == "" {
				completedText = extractCodexOutputText(event["response"])
			}
		case "response.incomplete":
			return "", errors.New("Codex 输出未完成")
		case "response.error", "response.failed":
			message := extractCodexErrorMessage(event)
			if message == "" {
				message = "Codex 返回失败"
			}
			return "", errors.New(message)
		case "response.output_item.done":
			if item, ok := event["item"].(map[string]any); ok {
				if itemType, _ := item["type"].(string); strings.Contains(itemType, "function_call") {
					return "", errors.New("Codex 返回了工具调用而不是正文")
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return "", errors.New("读取 Codex 流式响应失败")
	}
	if output.Len() > 0 {
		return output.String(), nil
	}
	return completedText, nil
}

func parseCodexResponsesJSON(body []byte) (string, error) {
	var response map[string]any
	if err := json.Unmarshal(body, &response); err != nil {
		return "", errors.New("Codex 响应格式错误")
	}
	if message := extractCodexErrorMessage(response); message != "" {
		return "", errors.New(message)
	}
	return extractCodexOutputText(response), nil
}

func extractCodexOutputText(value any) string {
	response, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if text, ok := response["output_text"].(string); ok && strings.TrimSpace(text) != "" {
		return text
	}
	items, _ := response["output"].([]any)
	var output strings.Builder
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		parts, _ := item["content"].([]any)
		for _, rawPart := range parts {
			part, ok := rawPart.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := part["text"].(string); ok {
				output.WriteString(text)
			}
		}
	}
	return output.String()
}

func extractCodexErrorMessage(value any) string {
	item, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if message, ok := item["message"].(string); ok && strings.TrimSpace(message) != "" {
		return strings.TrimSpace(message)
	}
	if rawError, ok := item["error"].(map[string]any); ok {
		if message, ok := rawError["message"].(string); ok {
			return strings.TrimSpace(message)
		}
	}
	if response, ok := item["response"].(map[string]any); ok {
		return extractCodexErrorMessage(response)
	}
	return ""
}

func normalizeCodexOutput(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		var decoded string
		if err := json.Unmarshal([]byte(value), &decoded); err == nil {
			return strings.TrimSpace(decoded)
		}
	}
	return value
}

func loadCodexImageDataURL(parent context.Context, source string) (string, error) {
	source = strings.TrimSpace(source)
	if strings.HasPrefix(strings.ToLower(source), "data:") {
		return normalizeImageDataURL(source)
	}
	parsed, err := url.Parse(source)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return "", errors.New("参考图链接无效")
	}

	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", errors.New("参考图链接无效")
	}
	request.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8")
	request.Header.Set("User-Agent", "InfiniteCanvas/1.0")
	response, err := codexImageClient.Do(request)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", errors.New("参考图下载超时")
		}
		return "", errors.New("参考图下载失败")
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("参考图下载失败（HTTP %d）", response.StatusCode)
	}
	if response.ContentLength > maxCodexImageBytes {
		return "", errors.New("参考图超过 15MB")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxCodexImageBytes+1))
	if err != nil {
		return "", errors.New("参考图读取失败")
	}
	if len(data) > maxCodexImageBytes {
		return "", errors.New("参考图超过 15MB")
	}
	mediaType := response.Header.Get("Content-Type")
	if parsedType, _, parseErr := mime.ParseMediaType(mediaType); parseErr == nil {
		mediaType = parsedType
	}
	if mediaType == "" || mediaType == "application/octet-stream" {
		mediaType = http.DetectContentType(data)
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if !allowedCodexImageType(mediaType) {
		return "", errors.New("参考图格式仅支持 JPEG、PNG、WebP 或 GIF")
	}
	return "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func normalizeImageDataURL(source string) (string, error) {
	comma := strings.IndexByte(source, ',')
	if comma <= len("data:") {
		return "", errors.New("参考图数据格式错误")
	}
	metadata := source[len("data:"):comma]
	parts := strings.Split(metadata, ";")
	mediaType := strings.ToLower(strings.TrimSpace(parts[0]))
	if len(parts) < 2 || !strings.EqualFold(parts[len(parts)-1], "base64") || !allowedCodexImageType(mediaType) {
		return "", errors.New("参考图格式仅支持 Base64 JPEG、PNG、WebP 或 GIF")
	}
	encoded := strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == '\t' || r == ' ' {
			return -1
		}
		return r
	}, source[comma+1:])
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", errors.New("参考图 Base64 数据无效")
	}
	if len(data) > maxCodexImageBytes {
		return "", errors.New("参考图超过 15MB")
	}
	return "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func allowedCodexImageType(mediaType string) bool {
	switch mediaType {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return true
	default:
		return false
	}
}

func dialPublicImageAddress(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	var publicIP net.IP
	for _, address := range addresses {
		if isPublicImageIP(address.IP) {
			publicIP = address.IP
			break
		}
	}
	if publicIP == nil {
		return nil, errors.New("参考图地址不允许访问")
	}
	dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	return dialer.DialContext(ctx, network, net.JoinHostPort(publicIP.String(), port))
}

func isPublicImageIP(ip net.IP) bool {
	return ip != nil && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsUnspecified() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsMulticast()
}
