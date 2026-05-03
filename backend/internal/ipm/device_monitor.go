package ipm

import (
	"sync"
	"time"
)

// DeviceMonitor tracks IPM serial connectivity. The reconnecting
// SerialProducer pokes it on connect / disconnect / frame; the API
// handler reads it for /api/v1/device. Concurrency-safe; cheap to
// poll.
type DeviceMonitor struct {
	mu         sync.RWMutex
	connected  bool
	port       string
	lastError  string
	lastSeenAt time.Time
}

// DeviceState is the wire shape returned by /api/v1/device.
type DeviceState struct {
	Connected  bool      `json:"connected"`
	Port       string    `json:"port,omitempty"`
	LastError  string    `json:"last_error,omitempty"`
	LastSeenAt time.Time `json:"last_seen_at,omitempty"`
}

func NewDeviceMonitor() *DeviceMonitor { return &DeviceMonitor{} }

func (m *DeviceMonitor) MarkConnected(port string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.connected = true
	m.port = port
	m.lastError = ""
	m.lastSeenAt = time.Now()
}

func (m *DeviceMonitor) MarkDisconnected(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.connected = false
	if err != nil {
		m.lastError = err.Error()
	}
}

// Touch records that a frame just arrived; lets the UI distinguish
// "port open but device idle" from "port lost".
func (m *DeviceMonitor) Touch() {
	m.mu.Lock()
	m.lastSeenAt = time.Now()
	m.mu.Unlock()
}

func (m *DeviceMonitor) State() DeviceState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return DeviceState{
		Connected:  m.connected,
		Port:       m.port,
		LastError:  m.lastError,
		LastSeenAt: m.lastSeenAt,
	}
}
