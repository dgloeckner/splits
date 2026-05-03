package ipm

import (
	"sync"
	"time"
)

// DeviceMonitor tracks IPM serial connectivity. The reconnecting
// SerialProducer pokes it on connect / disconnect / frame; the API
// handler reads it for /api/v1/device, and the SSE stream subscribes
// for change-driven push updates. Concurrency-safe.
type DeviceMonitor struct {
	mu          sync.RWMutex
	state       DeviceState
	subscribers map[chan DeviceState]struct{}
}

// DeviceState is the wire shape returned by /api/v1/device and the
// `device` SSE event.
type DeviceState struct {
	Connected  bool      `json:"connected"`
	Port       string    `json:"port,omitempty"`
	LastError  string    `json:"last_error,omitempty"`
	LastSeenAt time.Time `json:"last_seen_at,omitempty"`
}

func NewDeviceMonitor() *DeviceMonitor {
	return &DeviceMonitor{
		subscribers: make(map[chan DeviceState]struct{}),
	}
}

func (m *DeviceMonitor) MarkConnected(port string) {
	m.mu.Lock()
	changed := !m.state.Connected || m.state.Port != port
	m.state.Connected = true
	m.state.Port = port
	m.state.LastError = ""
	m.state.LastSeenAt = time.Now()
	if changed {
		m.broadcastLocked()
	}
	m.mu.Unlock()
}

func (m *DeviceMonitor) MarkDisconnected(err error) {
	m.mu.Lock()
	changed := m.state.Connected
	m.state.Connected = false
	m.state.Port = ""
	if err != nil {
		m.state.LastError = err.Error()
	}
	if changed {
		m.broadcastLocked()
	}
	m.mu.Unlock()
}

// Touch records that a frame just arrived. Doesn't broadcast — the
// LastSeenAt heartbeat is only consumed by the polling endpoint, not
// the SSE channel (avoids a per-frame fan-out).
func (m *DeviceMonitor) Touch() {
	m.mu.Lock()
	m.state.LastSeenAt = time.Now()
	m.mu.Unlock()
}

func (m *DeviceMonitor) State() DeviceState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

// Subscribe returns a channel that receives the current state on
// every state change (connected/disconnected/port change). Buffer
// of 4 absorbs a bursty flap. The cleanup func unregisters and
// closes the channel.
func (m *DeviceMonitor) Subscribe() (<-chan DeviceState, func()) {
	ch := make(chan DeviceState, 4)
	m.mu.Lock()
	m.subscribers[ch] = struct{}{}
	m.mu.Unlock()
	cleanup := func() {
		m.mu.Lock()
		if _, ok := m.subscribers[ch]; ok {
			delete(m.subscribers, ch)
			close(ch)
		}
		m.mu.Unlock()
	}
	return ch, cleanup
}

// broadcastLocked fans out the current state to all subscribers.
// Caller must hold m.mu. Non-blocking — drops on a full subscriber
// (the SSE handler will catch up via /api/v1/device on next reconnect).
func (m *DeviceMonitor) broadcastLocked() {
	state := m.state
	for ch := range m.subscribers {
		select {
		case ch <- state:
		default:
		}
	}
}
