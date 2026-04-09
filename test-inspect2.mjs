import { createOpencodeClient } from "@opencode-ai/sdk";

const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4097" });

const sessionResp = await client.session.create({ body: { title: "corina-test-inspect2" } });
const sessionId = sessionResp.data?.id;
console.log("Session:", sessionId);

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

console.log("\n=== info.structured ===");
console.log(JSON.stringify(result.data?.info?.structured, null, 2));

console.log("\n=== ALL PARTS ===");
for (const part of result.data?.parts || []) {
  console.log(JSON.stringify(part, null, 2).slice(0, 500));
  console.log("---");
}

await client.session.delete({ path: { id: sessionId } });
process.exit(0);
