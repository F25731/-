package service

import (
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func PublicModels() ([]model.AdminModel, error) {
	items, _, err := repository.ListAdminModels(true)
	return items, err
}

func AdminModels() (model.AdminModelList, error) {
	items, total, err := repository.ListAdminModels(false)
	if err != nil {
		return model.AdminModelList{}, err
	}
	return model.AdminModelList{Items: items, Total: int(total)}, nil
}

func SaveAdminModel(item model.AdminModel) (model.AdminModel, error) {
	now := now()
	item.Name = strings.TrimSpace(item.Name)
	item.ModelID = strings.TrimSpace(item.ModelID)
	item.APIURL = strings.TrimSpace(item.APIURL)
	if item.ModelID == "" {
		item.ModelID = item.Name
	}
	if item.Type == "" {
		item.Type = model.AdminModelTypeImage
	}
	if item.ID == "" {
		item.ID = newID("model")
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	return repository.SaveAdminModel(item)
}

func DeleteAdminModel(id string) error {
	return repository.DeleteAdminModel(id)
}
