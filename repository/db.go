package repository

import (
	"fmt"
	"strings"
	"sync"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var promptCategories = []model.PromptCategory{
	{Category: "gpt-image-2-prompts", Name: "GPT Image 2", Description: "GPT Image 2 提示词分类", GithubURL: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts", Remote: true},
}

var (
	db     *gorm.DB
	dbOnce sync.Once
	dbErr  error
)

// DB 初始化并返回全局数据库连接。
func DB() (*gorm.DB, error) {
	dbOnce.Do(func() {
		driver := strings.ToLower(strings.TrimSpace(config.Cfg.StorageDriver))
		if driver == "" {
			driver = "mysql"
		}
		dsn := config.Cfg.DatabaseDSN
		dbDialector, err := dialector(driver, dsn)
		if err != nil {
			dbErr = err
			return
		}
		db, dbErr = gorm.Open(dbDialector, &gorm.Config{})
		if dbErr != nil {
			return
		}
		dbErr = db.AutoMigrate(
			&model.User{},
			&model.CreditLog{},
			&model.Prompt{},
			&model.Asset{},
			&model.AdminModel{},
			&model.Setting{},
		)
	})
	return db, dbErr
}

func dialector(driver string, dsn string) (gorm.Dialector, error) {
	switch driver {
	case "mysql":
		return mysql.Open(dsn), nil
	case "postgres", "postgresql":
		return postgres.Open(dsn), nil
	default:
		return nil, fmt.Errorf("unsupported storage driver %q: use mysql or postgres", driver)
	}
}
