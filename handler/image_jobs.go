package handler

import (
	"io"
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

func ImageJobCreate(w http.ResponseWriter, r *http.Request, kind string) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		Fail(w, "Failed to read image job request")
		return
	}
	job, err := service.CreateImageJob(r, kind, body)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"id": job.ID, "status": job.Status})
}

func ImageJobStatus(w http.ResponseWriter, _ *http.Request, id string) {
	job, ok, err := service.GetImageJob(id)
	if err != nil {
		FailError(w, err)
		return
	}
	if !ok {
		http.Error(w, "image job not found or expired", http.StatusNotFound)
		return
	}
	OK(w, job)
}
