import { ModelResolver } from "opencode-model-resolver";

const resolver = new ModelResolver();
const provider = "github-copilot";

const models = await resolver.fetchModels(provider);
console.log(`Fetched ${Object.keys(models).length} models for ${provider}`);

const presets = ["quality", "fast", "writing-quality", "writing-analysis", "writing-fast", "claude-sonnet"];
for (const p of presets) {
  const config = p.startsWith("claude") ? { family: p } : { preset: p };
  const resolved = await resolver.resolveStepModel(config, "github-copilot");
  console.log(`${p.padEnd(20)} -> ${resolved.modelID}`);
}
