package model

type AdminModelType string

const (
	AdminModelTypeImage AdminModelType = "image"
	AdminModelTypeVideo AdminModelType = "video"
)

// AdminModel 后台可配置的模型。
type AdminModel struct {
	ID        string         `json:"id" gorm:"primaryKey"`
	Name      string         `json:"name"`
	Type      AdminModelType `json:"type" gorm:"index"`
	APIURL    string         `json:"apiUrl"`
	Enabled   bool           `json:"enabled"`
	Remark    string         `json:"remark"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

// AdminModelList 模型分页结果。
type AdminModelList struct {
	Items []AdminModel `json:"items"`
	Total int          `json:"total"`
}
