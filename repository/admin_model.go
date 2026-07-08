package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

func ListAdminModels(enabledOnly bool) ([]model.AdminModel, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	tx := db.Model(&model.AdminModel{})
	if enabledOnly {
		tx = tx.Where("enabled = ?", true)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.AdminModel
	err = tx.Order("updated_at desc").Find(&items).Error
	return items, total, err
}

func SaveAdminModel(item model.AdminModel) (model.AdminModel, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	if saved, ok, err := findAdminModel(db, item.ID); err != nil {
		return item, err
	} else if ok && item.CreatedAt == "" {
		item.CreatedAt = saved.CreatedAt
	}
	return item, db.Save(&item).Error
}

func ClearAdminModelDefaults(modelType model.AdminModelType, exceptID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.AdminModel{}).Where("type = ? AND id <> ?", modelType, exceptID).Update("is_default", false).Error
}

func DeleteAdminModel(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.AdminModel{}, "id = ?", id).Error
}

func findAdminModel(db *gorm.DB, id string) (model.AdminModel, bool, error) {
	item := model.AdminModel{}
	err := db.Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AdminModel{}, false, nil
	}
	return item, err == nil, err
}
