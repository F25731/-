package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func PublicModels() ([]model.AdminModel, error) {
	items, _, err := repository.ListAdminModels(true)
	return publicAdminModels(items), err
}

func AdminModels() (model.AdminModelList, error) {
	items, total, err := repository.ListAdminModels(false)
	if err != nil {
		return model.AdminModelList{}, err
	}
	items = safeAdminModels(items)
	return model.AdminModelList{Items: items, Total: int(total)}, nil
}

func SaveAdminModel(item model.AdminModel) (model.AdminModel, error) {
	now := now()
	item.Name = strings.TrimSpace(item.Name)
	item.ModelID = strings.TrimSpace(item.ModelID)
	item.APIURL = strings.TrimSpace(item.APIURL)
	item.APIKey = strings.TrimSpace(item.APIKey)
	if item.Type == "" {
		item.Type = model.AdminModelTypeImage
	}
	item.TierModels = normalizeTierModels(item.TierModels)
	item.SupportedSizes = normalizeSupportedSizes(item.SupportedSizes)
	item.ReferenceLimit = normalizeReferenceLimit(item.ReferenceLimit)
	if item.Type == model.AdminModelTypeImage && len(item.TierModels) == 0 {
		return model.AdminModel{}, errors.New("图片分组至少配置一个清晰度模型")
	}
	if item.Type == model.AdminModelTypeImage {
		item.DefaultTier = normalizeDefaultTier(item.DefaultTier, item.TierModels)
	} else {
		item.DefaultTier = ""
		item.TierModels = map[string]string{}
	}
	if item.Type != model.AdminModelTypeImage && item.Type != model.AdminModelTypeVideo {
		item.SupportedSizes = []string{}
		item.ReferenceLimit = 4
	}
	if item.ModelID == "" && item.Type != model.AdminModelTypeImage {
		item.ModelID = item.Name
	}
	if item.Type == model.AdminModelTypePrompt && item.APIKey == "" && item.ID == "" {
		return model.AdminModel{}, safeMessageError{message: "提示词提取模型需要配置后台 API Key"}
	}
	if item.Type != model.AdminModelTypePrompt {
		item.APIKey = ""
	}
	if item.Type != model.AdminModelTypeDetailPrompt || !item.Enabled {
		item.IsDefault = false
	}
	if item.ID == "" {
		item.ID = newID("model")
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	saved, err := repository.SaveAdminModel(item)
	if err != nil {
		return model.AdminModel{}, err
	}
	if saved.Type == model.AdminModelTypeDetailPrompt && saved.IsDefault {
		if err := repository.ClearAdminModelDefaults(saved.Type, saved.ID); err != nil {
			return model.AdminModel{}, err
		}
	}
	return safeAdminModel(saved), nil
}

func ExtractPromptFromImage(image string) (string, error) {
	image = strings.TrimSpace(image)
	if image == "" {
		return "", safeMessageError{message: "请先上传图片"}
	}
	promptModel, err := selectPromptModel()
	if err != nil {
		return "", err
	}
	modelID := strings.TrimSpace(promptModel.ModelID)
	if modelID == "" {
		modelID = promptModel.Name
	}
	body, _ := json.Marshal(map[string]any{
		"model": modelID,
		"messages": []map[string]any{{
			"role": "user",
			"content": []map[string]any{
				{"type": "text", "text": "请根据这张图片提取一段可直接用于 AI 生图的中文提示词。要求：只输出提示词正文，不要解释；覆盖主体、场景、构图、镜头、光线、色彩、材质、风格、细节和画质；如果图片里有文字，也描述文字内容与排版。"},
				{"type": "image_url", "image_url": map[string]string{"url": image}},
			},
		}},
	})
	channel := model.ModelChannel{BaseURL: promptModel.APIURL, APIKey: promptModel.APIKey}
	request, err := http.NewRequest(http.MethodPost, BuildModelChannelURL(channel, "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+promptModel.APIKey)
	request.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 90 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return "", readAdminChannelError(responseBody, response.StatusCode, "提取失败")
	}
	var payload struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	_ = json.Unmarshal(responseBody, &payload)
	if payload.Code != 0 && strings.TrimSpace(payload.Msg) != "" {
		return "", safeMessageError{message: payload.Msg}
	}
	if len(payload.Choices) > 0 {
		content := strings.TrimSpace(payload.Choices[0].Message.Content)
		if content != "" {
			return content, nil
		}
	}
	return "", safeMessageError{message: "接口没有返回提示词"}
}

func RequestDetailPrompt(modelID string, apiKey string, messages []any) (string, error) {
	modelID = strings.TrimSpace(modelID)
	apiKey = strings.TrimSpace(apiKey)
	if modelID == "" {
		return "", safeMessageError{message: "请选择详情图提示词模型"}
	}
	if apiKey == "" {
		return "", safeMessageError{message: "请先填写 LLM API Key"}
	}
	if len(messages) == 0 {
		return "", safeMessageError{message: "详情图提示词请求内容不能为空"}
	}
	detailModel, err := selectDetailPromptModel(modelID)
	if err != nil {
		return "", err
	}
	upstreamModelID := strings.TrimSpace(detailModel.ModelID)
	if upstreamModelID == "" {
		upstreamModelID = detailModel.Name
	}
	body, _ := json.Marshal(map[string]any{
		"model":       upstreamModelID,
		"messages":    messages,
		"temperature": 0.7,
	})
	channel := model.ModelChannel{BaseURL: detailModel.APIURL, APIKey: apiKey}
	request, err := http.NewRequest(http.MethodPost, BuildModelChannelURL(channel, "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 180 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", safeMessageError{message: "详情图提示词接口访问超时或失败，请检查 API Key 或模型是否可用"}
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return "", readAdminChannelError(responseBody, response.StatusCode, "详情图提示词请求失败")
	}
	content := readChatCompletionContent(responseBody)
	if content != "" {
		return content, nil
	}
	return "", safeMessageError{message: "详情图提示词接口没有返回内容"}
}

func selectPromptModel() (model.AdminModel, error) {
	items, _, err := repository.ListAdminModels(true)
	if err != nil {
		return model.AdminModel{}, err
	}
	for _, item := range items {
		if item.Type == model.AdminModelTypePrompt && strings.TrimSpace(item.APIURL) != "" && strings.TrimSpace(item.APIKey) != "" {
			return item, nil
		}
	}
	return model.AdminModel{}, safeMessageError{message: "后台还没有配置提示词模型"}
}

func selectDetailPromptModel(id string) (model.AdminModel, error) {
	items, _, err := repository.ListAdminModels(true)
	if err != nil {
		return model.AdminModel{}, err
	}
	for _, item := range items {
		if item.Type == model.AdminModelTypeDetailPrompt && item.ID == id && strings.TrimSpace(item.APIURL) != "" {
			return item, nil
		}
	}
	return model.AdminModel{}, safeMessageError{message: "后台还没有配置可用的详情图提示词模型"}
}

func readChatCompletionContent(body []byte) string {
	var payload struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	_ = json.Unmarshal(body, &payload)
	if len(payload.Choices) == 0 {
		return ""
	}
	content := payload.Choices[0].Message.Content
	if text, ok := content.(string); ok {
		return strings.TrimSpace(text)
	}
	if parts, ok := content.([]any); ok {
		var builder strings.Builder
		for _, part := range parts {
			if item, ok := part.(map[string]any); ok {
				if text, ok := item["text"].(string); ok {
					builder.WriteString(text)
				}
			}
		}
		return strings.TrimSpace(builder.String())
	}
	return ""
}

func publicAdminModels(items []model.AdminModel) []model.AdminModel {
	result := make([]model.AdminModel, 0, len(items))
	for _, item := range items {
		if item.Type == model.AdminModelTypePrompt {
			continue
		}
		item.APIKey = ""
		item.HasAPIKey = false
		result = append(result, item)
	}
	return result
}

func safeAdminModels(items []model.AdminModel) []model.AdminModel {
	result := make([]model.AdminModel, 0, len(items))
	for _, item := range items {
		result = append(result, safeAdminModel(item))
	}
	return result
}

func safeAdminModel(item model.AdminModel) model.AdminModel {
	item.HasAPIKey = strings.TrimSpace(item.APIKey) != ""
	item.APIKey = ""
	return item
}

func normalizeReferenceLimit(value int) int {
	if value <= 0 {
		return 4
	}
	if value > 20 {
		return 20
	}
	return value
}

func normalizeTierModels(values map[string]string) map[string]string {
	next := map[string]string{}
	for _, tier := range []string{"512", "1k", "2k", "4k"} {
		value := strings.TrimSpace(values[tier])
		if value != "" {
			next[tier] = value
		}
	}
	return next
}

func normalizeDefaultTier(value string, tierModels map[string]string) string {
	value = strings.TrimSpace(value)
	if tierModels[value] != "" {
		return value
	}
	if tierModels["1k"] != "" {
		return "1k"
	}
	for _, tier := range []string{"512", "2k", "4k"} {
		if tierModels[tier] != "" {
			return tier
		}
	}
	return "1k"
}

func normalizeSupportedSizes(values []string) []string {
	allowed := map[string]bool{
		"auto": true, "1:1": true, "16:9": true, "9:16": true, "4:3": true, "3:4": true,
		"3:2": true, "2:3": true, "5:4": true, "4:5": true, "21:9": true,
		"1280x720": true, "720x1280": true, "1024x1024": true,
		"1920x1080": true, "1080x1920": true, "3840x2160": true, "2160x3840": true,
	}
	seen := map[string]bool{}
	next := []string{}
	for _, value := range values {
		size := strings.TrimSpace(value)
		if !allowed[size] || seen[size] {
			continue
		}
		seen[size] = true
		next = append(next, size)
	}
	return next
}

func DeleteAdminModel(id string) error {
	return repository.DeleteAdminModel(id)
}
