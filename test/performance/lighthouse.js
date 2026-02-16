import fs from 'fs';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { spawn } from 'child_process';

let serverPort = 5173;

const startServer = () => {
  return new Promise((resolve, reject) => {
    console.log('Spawning server...');
    // Use npm.cmd on Windows to avoid shell: true (Command Injection risk)
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const server = spawn(npmCommand, ['run', 'preview', '--', '--port', '5173'], { shell: false });
    let resolved = false;

    server.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output); // Log output to debug
      
      // Strip ANSI codes for better matching
      const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '');
      const match = cleanOutput.match(/http:\/\/localhost:(\d+)/);
      if (match) {
          serverPort = parseInt(match[1], 10);
          console.log(`Detected server port: ${serverPort}`);
      }

      // Check for "Local" or "localhost" to detect readiness
      if (!resolved && (output.includes('Local') || output.includes('localhost'))) {
        console.log('Server is ready!');
        resolved = true;
        resolve(server);
      }
    });

    server.stderr.on('data', (data) => {
      console.error(`[Server Stderr]: ${data}`);
    });

    server.on('error', (err) => {
      reject(err);
    });

    // Timeout after 60 seconds
    setTimeout(() => {
        if (!resolved) {
            console.log('Timeout waiting for server start signal. Proceeding anyway...');
            resolved = true;
            resolve(server);
        }
    }, 60000);
  });
};

(async () => {
  let server;
  let chrome;
  try {
    server = await startServer();

    // Wait a bit for the server to be fully responsive
    await new Promise(resolve => setTimeout(resolve, 2000));

    chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
    const options = {logLevel: 'info', output: 'html', onlyCategories: ['performance'], port: chrome.port};
    console.log(`Running Lighthouse on http://localhost:${serverPort}`);
    const runnerResult = await lighthouse(`http://localhost:${serverPort}`, options);

    // `.report` is the HTML report as a string
    const reportHtml = runnerResult.report;
    fs.writeFileSync('lhreport.html', reportHtml);

    // `.lhr` is the Lighthouse Result as a JS object
    console.log('Report is done for', runnerResult.lhr.finalUrl);
    console.log('Performance score was', runnerResult.lhr.categories.performance.score * 100);

    const audits = runnerResult.lhr.audits;
    const failedAudits = Object.values(audits).filter(audit => audit.score !== 1 && audit.score !== null && audit.score < 0.9);
    console.log('Failed Audits:');
    failedAudits.forEach(audit => {
        console.log(`${audit.title}: ${audit.score} - ${audit.displayValue}`);
    });

  } catch (error) {
    console.error('Error running lighthouse:', error);
    process.exitCode = 1;
  } finally {
    if (chrome) {
      await chrome.kill();
    }
    if (server) {
      console.log('Killing server...');
      server.kill();
    }
    process.exit();
  }
})();
