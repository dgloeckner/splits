package api

import (
	"net/http"

	"github.com/gloeckner-daniel/splits/internal/ipm"
)

// DeviceStatusHandler returns the current IPM serial connectivity
// state. Cheap; the frontend polls this every few seconds to drive
// the connection banner.
func DeviceStatusHandler(m *ipm.DeviceMonitor) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, m.State())
	})
}
