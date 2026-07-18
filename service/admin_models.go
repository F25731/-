package service

import (
	"context"
	"errors"
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
	if !isSupportedAdminModelType(item.Type) {
		return model.AdminModel{}, errors.New("不支持的模型类型")
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
	if item.Type != model.AdminModelTypeImage {
		item.SupportedSizes = []string{}
		item.ReferenceLimit = 4
	}
	if item.ModelID == "" && item.Type != model.AdminModelTypeImage {
		item.ModelID = item.Name
	}
	item.APIKey = ""
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

func ExtractPromptFromImage(ctx context.Context, image string, promptModelID string, apiKey string) (string, error) {
	image = strings.TrimSpace(image)
	apiKey = strings.TrimSpace(apiKey)
	if image == "" {
		return "", safeMessageError{message: "请先上传图片"}
	}
	promptModel, err := selectPromptModel(promptModelID)
	if err != nil {
		return "", err
	}
	if apiKey == "" {
		return "", safeMessageError{message: "请先填写提示词模型 API Key"}
	}
	modelID := strings.TrimSpace(promptModel.ModelID)
	if modelID == "" {
		modelID = promptModel.Name
	}
	imageDataURL, err := loadCodexImageDataURL(ctx, image)
	if err != nil {
		return "", safeMessageError{message: err.Error()}
	}
	channel := model.ModelChannel{BaseURL: promptModel.APIURL, APIKey: apiKey}
	content, err := requestCodexResponse(ctx, codexResponseRequest{
		Channel:        channel,
		ModelID:        modelID,
		APIKey:         apiKey,
		Task:           "请根据这张图片提取一段可直接用于 AI 生图的中文提示词。要求：只输出提示词正文，不要解释；覆盖主体、场景、构图、镜头、光线、色彩、材质、风格、细节和画质；如果图片里有文字，也描述文字内容与排版。",
		ImageDataURL:   imageDataURL,
		PromptCacheKey: "canvas-codex-image-v1",
		Timeout:        90 * time.Second,
	})
	if err != nil {
		return "", safeMessageError{message: "提取提示词失败：" + err.Error()}
	}
	return content, nil
}

func RequestDetailPrompt(ctx context.Context, modelID string, apiKey string, messages []any) (string, error) {
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
	taskText := flattenPromptMessages(messages)
	if taskText == "" {
		return "", safeMessageError{message: "详情图提示词请求内容格式错误"}
	}
	channel := model.ModelChannel{BaseURL: detailModel.APIURL, APIKey: apiKey}
	content, err := requestCodexResponse(ctx, codexResponseRequest{
		Channel:        channel,
		ModelID:        upstreamModelID,
		APIKey:         apiKey,
		Task:           taskText,
		PromptCacheKey: "canvas-codex-detail-v1",
		Timeout:        180 * time.Second,
	})
	if err != nil {
		return "", safeMessageError{message: "详情图提示词请求失败：" + err.Error()}
	}
	return content, nil
}

func selectPromptModel(id string) (model.AdminModel, error) {
	id = strings.TrimSpace(id)
	items, _, err := repository.ListAdminModels(true)
	if err != nil {
		return model.AdminModel{}, err
	}
	var first model.AdminModel
	for _, item := range items {
		if item.Type != model.AdminModelTypePrompt || strings.TrimSpace(item.APIURL) == "" {
			continue
		}
		if first.ID == "" {
			first = item
		}
		if id != "" && (item.ID == id || item.Name == id || item.ModelID == id) {
			return item, nil
		}
	}
	if id == "" && first.ID != "" {
		return first, nil
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

func publicAdminModels(items []model.AdminModel) []model.AdminModel {
	result := make([]model.AdminModel, 0, len(items))
	for _, item := range items {
		if !isSupportedAdminModelType(item.Type) {
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
		if !isSupportedAdminModelType(item.Type) {
			continue
		}
		result = append(result, safeAdminModel(item))
	}
	return result
}

func safeAdminModel(item model.AdminModel) model.AdminModel {
	item.HasAPIKey = strings.TrimSpace(item.APIKey) != ""
	item.APIKey = ""
	return item
}

func isSupportedAdminModelType(value model.AdminModelType) bool {
	switch value {
	case model.AdminModelTypeImage, model.AdminModelTypeParse, model.AdminModelTypePrompt, model.AdminModelTypeDetailPrompt:
		return true
	default:
		return false
	}
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
