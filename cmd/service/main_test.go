package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthEndpointReportsTheGoServiceIsReady(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()

	newHandler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.Code)
	}
	if got := response.Body.String(); got != "{\"status\":\"ok\"}\n" {
		t.Fatalf("expected stable health response, got %q", got)
	}
}
