require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Tail } = require('tail');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const newman = require('newman');

// Setup multer for file uploads
const upload = multer({ dest: 'uploads/' });

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

// --- NEWMAN API ROUTE ---
app.post('/api/newman/run', upload.fields([{ name: 'collection', maxCount: 1 }, { name: 'data', maxCount: 1 }]), (req, res) => {
    if (!req.files || !req.files['collection']) {
        return res.status(400).json({ error: 'Collection file is required.' });
    }

    const collectionPath = req.files['collection'][0].path;
    const dataPath = req.files['data'] ? req.files['data'][0].path : null;
    const baseUrl = req.body.baseUrl;
    const expectedJsonField = req.body.expectedJsonField;
    const expectedJsonValue = req.body.expectedJsonValue;

    // --- DYNAMIC ASSERTION INJECTION ---
    if (expectedJsonField && expectedJsonValue) {
        try {
            let colData = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
            let scripts = [];
            
            scripts.push(`
                let expFieldVal = pm.variables.replaceIn("${expectedJsonValue}");
                if (expFieldVal !== undefined && expFieldVal !== "") {
                    pm.test("UI Assertion: JSON Field '" + "${expectedJsonField}" + "' equals " + expFieldVal, function () {
                        var jsonData = pm.response.json();
                        
                        // Navigate path
                        var path = "${expectedJsonField}".split('.');
                        var current = jsonData;
                        for (var i = 0; i < path.length; i++) {
                            if (current === undefined) break;
                            current = current[path[i]];
                        }
                        
                        pm.expect(String(current)).to.eql(String(expFieldVal));
                    });
                }
            `);
            
            if (!colData.event) colData.event = [];
            let testEvent = colData.event.find(e => e.listen === 'test');
            if (testEvent) {
                if (testEvent.script && testEvent.script.exec) {
                    testEvent.script.exec = testEvent.script.exec.concat(scripts);
                } else {
                    testEvent.script = { type: 'text/javascript', exec: scripts };
                }
            } else {
                colData.event.push({
                    listen: 'test',
                    script: { type: 'text/javascript', exec: scripts }
                });
            }
            
            fs.writeFileSync(collectionPath, JSON.stringify(colData));
        } catch (e) {
            console.error('Error injecting UI assertions:', e);
        }
    }
    // -----------------------------------

    let envVars = [];
    if (baseUrl) {
        envVars.push({ key: 'baseUrl', value: baseUrl });
    }

    const reportFilename = `report-${Date.now()}.html`;
    const reportPath = path.join(__dirname, 'public', 'reports', reportFilename);

    const newmanOptions = {
        collection: collectionPath,
        reporters: ['cli', 'htmlextra'],
        reporter: {
            htmlextra: {
                export: reportPath
            }
        },
        envVar: envVars
    };

    if (dataPath) {
        newmanOptions.iterationData = dataPath;
    }

    newman.run(newmanOptions, function (err, summary) {
        // Clean up uploaded files after run
        try {
            fs.unlinkSync(collectionPath);
            if (dataPath) fs.unlinkSync(dataPath);
        } catch (e) {
            console.error('Error cleaning up files:', e);
        }

        if (err) {
            console.error('Newman execution error:', err);
            return res.status(500).json({ error: 'Newman execution failed: ' + err.message });
        }

        // Map executions for the frontend
        const executions = summary.run.executions.map(exec => {
            return {
                name: exec.item ? exec.item.name : 'Unknown Request',
                responseCode: exec.response ? exec.response.code : null,
                assertions: exec.assertions ? exec.assertions.map(a => ({
                    name: a.assertion,
                    error: a.error ? a.error.message : null
                })) : []
            };
        });

        res.json({
            summary: {
                iterations: summary.run.stats.iterations,
                requests: summary.run.stats.requests,
                assertions: summary.run.stats.assertions
            },
            executions: executions,
            reportUrl: '/reports/' + reportFilename
        });
    });
});
// ------------------------

const PORT = process.env.PORT || 3000;

app.get('/api/newman/reports', (req, res) => {
    const reportsDir = path.join(__dirname, 'public', 'reports');
    if (!fs.existsSync(reportsDir)) return res.json([]);
    const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.html'));
    files.sort((a, b) => {
        return fs.statSync(path.join(reportsDir, b)).mtime.getTime() - 
               fs.statSync(path.join(reportsDir, a)).mtime.getTime();
    });
    res.json(files);
});

app.delete('/api/newman/reports', (req, res) => {
    const reportsDir = path.join(__dirname, 'public', 'reports');
    if (fs.existsSync(reportsDir)) {
        const files = fs.readdirSync(reportsDir);
        for (const file of files) {
            if (file.endsWith('.html')) {
                try {
                    fs.unlinkSync(path.join(reportsDir, file));
                } catch(e) {}
            }
        }
    }
    res.json({ success: true });
});

server.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`🚀 wM Log Streamer is running!`);
    console.log(`Open http://localhost:${PORT} in your browser`);
    console.log(`==============================================\n`);
});
