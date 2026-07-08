package model

type AdminModelType string

const (
	AdminModelTypeImage AdminModelType = "image"
	AdminModelTypeVideo AdminModelType = "video"
	AdminModelTypeParse AdminModelType = "parse"
	AdminModelTypePrompt AdminModelType = "prompt"
	AdminModelTypeDetailPrompt AdminModelType = "detail_prompt"
)

type VideoCapabilities struct {
	Market                   string   `json:"market"`
	Ratios                   []string `json:"ratios" gorm:"serializer:json"`
	Qualities                []string `json:"qualities" gorm:"serializer:json"`
	Durations                []int    `json:"durations" gorm:"serializer:json"`
	DefaultRatio             string   `json:"defaultRatio"`
	DefaultQuality           string   `json:"defaultQuality"`
	DefaultDuration          int      `json:"defaultDuration"`
	ReferenceImageLimit      int      `json:"referenceImageLimit"`
	RequireImageReference    bool     `json:"requireImageReference"`
	ReferenceVideoLimit      int      `json:"referenceVideoLimit"`
	ReferenceVideoMaxSeconds int      `json:"referenceVideoMaxSeconds"`
	ReferenceAudioLimit      int      `json:"referenceAudioLimit"`
	SupportsImageReferences  bool     `json:"supportsImageReferences"`
	SupportsVideoReferences  bool     `json:"supportsVideoReferences"`
	SupportsAudioReferences  bool     `json:"supportsAudioReferences"`
}

// AdminModel 后台可配置的模型。
type AdminModel struct {
	ID                string            `json:"id" gorm:"primaryKey"`
	Name              string            `json:"name"`
	ModelID           string            `json:"modelId"`
	Type              AdminModelType    `json:"type" gorm:"index"`
	APIURL            string            `json:"apiUrl"`
	APIKey            string            `json:"apiKey"`
	TierModels        map[string]string `json:"tierModels" gorm:"serializer:json"`
	DefaultTier       string            `json:"defaultTier"`
	SupportedSizes    []string          `json:"supportedSizes" gorm:"serializer:json"`
	ReferenceLimit    int               `json:"referenceLimit"`
	VideoCapabilities VideoCapabilities `json:"videoCapabilities" gorm:"serializer:json"`
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
