package router

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/handler"
	"github.com/basketikun/infinite-canvas/middleware"
	"github.com/gin-gonic/gin"
)

func New() *gin.Engine {
	router := gin.Default()
	router.RedirectTrailingSlash = false
	_ = router.SetTrustedProxies(nil)
	api := router.Group("/api")
	api.GET("/health", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})
	api.POST("/auth/login", gin.WrapF(handler.Login))
	api.GET("/auth/linux-do/authorize", gin.WrapF(handler.LinuxDoAuthorize))
	api.GET("/auth/linux-do/callback", gin.WrapF(handler.LinuxDoCallback))
	api.GET("/auth/me", middleware.OptionalAuth, gin.WrapF(handler.CurrentUser))
	api.GET("/settings", gin.WrapF(handler.Settings))
	api.GET("/internal/image-bed-settings", gin.WrapF(handler.InternalImageBedSettings))
	api.GET("/models", gin.WrapF(handler.Models))
	api.POST("/balance", gin.WrapF(handler.Balance))
	api.POST("/prompt/extract", gin.WrapF(handler.PromptExtract))
	api.POST("/detail-llm", gin.WrapF(handler.DetailLLM))
	api.GET("/events", gin.WrapF(handler.Events))
	api.POST("/image-jobs/:kind", func(c *gin.Context) {
		handler.ImageJobCreate(c.Writer, c.Request, c.Param("kind"))
	})
	api.GET("/image-jobs/status/:id", func(c *gin.Context) {
		handler.ImageJobStatus(c.Writer, c.Request, c.Param("id"))
	})
	api.POST("/image-jobs/cancel/:id", func(c *gin.Context) {
		handler.ImageJobCancel(c.Writer, c.Request, c.Param("id"))
	})
	api.GET("/image-jobs/result/:id/:index", func(c *gin.Context) {
		handler.ImageJobResult(c.Writer, c.Request, c.Param("id"), c.Param("index"))
	})
	v1 := api.Group("/v1", middleware.UserAuth)
	v1.POST("/images/generations", gin.WrapF(handler.AIImagesGenerations))
	v1.POST("/images/edits", gin.WrapF(handler.AIImagesEdits))
	v1.POST("/chat/completions", gin.WrapF(handler.AIChatCompletions))
	api.GET("/prompts", middleware.OptionalAuth, gin.WrapF(handler.Prompts))
	api.GET("/assets", middleware.OptionalAuth, gin.WrapF(handler.Assets))
	api.POST("/admin/login", gin.WrapF(handler.AdminLogin))

	admin := api.Group("/admin", middleware.AdminAuth)
	admin.GET("/users", gin.WrapF(handler.AdminUsers))
	admin.POST("/users", gin.WrapF(handler.AdminSaveUser))
	admin.POST("/users/:id/credits", func(c *gin.Context) {
		handler.AdminAdjustUserCredits(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/users/:id", func(c *gin.Context) {
		handler.AdminDeleteUser(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/credit-logs", gin.WrapF(handler.AdminCreditLogs))
	admin.POST("/credit-logs", gin.WrapF(handler.AdminSaveCreditLog))
	admin.DELETE("/credit-logs/:id", func(c *gin.Context) {
		handler.AdminDeleteCreditLog(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/settings", gin.WrapF(handler.AdminSettings))
	admin.POST("/settings", gin.WrapF(handler.AdminSaveSettings))
	admin.POST("/settings/channel-models", gin.WrapF(handler.AdminChannelModels))
	admin.POST("/settings/channel-test", gin.WrapF(handler.AdminTestChannelModel))
	admin.GET("/prompt-categories", gin.WrapF(handler.AdminPromptCategories))
	admin.POST("/prompt-categories/sync", gin.WrapF(handler.AdminSyncPromptCategories))
	admin.GET("/prompts", gin.WrapF(handler.AdminPrompts))
	admin.POST("/prompts", gin.WrapF(handler.AdminSavePrompt))
	admin.POST("/prompts/batch-delete", gin.WrapF(handler.AdminDeletePrompts))
	admin.DELETE("/prompts/:id", func(c *gin.Context) {
		handler.AdminDeletePrompt(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/assets", gin.WrapF(handler.AdminAssets))
	admin.POST("/assets", gin.WrapF(handler.AdminSaveAsset))
	admin.DELETE("/assets/:id", func(c *gin.Context) {
		handler.AdminDeleteAsset(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/models", gin.WrapF(handler.AdminModels))
	admin.POST("/models", func(c *gin.Context) {
		handler.AdminSaveModel(c.Writer, c.Request, "")
	})
	admin.POST("/models/:id", func(c *gin.Context) {
		handler.AdminSaveModel(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/models/:id", func(c *gin.Context) {
		handler.AdminDeleteModel(c.Writer, c.Request, c.Param("id"))
	})

	router.NoRoute(middleware.NotFoundJSON)

	return router
}
