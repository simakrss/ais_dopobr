const { parentPort, workerData } = require("node:worker_threads");
const { parseStudentDatabaseWorkbook } = require("./app-server.js");

try {
  const workerPayload = workerData && typeof workerData === "object" && workerData.bytes
    ? workerData
    : { bytes: workerData, options: {} };
  const result = parseStudentDatabaseWorkbook(Buffer.from(workerPayload.bytes), (progress) => {
    parentPort.postMessage({ type: "progress", progress });
  }, workerPayload.options || {});
  parentPort.postMessage({ type: "result", result });
} catch (error) {
  parentPort.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error)
  });
}
