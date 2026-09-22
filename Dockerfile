FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /proofgrid-attestor ./cmd/service

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /proofgrid-attestor /proofgrid-attestor
ENV PROOFGRID_SERVICE_ADDRESS=:8080
EXPOSE 8080
ENTRYPOINT ["/proofgrid-attestor"]
