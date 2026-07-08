package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

func Balance(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Key  string   `json:"key"`
		Keys []string `json:"keys"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	keys := append(payload.Keys, payload.Key)
	result, err := service.QueryBalance(keys)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
