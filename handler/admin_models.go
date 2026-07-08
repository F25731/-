package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func Models(w http.ResponseWriter, r *http.Request) {
	result, err := service.PublicModels()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func PromptExtract(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Image string `json:"image"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	result, err := service.ExtractPromptFromImage(payload.Image)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func DetailLLM(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ModelID  string `json:"modelId"`
		APIKey   string `json:"apiKey"`
		Messages []any  `json:"messages"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	result, err := service.RequestDetailPrompt(payload.ModelID, payload.APIKey, payload.Messages)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminModels(w http.ResponseWriter, r *http.Request) {
	result, err := service.AdminModels()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminFetchModels(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		APIKey string `json:"apiKey"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	result, err := service.AdminPoolModels(payload.APIKey)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminSaveModel(w http.ResponseWriter, r *http.Request, id string) {
	var item model.AdminModel
	_ = json.NewDecoder(r.Body).Decode(&item)
	if id != "" {
		item.ID = id
	}
	result, err := service.SaveAdminModel(item)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminDeleteModel(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteAdminModel(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
