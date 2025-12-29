package main

import (
  "bytes"
  "encoding/json"
  "flag"
  "fmt"
  "io"
  "net/http"
  "os"
  "time"
)

type ingestResponse struct {
  RunID   int `json:"runId"`
  Videos  int `json:"videos"`
  Channels int `json:"channels"`
  Error   string `json:"error"`
}

type runDetails struct {
  Run struct {
    ID     int    `json:"id"`
    Query  string `json:"query"`
    CreatedAt string `json:"created_at"`
  } `json:"run"`
  Stats struct {
    Videos int     `json:"videos"`
    AvgViews float64 `json:"avg_views"`
    AvgDuration float64 `json:"avg_duration"`
  } `json:"stats"`
  Channels []struct {
    Title string `json:"title"`
    SubscriberCount float64 `json:"subscriber_count"`
    TotalViews float64 `json:"total_views"`
  } `json:"channels"`
}

func main() {
  query := flag.String("query", "IA aplicada al desarrollo de software", "query to analyze")
  max := flag.Int("max", 25, "max results 5-50")
  api := flag.String("api", getenv("YTBANGER_API", "http://localhost:8080"), "backend base url")
  flag.Parse()

  payload := map[string]any{
    "query": *query,
    "maxResults": *max,
    "regionCode": "ES",
    "language": "es",
  }

  body, _ := json.Marshal(payload)
  res, err := http.Post(*api+"/api/ingest/youtube", "application/json", bytes.NewReader(body))
  if err != nil {
    fmt.Println("error:", err)
    os.Exit(1)
  }
  defer res.Body.Close()

  data, _ := io.ReadAll(res.Body)
  var ingest ingestResponse
  if err := json.Unmarshal(data, &ingest); err != nil {
    fmt.Println("error:", string(data))
    os.Exit(1)
  }
  if res.StatusCode >= 300 {
    fmt.Println("error:", ingest.Error)
    os.Exit(1)
  }

  fmt.Printf("Run %d creado: %d videos, %d canales\n", ingest.RunID, ingest.Videos, ingest.Channels)

  run, err := fetchRun(*api, ingest.RunID)
  if err != nil {
    fmt.Println("warning:", err)
    os.Exit(0)
  }

  fmt.Printf("Promedio vistas: %.0f | Duración media: %.0fs | %s\n",
    run.Stats.AvgViews, run.Stats.AvgDuration, run.Run.CreatedAt)

  fmt.Println("Top canales:")
  for i, ch := range run.Channels {
    if i >= 5 {
      break
    }
    fmt.Printf("- %s | %.0f subs | %.0f vistas\n", ch.Title, ch.SubscriberCount, ch.TotalViews)
  }
}

func fetchRun(api string, runID int) (*runDetails, error) {
  client := &http.Client{Timeout: 15 * time.Second}
  res, err := client.Get(fmt.Sprintf("%s/api/runs/%d", api, runID))
  if err != nil {
    return nil, err
  }
  defer res.Body.Close()

  data, _ := io.ReadAll(res.Body)
  if res.StatusCode >= 300 {
    return nil, fmt.Errorf("%s", string(data))
  }

  var details runDetails
  if err := json.Unmarshal(data, &details); err != nil {
    return nil, err
  }
  return &details, nil
}

func getenv(key, fallback string) string {
  if value := os.Getenv(key); value != "" {
    return value
  }
  return fallback
}
