package model

type AdminModelType string

const (
	AdminModelTypeImage AdminModelType = "image"
	AdminModelTypeParse AdminModelType = "parse"
	AdminModelTypePrompt AdminModelType = "prompt"
	AdminModelTypeDetailPrompt AdminModelType = "detail_prompt"
)

// AdminModel 后台可配置的模型。
type AdminModel struct {
	ID                string            `json:"id" gorm:"type:varchar(191);primaryKey"`
	Name              string            `json:"name"`
	ModelID           string            `json:"modelId"`
	Type              AdminModelType    `json:"type" gorm:"type:varchar(32);index"`
	APIURL            string            `json:"apiUrl"`
	APIKey            string            `json:"apiKey"`
	TierModels        map[string]string `json:"tierModels" gorm:"serializer:json"`
	DefaultTier       string            `json:"defaultTier"`
	SupportedSizes    []string          `json:"supportedSizes" gorm:"serializer:json"`
	ReferenceLimit    int               `json:"referenceLimit"`
	HasAPIKey         bool              `json:"hasApiKey" gorm:"-"`
	IsDefault         bool              `json:"isDefault" gorm:"index"`
	Enabled           bool              `json:"enabled"`
	Remark            string            `json:"remark"`
	CreatedAt         string            `json:"createdAt"`
	UpdatedAt         string            `json:"updatedAt"`
}

// AdminModelList 模型分页结果。
type AdminModelList struct {
	Items []AdminModel `json:"items"`
	Total int          `json:"total"`
}
