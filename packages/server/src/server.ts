import { createPromptLintServer } from "./app";

const PORT = Number(process.env.PORT || 4000);
const server = createPromptLintServer();

server.listen(PORT, () => {
  console.log(`===================================================================`);
  console.log(`  PromptLint Backend API Server listening on http://localhost:${PORT}`);
  console.log(`  Mozilla Otari Gateway URL: ${process.env.OTARI_BASE_URL || "https://api.otari.ai/api/v1"}`);
  console.log(`===================================================================`);
});
