package handler

import (
	"io"
	"net/http"
	"strconv"

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
	w.Header().Set("Cache-Control", "no-store")
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

func ImageJobResult(w http.ResponseWriter, _ *http.Request, id string, indexValue string) {
	index, err := strconv.Atoi(indexValue)
	if err != nil || index < 0 {
		http.Error(w, "invalid image result index", http.StatusBadRequest)
		return
	}
	data, contentType, ok, err := service.GetImageJobResult(id, index)
	if err != nil {
		FailError(w, err)
		return
	}
	if !ok {
		http.Error(w, "image job result not found or expired", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "private, max-age=1800, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
