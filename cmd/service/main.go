package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"golang.org/x/crypto/sha3"
)

type attestationRequest struct {
	SessionID         string          `json:"sessionId"`
	StationID         string          `json:"stationId"`
	ChargingOperator  string          `json:"chargingOperator"`
	RawChargingData   rawChargingData `json:"rawChargingData"`
	Expiry            uint64          `json:"expiry"`
	ChainID           uint64          `json:"chainId"`
	VerifyingContract string          `json:"verifyingContract"`
}

type rawChargingData struct {
	SessionID    string `json:"sessionId"`
	StationID    string `json:"stationId"`
	MeterStartWh uint64 `json:"meterStartWh"`
	MeterEndWh   uint64 `json:"meterEndWh"`
}

type attestationResponse struct {
	RawChargingData string              `json:"rawChargingData"`
	EvidenceHash    string              `json:"evidenceHash"`
	ActualEnergyWh  uint64              `json:"actualEnergyWh"`
	Attestation     chargingAttestation `json:"attestation"`
	Signature       string              `json:"signature"`
}

type chargingAttestation struct {
	SessionID        string `json:"sessionId"`
	StationID        string `json:"stationId"`
	ChargingOperator string `json:"chargingOperator"`
	ActualEnergyWh   uint64 `json:"actualEnergyWh"`
	EvidenceHash     string `json:"evidenceHash"`
	Expiry           uint64 `json:"expiry"`
}

func keccak256Hex(value []byte) string {
	hash := sha3.NewLegacyKeccak256()
	_, _ = hash.Write(value)
	return fmt.Sprintf("0x%x", hash.Sum(nil))
}

func keccak256(value []byte) []byte {
	hash := sha3.NewLegacyKeccak256()
	_, _ = hash.Write(value)
	return hash.Sum(nil)
}

func uint256Word(value uint64) []byte {
	word := make([]byte, 32)
	binary.BigEndian.PutUint64(word[24:], value)
	return word
}

func attestationDigest(input attestationRequest, attestation chargingAttestation) []byte {
	domainTypeHash := keccak256([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	domain := append([]byte{}, domainTypeHash...)
	domain = append(domain, keccak256([]byte("ProofGrid Charge"))...)
	domain = append(domain, keccak256([]byte("1"))...)
	domain = append(domain, uint256Word(input.ChainID)...)
	domain = append(domain, common.LeftPadBytes(common.HexToAddress(input.VerifyingContract).Bytes(), 32)...)
	domainSeparator := keccak256(domain)

	attestationTypeHash := keccak256([]byte("ChargingAttestation(bytes32 sessionId,bytes32 stationId,address chargingOperator,uint256 actualEnergyWh,bytes32 evidenceHash,uint256 expiry)"))
	message := append([]byte{}, attestationTypeHash...)
	message = append(message, common.HexToHash(attestation.SessionID).Bytes()...)
	message = append(message, common.HexToHash(attestation.StationID).Bytes()...)
	message = append(message, common.LeftPadBytes(common.HexToAddress(attestation.ChargingOperator).Bytes(), 32)...)
	message = append(message, uint256Word(attestation.ActualEnergyWh)...)
	message = append(message, common.HexToHash(attestation.EvidenceHash).Bytes()...)
	message = append(message, uint256Word(attestation.Expiry)...)
	messageHash := keccak256(message)

	return keccak256(append(append([]byte{0x19, 0x01}, domainSeparator...), messageHash...))
}

func signAttestation(input attestationRequest, attestation chargingAttestation) (string, error) {
	privateKeyHex := strings.TrimPrefix(os.Getenv("PROOFGRID_ATTESTOR_PRIVATE_KEY"), "0x")
	if privateKeyHex == "" {
		return "", fmt.Errorf("PROOFGRID_ATTESTOR_PRIVATE_KEY is required")
	}
	privateKey, err := crypto.HexToECDSA(privateKeyHex)
	if err != nil {
		return "", fmt.Errorf("invalid PROOFGRID_ATTESTOR_PRIVATE_KEY: %w", err)
	}
	signature, err := crypto.Sign(attestationDigest(input, attestation), privateKey)
	if err != nil {
		return "", fmt.Errorf("sign Charging Attestation: %w", err)
	}
	signature[64] += 27
	return fmt.Sprintf("0x%x", signature), nil
}

func newHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(response).Encode(map[string]string{"status": "ok"}); err != nil {
			http.Error(response, "failed to encode response", http.StatusInternalServerError)
		}
	})
	mux.HandleFunc("POST /attestations", func(response http.ResponseWriter, request *http.Request) {
		var input attestationRequest
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			http.Error(response, "invalid request", http.StatusBadRequest)
			return
		}
		if input.RawChargingData.SessionID != input.SessionID {
			http.Error(response, "raw charging data does not match requested Charging Session", http.StatusBadRequest)
			return
		}
		if input.RawChargingData.StationID != input.StationID {
			http.Error(response, "raw charging data does not match requested Charging Station", http.StatusBadRequest)
			return
		}
		if input.RawChargingData.MeterEndWh < input.RawChargingData.MeterStartWh {
			http.Error(response, "meter end must not be lower than meter start", http.StatusBadRequest)
			return
		}
		record := input.RawChargingData
		canonicalChargingData, err := json.Marshal(record)
		if err != nil {
			http.Error(response, "failed to encode raw charging data", http.StatusInternalServerError)
			return
		}
		evidenceHash := keccak256Hex(canonicalChargingData)
		attestation := chargingAttestation{
			SessionID: input.SessionID, StationID: input.StationID,
			ChargingOperator: input.ChargingOperator,
			ActualEnergyWh:   record.MeterEndWh - record.MeterStartWh,
			EvidenceHash:     evidenceHash, Expiry: input.Expiry,
		}
		signature, err := signAttestation(input, attestation)
		if err != nil {
			http.Error(response, "attestor signing is unavailable", http.StatusInternalServerError)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(response).Encode(attestationResponse{
			RawChargingData: string(canonicalChargingData), EvidenceHash: evidenceHash,
			ActualEnergyWh: attestation.ActualEnergyWh, Attestation: attestation, Signature: signature,
		}); err != nil {
			http.Error(response, "failed to encode response", http.StatusInternalServerError)
		}
	})
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Access-Control-Allow-Origin", "*")
		response.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		response.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if request.Method == http.MethodOptions {
			response.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(response, request)
	})
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
