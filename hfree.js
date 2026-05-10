var http2 = require("http2");
var https = require("https");
var tls = require("tls");
var URL = require("url").URL;

// --- DYNAMIC DATA LISTS ---
var REFERERS_MAP = {
    google: ["https://www.google.com/", "https://www.google.co.id/", "https://www.google.co.uk/"],
    bing: ["https://www.bing.com/", "https://www.bing.co.uk/"],
    yandex: ["https://yandex.com/", "https://yandex.ru/"],
    brave: ["https://search.brave.com/"],
};
var ALL_REFERERS = [].concat(...Object.values(REFERERS_MAP), "https://duckduckgo.com/");

var LANGS = [
    "en-US,en;q=0.9",
    "en-GB,en;q=0.9",
    "en-US,en;q=0.8,fr;q=0.7",
    "id-ID,id;q=0.9,en;q=0.8",
];

// --- CLI ARGUMENT PARSING ---
var args = process.argv.slice(2);

if (args.length < 3) {
    console.log("Usage: node main.js <url> <time> <rate> [threads] [browser] [os] [referer] [method] [protocol]");
    console.log("  url      : Target HTTPS URL                          e.g. https://example.com");
    console.log("  time     : Duration in seconds                       e.g. 30");
    console.log("  rate     : Requests per second                       e.g. 5");
    console.log("  threads  : Worker count (default: 1)                 e.g. 4");
    console.log("  browser  : chrome|firefox|edge|opera|gecko|mixed     (default: mixed)");
    console.log("  os       : random|windows|macos|linux|iphone|android (default: random)");
    console.log("  referer  : google|bing|yandex|brave|mixed            (default: mixed)");
    console.log("  method   : get|post|head|put|nonstandard             (default: get)");
    console.log("  protocol : tlsv1.0|tlsv1.1|tlsv1.2|tlsv1.3|mixed     (default: mixed)");
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

if (isNaN(duration) || duration <= 0) {
    console.log("Error: time must be > 0");
    process.exit(1);
}
if (isNaN(rate) || rate <= 0) {
    console.log("Error: rate must be > 0");
    process.exit(1);
}
if (isNaN(threads) || threads <= 0) threads = 1;

var parsedUrl;
try {
    parsedUrl = new URL(targetUrl);
} catch (e) {
    console.log("Error: Invalid URL - " + targetUrl);
    process.exit(1);
}

if (parsedUrl.protocol !== "https:") {
    console.log("Error: URL must use HTTPS");
    process.exit(1);
}

// --- UTILITIES ---
function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randStr(length) {
    var result = "";
    var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// --- DYNAMIC USER-AGENT GENERATION ---
function generateUserAgent() {
    var os = osOpt === "random" ? rand(["windows", "macos", "linux", "iphone", "android"]) : osOpt;
    var browser = browserOpt === "mixed" ? rand(["chrome", "firefox", "edge", "opera"]) : browserOpt;
    if (browser === "gecko") browser = "firefox";

    var osString = "";
    if (os === "windows") osString = "Windows NT 10.0; Win64; x64";
    else if (os === "macos") osString = "Macintosh; Intel Mac OS X 10_15_7";
    else if (os === "linux") osString = "X11; Linux x86_64";
    else if (os === "iphone") osString = "iPhone; CPU iPhone OS 16_5 like Mac OS X";
    else if (os === "android") osString = "Linux; Android 13; SM-G998B";

    var chromeVer = rand(["114", "115", "116", "117", "118", "120", "124"]);
    var ffVer = rand(["109", "112", "115", "118", "120"]);

    if (os === "iphone") {
        return `Mozilla/5.0 (${osString}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1`;
    }

    if (browser === "firefox") {
        return `Mozilla/5.0 (${osString}; rv:${ffVer}.0) Gecko/20100101 Firefox/${ffVer}.0`;
    } else if (browser === "edge") {
        return `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Safari/537.36 Edg/${chromeVer}.0.0.0`;
    } else if (browser === "opera") {
        return `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Safari/537.36 OPR/${chromeVer - 15}.0.0.0`;
    } else { // Chrome fallback
        return `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Safari/537.36`;
    }
}

// --- DYNAMIC REFERER SELECTION ---
function getReferer() {
    if (refererOpt === "mixed") return rand(ALL_REFERERS);
    return rand(REFERERS_MAP[refererOpt] || ALL_REFERERS);
}

// --- DYNAMIC TLS VERSIONING ---
function getTlsVersions() {
    var min = "TLSv1.2", max = "TLSv1.3";
    if (protocolOpt === "tlsv1.0") { min = "TLSv1.0"; max = "TLSv1.0"; }
    else if (protocolOpt === "tlsv1.1") { min = "TLSv1.1"; max = "TLSv1.1"; }
    else if (protocolOpt === "tlsv1.2") { min = "TLSv1.2"; max = "TLSv1.2"; }
    else if (protocolOpt === "tlsv1.3") { min = "TLSv1.3"; max = "TLSv1.3"; }
    return { minVersion: min, maxVersion: max };
}

var globalCfClearance = "";

function buildH2Headers(path, host) {
    return {
        ":method": methodOpt,
        ":path": path,
        ":scheme": "https",
        ":authority": host,
        "user-agent": generateUserAgent(),
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": rand(LANGS),
        "cache-control": "max-age=0, no-cache, no-store, must-revalidate",
        pragma: "no-cache",
        cookie: "session=" + randStr(16) + (globalCfClearance ? "; cf_clearance=" + globalCfClearance : "; cf_clearance=" + randStr(32)),
        authorization: "Bearer " + randStr(24),
        referer: getReferer(),
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
    };
}

var stopped = false;
var totalSent = 0;
var totalDone = 0;
var totalLatency = 0;
var detectedProto = "HTTP/2 + " + (protocolOpt === "mixed" ? "TLS (Mixed)" : protocolOpt.toUpperCase());
var counts = {};
var errors = {};

function probeAlpn(hostname, port, cb) {
    var tlsOpts = getTlsVersions();
    var sock = tls.connect(
        {
            host: hostname,
            port: port,
            servername: hostname,
            ALPNProtocols: ["h2", "http/1.1"],
            minVersion: tlsOpts.minVersion,
            maxVersion: tlsOpts.maxVersion,
            rejectUnauthorized: false,
            checkServerIdentity: () => undefined,
            timeout: 5000,
        },
        function () {
            var proto = sock.alpnProtocol;
            sock.destroy();
            if (proto === "h2") cb(null);
            else cb(new Error("Server doesn't support HTTP/2 with " + tlsOpts.minVersion + ". ALPN: " + (proto || "none")));
        },
    );
    sock.on("error", function (e) { cb(new Error("TLS Failed: " + e.message)); });
    sock.on("timeout", function () { sock.destroy(); cb(new Error("Probe timeout")); });
}

var pool = [];
for (var pi = 0; pi < threads; pi++) {
    pool.push({ session: null, ready: false, connecting: false, queue: [], activeStreams: 0 });
}

var tlsOpts = getTlsVersions();
var H2_OPTS = {
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined,
    servername: parsedUrl.hostname,
    minVersion: tlsOpts.minVersion,
    maxVersion: tlsOpts.maxVersion,
    settings: {
        initialWindowSize: 1048576,
        maxConcurrentStreams: 256,
    },
};

function spawnSession(idx) {
    if (stopped) return;
    var slot = pool[idx];
    if (slot.connecting) return;
    slot.connecting = true;
    slot.ready = false;
    slot.session = null;

    var sess = http2.connect("https://" + parsedUrl.host, H2_OPTS);

    sess.once("connect", function () {
        slot.session = sess;
        slot.ready = true;
        slot.connecting = false;
        var q = slot.queue.splice(0);
        for (var i = 0; i < q.length; i++) q[i](sess);
    });

    function onDead() {
        if (slot.session === sess) {
            slot.session = null;
            slot.ready = false;
            slot.connecting = false;
        }
        slot.activeStreams = 0;
        var q = slot.queue.splice(0);
        for (var i = 0; i < q.length; i++) q[i](null);
        if (!stopped) setTimeout(function () { spawnSession(idx); }, 300);
    }

    sess.on("error", onDead);
    sess.on("close", onDead);
    sess.on("goaway", onDead);

    var ht = setTimeout(function () {
        if (!slot.ready) sess.destroy();
    }, 6000);
    sess.once("connect", function () { clearTimeout(ht); });
}

function getSession(idx, callback) {
    var slot = pool[idx];
    if (slot.ready && slot.session && !slot.session.destroyed) return callback(slot.session);
    slot.queue.push(callback);
    if (!slot.connecting) spawnSession(idx);
}

function maxStreams(sess) {
    var r = sess && sess.remoteSettings;
    return r && r.maxConcurrentStreams ? r.maxConcurrentStreams : 100;
}

function doH2Request(idx) {
    var slot = pool[idx];
    if (slot.activeStreams >= maxStreams(slot.session)) return;

    getSession(idx, function (sess) {
        if (!sess || sess.destroyed) return;
        if (slot.activeStreams >= maxStreams(sess)) return;

        var rnd = randStr(8) + "=" + randStr(8);
        var path = parsedUrl.pathname + (parsedUrl.search ? parsedUrl.search + "&" : "?") + rnd;
        var start = Date.now();
        
        totalSent++;
        slot.activeStreams++;

        var req;
        try {
            req = sess.request(buildH2Headers(path, parsedUrl.host));
        } catch (e) {
            totalSent--;
            slot.activeStreams--;
            if (e.code !== "ERR_HTTP2_INVALID_SESSION" && e.code !== "ERR_HTTP2_GOAWAY_SESSION") {
                var k = e.code || e.message.slice(0, 40);
                errors[k] = (errors[k] || 0) + 1;
            }
            return;
        }

        req.setEncoding("utf8");
        var status = null;

        req.on("response", function (hdrs) {
            status = String(hdrs[":status"] || "0");
            var sc = hdrs["set-cookie"];
            if (sc) {
                if (!Array.isArray(sc)) sc = [sc];
                for (var i = 0; i < sc.length; i++) {
                    var m = sc[i].match(/cf_clearance=([^;]+)/);
                    if (m && m[1]) globalCfClearance = m[1];
                }
            }
        });
        
        req.on("data", function () { });
        req.on("end", function () {
            slot.activeStreams = Math.max(0, slot.activeStreams - 1);
            totalDone++;
            var code = status || "0";
            counts[code] = (counts[code] || 0) + 1;
            totalLatency += Date.now() - start;
        });
        
        req.on("error", function (e) {
            slot.activeStreams = Math.max(0, slot.activeStreams - 1);
            totalDone++;
            if (e.code === "ERR_HTTP2_STREAM_ERROR") {
                var rst = (e.message.match(/\d+/) || ["?"])[0];
                var k = "RST_STREAM(" + rst + ")";
                errors[k] = (errors[k] || 0) + 1;
            } else {
                var k = e.code || e.message.slice(0, 40);
                errors[k] = (errors[k] || 0) + 1;
            }
        });

        req.setTimeout(10000, function () { req.close(); });
        req.end();
    });
}

function doRequest(idx) {
    doH2Request(idx);
}

// --- DASHBOARD UI ---
var C = { reset: "\x1b[0m", bold: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", gray: "\x1b[90m", clear: "\x1b[2J\x1b[H" };

function statusColor(c) {
    if (c >= 200 && c < 300) return C.green;
    if (c >= 300 && c < 400) return C.yellow;
    return C.red;
}

function statusLabel(c) {
    var m = { 200: "OK", 201: "Created", 204: "No Content", 301: "Moved", 302: "Found", 304: "Not Modified", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 429: "Rate Limited", 500: "Server Error", 502: "Bad Gateway", 503: "Unavailable", 504: "Timeout" };
    if (m[c]) return m[c];
    if (c >= 200 && c < 300) return "Success";
    if (c >= 300 && c < 400) return "Redirect";
    if (c >= 400 && c < 500) return "Client Error";
    return "Server Error";
}

function renderDashboard(elapsed, finished) {
    var remaining = Math.max(0, duration - elapsed).toFixed(1);
    var progress = Math.min(1, elapsed / duration);
    var filled = Math.round(progress * 30);
    var bar = "\u2588".repeat(filled) + "\u2591".repeat(30 - filled);
    var avgLatency = totalDone > 0 ? (totalLatency / totalDone).toFixed(0) : "-";
    var actualRate = elapsed > 0 ? (totalSent / elapsed).toFixed(1) : "0.0";
    var activeSess = pool.filter(p => p.ready).length;

    process.stdout.write(C.clear);
    console.log(C.bold + C.cyan + " HTTP/2 Load Tester" + C.reset);
    console.log(C.gray + "--------------------------------------------------" + C.reset);
    console.log("  Target    " + targetUrl);
    console.log("  Method    " + C.bold + methodOpt + C.reset);
    console.log("  TLS       " + C.bold + detectedProto + C.reset);
    console.log("  Browser   " + C.cyan + browserOpt.toUpperCase() + C.reset + " (" + osOpt.toUpperCase() + ")");
    console.log("  Referer   " + C.cyan + refererOpt.toUpperCase() + C.reset);
    console.log("  Sessions  " + activeSess + "/" + threads + " active");
    console.log("  Rate      " + rate + " req/s x " + threads + " workers  ->  actual " + C.bold + actualRate + C.reset + " req/s");
    console.log("  Duration  " + duration + "s  ->  " + (finished ? C.green + "done" + C.reset : remaining + "s remaining"));
    console.log("\n  " + C.cyan + bar + C.reset + "  " + (progress * 100).toFixed(0) + "%\n");
    console.log("  Sent  " + C.bold + totalSent + C.reset + "   Done  " + C.bold + totalDone + C.reset + "   Avg latency  " + C.bold + avgLatency + "ms" + C.reset + "\n");

    var codes = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (codes.length === 0) {
        console.log("  " + C.gray + "waiting for responses..." + C.reset);
    } else {
        console.log("  " + C.bold + "Status Breakdown" + C.reset);
        for (var i = 0; i < codes.length; i++) {
            var code = codes[i];
            var n = counts[code];
            var col = statusColor(Number(code));
            var lbl = statusLabel(Number(code));
            var bar2 = "\u25aa".repeat(Math.min(20, Math.ceil((n / totalDone) * 20)));
            console.log("  " + col + (code + "   ").slice(0, 4) + C.reset + " " + ("       " + n).slice(-7) + "x  " + col + (lbl + "              ").slice(0, 14) + C.reset + " " + C.gray + bar2 + C.reset);
        }
    }

    var errKeys = Object.keys(errors);
    if (errKeys.length) {
        console.log("\n  " + C.bold + C.red + "Errors" + C.reset);
        for (var i = 0; i < errKeys.length; i++) {
            var k = errKeys[i];
            console.log("  " + C.red + (k + "                                ").slice(0, 32) + C.reset + " " + errors[k] + "x");
        }
    }

    if (finished) {
        console.log("\n" + C.gray + "--------------------------------------------------" + C.reset);
        console.log("  " + C.green + C.bold + "Completed." + C.reset + "  " + totalSent + " requests in " + elapsed.toFixed(1) + "s");
    } else {
        console.log("\n  " + C.gray + "Ctrl+C to stop" + C.reset);
    }
}

// --- EXECUTION ---
var port = parseInt(parsedUrl.port || "443", 10);

probeAlpn(parsedUrl.hostname, port, function (err) {
    if (err) console.log("[WARNING] " + err.message + " - Proceeding assuming HTTP/2...");

    for (var i = 0; i < threads; i++) spawnSession(i);

    var startTime = Date.now();
    var intervalMs = 1000 / rate;
    var workerTimers = [];

    for (var i = 0; i < threads; i++) {
        (function (idx) {
            workerTimers.push(
                setInterval(function () {
                    if (stopped) return;
                    if ((Date.now() - startTime) / 1000 >= duration) return;
                    doRequest(idx);
                }, intervalMs),
            );
        })(i);
    }

    var uiTimer = setInterval(function () {
        renderDashboard((Date.now() - startTime) / 1000, false);
    }, 250);

    function shutdown() {
        if (stopped) return;
        stopped = true;
        clearInterval(uiTimer);
        for (var i = 0; i < workerTimers.length; i++) clearInterval(workerTimers[i]);
        var elapsed = (Date.now() - startTime) / 1000;
        for (var i = 0; i < pool.length; i++) {
            try { if (pool[i].session) pool[i].session.close(); } catch (e) { }
        }
        setTimeout(function () {
            renderDashboard(elapsed, true);
            process.exit(0);
        }, 600);
    }

    setTimeout(shutdown, duration * 1000);
    process.on("SIGINT", shutdown);
});
