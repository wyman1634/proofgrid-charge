package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

func newHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(response).Encode(map[string]string{"status": "ok"}); err != nil {
			http.Error(response, "failed to encode response", http.StatusInternalServerError)
		}
	})
	return mux
}

func main() {
	address := os.Getenv("PROOFGRID_SERVICE_ADDRESS")
	if address == "" {
		address = ":8080"
	}
	log.Printf("ProofGrid Charge Go service listening on %s", address)
	if err := http.ListenAndServe(address, newHandler()); err != nil {
		log.Fatal(err)
	}
}
