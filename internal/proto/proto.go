// Package proto is the wire format between the app and the agent running in the container:
// one JSON object per line in each direction, over the stdin/stdout of `oc exec`.
//
// The app sends requests {id, method, params}; the agent answers each with {id, result} or
// {id, error}, in any order. The agent also sends events {event, params} on its own (terminal
// output, a terminal exiting).
package proto

import "encoding/json"

type Message struct {
	ID     int64           `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
	Event  string          `json:"event,omitempty"`
}
