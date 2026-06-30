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

func AdminModels(w http.ResponseWriter, r *http.Request) {
	result, err := service.AdminModels()
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
