import { createOpencodeClient } from "@opencode-ai/sdk";

// Connect to already-running server
const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4097" });
console.log("Client connected to http://127.0.0.1:4097");

// Create a session
const sessionResp = await client.session.create({ body: { title: "corina-test-inspect" } });
const sessionId = sessionResp.data?.id;
console.log("Session created:", sessionId);

// Send a structured output prompt
const result = await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: "Return this JSON exactly: {\"test\": true, \"value\": 42}" }],
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          test: { type: "boolean" },
          value: { type: "number" }
        },
        required: ["test", "value"]
      }
    }
  }
});

console.log("\n=== TOP-LEVEL KEYS ===");
console.log(Object.keys(result));
console.log("\n=== result.data keys ===");
console.log(result.data ? Object.keys(result.data) : "no data");
console.log("\n=== result.data.info keys ===");
console.log(result.data?.info ? Object.keys(result.data.info) : "no info");
console.log("\n=== structured_output ===");
console.log(result.data?.info?.structured_output);
console.log("\n=== parts[0] ===");
console.log(JSON.stringify(result.data?.parts?.[0], null, 2));

await client.session.delete({ path: { id: sessionId } });
console.log("\nDone.");
process.exit(0);
