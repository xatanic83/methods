var http2 = require("http2");
var https = require("https");
var tls = require("tls");
var URL = require("url").URL;

var REFERERS = [
    "https://www.google.com/",
    "https://www.google.co.id/",
    "https://www.bing.com/",
    "https://yandex.com/",
    "https://search.brave.com/",
    "https://duckduckgo.com/",
];

var LANGS = [
    "en-US,en;q=0.9",
    "en-GB,en;q=0.9",
    "en-US,en;q=0.8,fr;q=0.7",
    "id-ID,id;q=0.9,en;q=0.8",
];

var UA_IOS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
];

function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickUA() {
    return rand(UA_IOS);
}

function chromeVer(ua) {
    var m = ua.match(/Chrome\/(\d+)/);
    return m ? m[1] : "124";
}

var globalCfClearance = "";

function randStr(length) {
    var result = "";
    var characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(
            Math.floor(Math.random() * charactersLength),
        );
    }
    return result;
}

function buildH2Headers(path, host) {
    var ua = pickUA();
    return {
        ":method": "GET",
        ":path": path,
        ":scheme": "https",
        ":authority": host,
        "user-agent": ua,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": rand(LANGS),
        "cache-control": "max-age=0, no-cache, no-store, must-revalidate",
        pragma: "no-cache",
        cookie:
            "session=" +
            randStr(16) +
            (globalCfClearance
                ? "; cf_clearance=" + globalCfClearance
                : "; cf_clearance=" + randStr(32)),
        authorization: "Bearer " + randStr(24),
        referer: rand(REFERERS),
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
    };
}

function buildH1Headers() {
    var ua = pickUA();
    return {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": rand(LANGS),
        Referer: rand(REFERERS),
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
        Connection: "keep-alive",
    };
}

var args = process.argv.slice(2);

if (args.length < 3) {
    console.log("Usage: node main.js <url> <time> <rate>");
    console.log("  url  : https://example.com");
    console.log("  time : duration in seconds  e.g. 30");
    console.log("  rate : requests per second  e.g. 5");
    process.exit(1);
}

var targetUrl = args[0];
var duration = parseFloat(args[1]);
var rate = parseFloat(args[2]);
var threads = 4;

if (isNaN(duration) || duration <= 0) {
    console.log("Error: time harus > 0");
    process.exit(1);
}
if (isNaN(rate) || rate <= 0) {
    console.log("Error: rate harus > 0");
    process.exit(1);
}

var parsedUrl;
try {
    parsedUrl = new URL(targetUrl);
} catch (e) {
    console.log("Error: URL tidak valid - " + targetUrl);
    process.exit(1);
}

if (parsedUrl.protocol !== "https:") {
    console.log("Error: gunakan HTTPS");
    process.exit(1);
}

var stopped = false;
var totalSent = 0;
var totalDone = 0;
var totalLatency = 0;
var detectedProto = "HTTP/2 + TLS";
var counts = {};
var errors = {};

function probeAlpn(hostname, port, cb) {
    var sock = tls.connect(
        {
            host: hostname,
            port: port,
            servername: hostname,
            ALPNProtocols: ["h2", "http/1.1"],
            minVersion: "TLSv1.2",
            rejectUnauthorized: false,
            checkServerIdentity: function () {
                return undefined;
            },
            timeout: 5000,
        },
        function () {
            var proto = sock.alpnProtocol;
            sock.destroy();
            if (proto === "h2") cb(null);
            else
                cb(
                    new Error(
                        "Server tidak support HTTP/2. ALPN: " +
                        (proto || "none"),
                    ),
                );
        },
    );
    sock.on("error", function (e) {
        cb(new Error("TLS gagal: " + e.message));
    });
    sock.on("timeout", function () {
        sock.destroy();
        cb(new Error("Probe timeout"));
    });
}

var pool = [];
for (var pi = 0; pi < threads; pi++) {
    pool.push({
        session: null,
        ready: false,
        connecting: false,
        queue: [],
        activeStreams: 0,
    });
}

var H2_OPTS = {
    rejectUnauthorized: false,
    checkServerIdentity: function () {
        return undefined;
    },
    servername: parsedUrl.hostname,
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
        if (!stopped)
            setTimeout(function () {
                spawnSession(idx);
            }, 300);
    }

    sess.on("error", onDead);
    sess.on("close", onDead);
    sess.on("goaway", onDead);

    var ht = setTimeout(function () {
        if (!slot.ready) sess.destroy();
    }, 6000);
    sess.once("connect", function () {
        clearTimeout(ht);
    });
}

function getSession(idx, callback) {
    var slot = pool[idx];
    if (slot.ready && slot.session && !slot.session.destroyed)
        return callback(slot.session);
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
        var path =
            parsedUrl.pathname +
            (parsedUrl.search ? parsedUrl.search + "&" : "?") +
            rnd;
        var start = Date.now();
        totalSent++;
        slot.activeStreams++;

        var req;
        try {
            req = sess.request(buildH2Headers(path, parsedUrl.host));
        } catch (e) {
            totalSent--;
            slot.activeStreams--;
            if (
                e.code !== "ERR_HTTP2_INVALID_SESSION" &&
                e.code !== "ERR_HTTP2_GOAWAY_SESSION"
            ) {
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

        req.setTimeout(10000, function () {
            req.close();
        });
        req.end();
    });
}

function doH1Request() {
    var start = Date.now();
    totalSent++;

    var rnd = randStr(8) + "=" + randStr(8);
    var path =
        parsedUrl.pathname +
        (parsedUrl.search ? parsedUrl.search + "&" : "?") +
        rnd;
    var opts = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: path,
        method: "GET",
        headers: buildH1Headers(),
        rejectUnauthorized: false,
        checkServerIdentity: function () {
            return undefined;
        },
        servername: parsedUrl.hostname,
    };

    var req = https.request(opts, function (res) {
        res.resume();
        res.on("end", function () {
            totalDone++;
            var code = String(res.statusCode || "0");
            counts[code] = (counts[code] || 0) + 1;
            totalLatency += Date.now() - start;
        });
    });

    req.on("error", function (e) {
        totalDone++;
        var k = e.code || e.message.slice(0, 40);
        errors[k] = (errors[k] || 0) + 1;
    });

    req.setTimeout(10000, function () {
        req.destroy();
    });
    req.end();
}

function doRequest(idx) {
    doH2Request(idx);
}

var C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    gray: "\x1b[90m",
    clear: "\x1b[2J\x1b[H",
};

function statusColor(c) {
    if (c >= 200 && c < 300) return C.green;
    if (c >= 300 && c < 400) return C.yellow;
    return C.red;
}

function statusLabel(c) {
    var m = {
        200: "OK",
        201: "Created",
        204: "No Content",
        301: "Moved",
        302: "Found",
        304: "Not Modified",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        429: "Rate Limited",
        500: "Server Error",
        502: "Bad Gateway",
        503: "Unavailable",
        504: "Timeout",
    };
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
    var bar = "";
    for (var i = 0; i < filled; i++) bar += "\u2588";
    for (var i = filled; i < 30; i++) bar += "\u2591";
    var avgLatency =
        totalDone > 0 ? (totalLatency / totalDone).toFixed(0) : "-";
    var actualRate = elapsed > 0 ? (totalSent / elapsed).toFixed(1) : "0.0";
    var activeSess = 0;
    for (var i = 0; i < pool.length; i++) {
        if (pool[i].ready) activeSess++;
    }

    process.stdout.write(C.clear);
    console.log(C.bold + C.cyan + " HTTP/2 Load Tester" + C.reset);
    console.log(
        C.gray + "--------------------------------------------------" + C.reset,
    );
    console.log("  Target    " + targetUrl);
    console.log("  TLS       " + C.bold + detectedProto + C.reset);
    console.log(
        "  Browser   " + C.cyan + "MobileSafari" + C.reset + "  100% iOS",
    );
    console.log("  Protocol  " + C.cyan + "100% HTTP/2" + C.reset);
    console.log("  Sessions  " + activeSess + "/" + threads + " active");
    console.log(
        "  Rate      " +
        rate +
        " req/s x " +
        threads +
        " workers  ->  actual " +
        C.bold +
        actualRate +
        C.reset +
        " req/s",
    );
    console.log(
        "  Duration  " +
        duration +
        "s  ->  " +
        (finished ? C.green + "done" + C.reset : remaining + "s remaining"),
    );
    console.log();
    console.log(
        "  " +
        C.cyan +
        bar +
        C.reset +
        "  " +
        (progress * 100).toFixed(0) +
        "%",
    );
    console.log();
    console.log(
        "  Sent  " +
        C.bold +
        totalSent +
        C.reset +
        "   Done  " +
        C.bold +
        totalDone +
        C.reset +
        "   Avg latency  " +
        C.bold +
        avgLatency +
        "ms" +
        C.reset,
    );
    console.log();

    var codes = Object.keys(counts).sort(function (a, b) {
        return counts[b] - counts[a];
    });
    if (codes.length === 0) {
        console.log("  " + C.gray + "waiting for responses..." + C.reset);
    } else {
        console.log("  " + C.bold + "Status Breakdown" + C.reset);
        for (var i = 0; i < codes.length; i++) {
            var code = codes[i];
            var n = counts[code];
            var col = statusColor(Number(code));
            var lbl = statusLabel(Number(code));
            var bar2 = "";
            var blen = Math.min(20, Math.ceil((n / totalDone) * 20));
            for (var j = 0; j < blen; j++) bar2 += "\u25aa";
            console.log(
                "  " +
                col +
                (code + "   ").slice(0, 4) +
                C.reset +
                " " +
                ("       " + n).slice(-7) +
                "x  " +
                col +
                (lbl + "              ").slice(0, 14) +
                C.reset +
                " " +
                C.gray +
                bar2 +
                C.reset,
            );
        }
    }

    var errKeys = Object.keys(errors);
    if (errKeys.length) {
        console.log();
        console.log("  " + C.bold + C.red + "Errors" + C.reset);
        for (var i = 0; i < errKeys.length; i++) {
            var k = errKeys[i];
            console.log(
                "  " +
                C.red +
                (k + "                                ").slice(0, 32) +
                C.reset +
                " " +
                errors[k] +
                "x",
            );
        }
    }

    if (finished) {
        console.log();
        console.log(
            C.gray +
            "--------------------------------------------------" +
            C.reset,
        );
        console.log(
            "  " +
            C.green +
            C.bold +
            "Completed." +
            C.reset +
            "  " +
            totalSent +
            " requests in " +
            elapsed.toFixed(1) +
            "s",
        );
    } else {
        console.log();
        console.log("  " + C.gray + "Ctrl+C to stop" + C.reset);
    }
}

var port = parseInt(parsedUrl.port || "443", 10);

probeAlpn(parsedUrl.hostname, port, function (err) {
    if (err) {
        console.log(
            "[WARNING] " +
            err.message +
            " - Tetap melanjutkan asumsi HTTP/2...",
        );
    }

    detectedProto = "HTTP/2 + TLS 1.3";

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
        for (var i = 0; i < workerTimers.length; i++)
            clearInterval(workerTimers[i]);
        var elapsed = (Date.now() - startTime) / 1000;
        for (var i = 0; i < pool.length; i++) {
            try {
                if (pool[i].session) pool[i].session.close();
            } catch (e) { }
        }
        setTimeout(function () {
            renderDashboard(elapsed, true);
            process.exit(0);
        }, 600);
    }

    setTimeout(shutdown, duration * 1000);
    process.on("SIGINT", shutdown);
});
