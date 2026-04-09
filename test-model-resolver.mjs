import { ModelResolver } from "opencode-model-resolver";

const resolver = new ModelResolver();
const provider = "github-copilot";

const models = await resolver.fetchModels(provider);
console.log(`Fetched ${Object.keys(models).length} models for ${provider}`);

const quality = await resolver.resolveStepModel({ preset: "quality" }, provider);
console.log(`quality -> ${quality.modelID}`);

const fast = await resolver.resolveStepModel({ preset: "fast" }, provider);
console.log(`fast -> ${fast.modelID}`);

const sonnet = await resolver.resolveStepModel({ family: "claude-sonnet" }, provider);
console.log(`claude-sonnet -> ${sonnet.modelID}`);
