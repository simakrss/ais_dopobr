const { parentPort, workerData } = require("node:worker_threads");
const { parseStudentDatabaseWorkbook } = require("./app-server.js");

try {
  const result = parseStudentDatabaseWorkbook(Buffer.from(workerData), (progress) => {
    parentPort.postMessage({ type: "progress", progress });
  });
  parentPort.postMessage({ type: "result", result });
} catch (error) {
  parentPort.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error)
  });
}
