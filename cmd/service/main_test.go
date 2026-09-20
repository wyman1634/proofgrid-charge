package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const testAttestorPrivateKey = "7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
const testAttestationRequest = `{
	"sessionId":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	"stationId":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	"chargingOperator":"0x1111111111111111111111111111111111111111",
	"rawChargingData":{
		"sessionId":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"stationId":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"meterStartWh":120000,
		"meterEndWh":138400
	},
	"expiry":1789635600,
	"chainId":31337,
	"verifyingContract":"0x2222222222222222222222222222222222222222"
}`

func newAttestationHTTPRequest() *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/attestations", bytes.NewBufferString(testAttestationRequest))
	request.Header.Set("Content-Type", "application/json")
	return request
}

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

func TestAttestationEndpointDerivesCanonicalRawChargingData(t *testing.T) {
	t.Setenv("PROOFGRID_ATTESTOR_PRIVATE_KEY", testAttestorPrivateKey)
	response := httptest.NewRecorder()

	newHandler().ServeHTTP(response, newAttestationHTTPRequest())

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, response.Code, response.Body.String())
	}
	var body struct {
		RawChargingData string `json:"rawChargingData"`
		EvidenceHash    string `json:"evidenceHash"`
		ActualEnergyWh  uint64 `json:"actualEnergyWh"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	expectedChargingData := `{"sessionId":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","stationId":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","meterStartWh":120000,"meterEndWh":138400}`
	if body.RawChargingData != expectedChargingData {
		t.Fatalf("expected canonical charging data %q, got %q", expectedChargingData, body.RawChargingData)
	}
	if body.ActualEnergyWh != 18_400 {
		t.Fatalf("expected Actual Energy 18400 Wh, got %d", body.ActualEnergyWh)
	}
	if body.EvidenceHash != "0xae0e81125c11345eae1bb86753d3755e71479b2e74a0d86b21d8a6aa2896a3d2" {
		t.Fatalf("expected independently reproducible Evidence Hash, got %q", body.EvidenceHash)
	}
}

func TestAttestationEndpointSignsTheEIP712ChargingAttestation(t *testing.T) {
	t.Setenv("PROOFGRID_ATTESTOR_PRIVATE_KEY", testAttestorPrivateKey)
	response := httptest.NewRecorder()

	newHandler().ServeHTTP(response, newAttestationHTTPRequest())

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, response.Code, response.Body.String())
	}
	var body struct {
		Attestation struct {
			SessionID        string `json:"sessionId"`
			StationID        string `json:"stationId"`
			ChargingOperator string `json:"chargingOperator"`
			ActualEnergyWh   uint64 `json:"actualEnergyWh"`
			EvidenceHash     string `json:"evidenceHash"`
			Expiry           uint64 `json:"expiry"`
		} `json:"attestation"`
		Signature string `json:"signature"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Attestation.ActualEnergyWh != 18_400 || body.Attestation.EvidenceHash != "0xae0e81125c11345eae1bb86753d3755e71479b2e74a0d86b21d8a6aa2896a3d2" {
		t.Fatalf("unexpected signed Charging Attestation: %+v", body.Attestation)
	}
	const expectedSignature = "0x54d3bc139be31bfd04e5fa72aa426c054a02022028fc2573b3113012337980be55986279a4ee735f671f9e55e8999b807bf387115b5aca19614808e82ed494cc1c"
	if body.Signature != expectedSignature {
		t.Fatalf("expected EIP-712 signature %s, got %s", expectedSignature, body.Signature)
	}
}

func TestAttestationEndpointRejectsReversedMeterReadings(t *testing.T) {
	t.Setenv("PROOFGRID_ATTESTOR_PRIVATE_KEY", testAttestorPrivateKey)
	requestBody := []byte(`{
		"sessionId":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"stationId":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"chargingOperator":"0x1111111111111111111111111111111111111111",
		"rawChargingData":{
			"sessionId":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"stationId":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			"meterStartWh":138400,
			"meterEndWh":120000
		},
		"expiry":1789635600,
		"chainId":31337,
		"verifyingContract":"0x2222222222222222222222222222222222222222"
	}`)
	request := httptest.NewRequest(http.MethodPost, "/attestations", bytes.NewReader(requestBody))
	response := httptest.NewRecorder()

	newHandler().ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d: %s", http.StatusBadRequest, response.Code, response.Body.String())
	}
}

func TestAttestationEndpointRejectsRawChargingDataForAnotherSessionOrStation(t *testing.T) {
	t.Setenv("PROOFGRID_ATTESTOR_PRIVATE_KEY", testAttestorPrivateKey)
	tests := []struct {
		name    string
		payload string
		message string
	}{
		{
			name: "Session",
			payload: `{
				"sessionId":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				"stationId":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				"chargingOperator":"0x1111111111111111111111111111111111111111",
				"rawChargingData":{"sessionId":"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","stationId":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","meterStartWh":120000,"meterEndWh":138400},
				"expiry":1789635600,"chainId":31337,"verifyingContract":"0x2222222222222222222222222222222222222222"
			}`,
			message: "raw charging data does not match requested Charging Session\n",
		},
		{
			name: "Station",
			payload: `{
				"sessionId":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				"stationId":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				"chargingOperator":"0x1111111111111111111111111111111111111111",
				"rawChargingData":{"sessionId":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","stationId":"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","meterStartWh":120000,"meterEndWh":138400},
				"expiry":1789635600,"chainId":31337,"verifyingContract":"0x2222222222222222222222222222222222222222"
			}`,
			message: "raw charging data does not match requested Charging Station\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/attestations", bytes.NewBufferString(test.payload))
			response := httptest.NewRecorder()

			newHandler().ServeHTTP(response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("expected status %d, got %d: %s", http.StatusBadRequest, response.Code, response.Body.String())
			}
			if response.Body.String() != test.message {
				t.Fatalf("expected stable error %q, got %q", test.message, response.Body.String())
			}
		})
	}
}
