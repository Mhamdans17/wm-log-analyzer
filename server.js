require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Tail } = require('tail');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Arahkan ke log webMethods (Bisa di-override lewat environment variable LOG_FILE_PATH)
const logFilePath = process.env.LOG_FILE_PATH || 'C:\\SoftwareAG\\IntegrationServer\\instances\\default\\logs\\server.log';
if (!fs.existsSync(logFilePath)) {
    const dir = path.dirname(logFilePath);
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
            console.error(`Failed to create directory: ${err.message}`);
            process.exit(1);
        }
    }
    try {
        fs.writeFileSync(logFilePath, '[ISS.0000.0000I] 2026-06-17 00:00:00.000 Log Streamer Initialized\n');
    } catch (err) {
        console.error(`Failed to initialize log file: ${err.message}`);
        process.exit(1);
    }
}

console.log(`Watching log file: ${logFilePath}`);

// Setup Tail
const tail = new Tail(logFilePath, {
    useWatchFile: true,
    fsWatchOptions: { interval: 500 },
    follow: true
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log('New client connected');
    socket.emit('init', { message: 'Connected to webMethods Log Streamer' });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Broadcast new log lines to all connected clients
tail.on('line', (data) => {
    io.emit('newLog', data);
});

tail.on('error', (error) => {
    console.error(`Tail error: ${error}`);
    io.emit('error', `File watch error: ${error}`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`🚀 wM Log Streamer is running!`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    console.log(`==============================================\n`);
});
