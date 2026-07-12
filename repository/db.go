package repository

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
			driver = "sqlite"
		}
		dsn := config.Cfg.DatabaseDSN
		if driver == "sqlite" && dsn != ":memory:" {
			_ = os.MkdirAll(filepath.Dir(dsn), 0755)
		}
		db, dbErr = gorm.Open(dialector(driver, dsn), &gorm.Config{})
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
		if dbErr == nil && driver == "mysql" {
			dbErr = migrateLegacySQLite(db)
		}
	})
	return db, dbErr
}

func dialector(driver string, dsn string) gorm.Dialector {
	switch driver {
	case "mysql":
		return mysql.Open(dsn)
	case "postgres", "postgresql":
		return postgres.Open(dsn)
	default:
		return sqlite.Open(dsn)
	}
}

func migrateLegacySQLite(target *gorm.DB) error {
	dsn := strings.TrimSpace(config.Cfg.LegacySQLiteDSN)
	if dsn == "" || dsn == ":memory:" {
		return nil
	}
	if _, err := os.Stat(dsn); err != nil {
		return nil
	}
	legacy, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		return err
	}
	log.Printf("legacy sqlite import started dsn=%s", dsn)
	if err := copyLegacyTable[model.User](legacy, target); err != nil {
		return err
	}
	if err := copyLegacyTable[model.CreditLog](legacy, target); err != nil {
		return err
	}
	if err := copyLegacyTable[model.Prompt](legacy, target); err != nil {
		return err
	}
	if err := copyLegacyTable[model.Asset](legacy, target); err != nil {
		return err
	}
	if err := copyLegacyTable[model.AdminModel](legacy, target); err != nil {
		return err
	}
	if err := copyLegacyTable[model.Setting](legacy, target); err != nil {
		return err
	}
	log.Printf("legacy sqlite import finished")
	return nil
}

func copyLegacyTable[T any](legacy *gorm.DB, target *gorm.DB) error {
	items := []T{}
	if err := legacy.Find(&items).Error; err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}
	return target.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(items, 200).Error
}
