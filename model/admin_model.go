package model

type AdminModelType string

const (
	AdminModelTypeImage AdminModelType = "image"
	AdminModelTypeVideo AdminModelType = "video"
	AdminModelTypeParse AdminModelType = "parse"
	AdminModelTypePrompt AdminModelType = "prompt"
)

// AdminModel 后台可配置的模型。
type AdminModel struct {
	ID             string            `json:"id" gorm:"primaryKey"`
	Name           string            `json:"name"`
	ModelID        string            `json:"modelId"`
	Type           AdminModelType    `json:"type" gorm:"index"`
	APIURL         string            `json:"apiUrl"`
	APIKey         string            `json:"apiKey"`
	TierModels     map[string]string `json:"tierModels" gorm:"serializer:json"`
	SupportedSizes []string          `json:"supportedSizes" gorm:"serializer:json"`
	ReferenceLimit int               `json:"referenceLimit"`
	HasAPIKey      bool              `json:"hasApiKey" gorm:"-"`
	Enabled        bool              `json:"enabled"`
	Remark         string            `json:"remark"`
	CreatedAt      string            `json:"createdAt"`
	UpdatedAt      string            `json:"updatedAt"`
}

// AdminModelList 模型分页结果。
type AdminModelList struct {
	Items []AdminModel `json:"items"`
	Total int          `json:"total"`
}
