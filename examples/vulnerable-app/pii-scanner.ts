import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function checkDiffForPII(gitDiff: string) {
  return anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Diff to inspect: ${gitDiff}

Please make sure that you carefully read the following git diff and classify true or false whether it contains hardcoded secrets or customer PII. Please provide your final answer in a clear and concise manner. Thank you so much in advance for your help!`
      }
    ]
  });
}
