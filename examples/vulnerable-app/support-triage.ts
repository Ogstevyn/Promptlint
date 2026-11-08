import OpenAI from "openai";

// Direct upstream SDK initialization (triggers PL007: Not routed via Mozilla Otari)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function triageCustomerTicket(
  customerMessage: string,
  accountTier: string
) {
  // Triggers PL001 (Injection), PL002 (Boundary), PL003 (Prefix cache),
  // PL004 (Verbose filler), PL005 (Frontier model for classification),
  // PL006 (Missing max_tokens), PL008 (Missing Idempotency-Key)
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: `Customer message: ${customerMessage} (Account Tier: ${accountTier})

Please could you kindly read the customer support message above very carefully. I would really appreciate it if you could classify the sentiment as positive, negative, or neutral, and categorize the ticket into billing, technical, or general. It is extremely important and critical that you do not forget to return valid JSON. Thank you so much in advance for your help!`
      }
    ]
  });

  return response.choices[0].message.content;
}
