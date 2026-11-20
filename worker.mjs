const OPENAI_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-6.2-astra";
const MAX_MESSAGES = 60;
const MAX_MESSAGE_LENGTH = 20000;
const MAX_CONVERSATION_LENGTH = 80000;

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    },
  });
}

function getAllowedOrigin(request, env) {
  const requestOrigin = request.headers.get("Origin");
  return requestOrigin && requestOrigin === env.ALLOWED_ORIGIN
    ? requestOrigin
    : null;
}

function isValidMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_MESSAGES &&
    messages.reduce(
      (total, message) => total + (typeof message?.content === "string" ? message.content.length : 0),
      0
    ) <= MAX_CONVERSATION_LENGTH &&
    messages.every(
      (message) =>
        message &&
        ["system", "user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.length > 0 &&
        message.content.length <= MAX_MESSAGE_LENGTH
    )
  );
}

function getCitations(response) {
  const citations = new Map();

  for (const item of response.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (
          annotation.type === "url_citation" &&
          typeof annotation.url === "string" &&
          /^https?:\/\//i.test(annotation.url)
        ) {
          citations.set(annotation.url, {
            url: annotation.url,
            title:
              typeof annotation.title === "string"
                ? annotation.title
                : annotation.url,
          });
        }
      }
    }
  }

  return [...citations.values()];
}

export default {
  async fetch(request, env) {
    const origin = getAllowedOrigin(request, env);
    if (!origin) {
      return jsonResponse({ error: { message: "Origin is not allowed." } }, 403, "null");
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          Vary: "Origin",
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: { message: "Use POST for chat requests." } }, 405, origin);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse(
        { error: { message: "The Worker is missing its OpenAI API key secret." } },
        500,
        origin
      );
    }

    let requestBody;
    try {
      requestBody = await request.json();
    } catch (error) {
      return jsonResponse({ error: { message: "Request body must be valid JSON." } }, 400, origin);
    }

    if (!isValidMessages(requestBody?.messages)) {
      return jsonResponse(
        { error: { message: "Provide a valid messages array to continue the conversation." } },
        400,
        origin
      );
    }

    let openAIResponse;
    try {
      openAIResponse = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          input: requestBody.messages,
          tools: [{ type: "web_search", search_context_size: "medium" }],
          tool_choice: "auto",
          max_output_tokens: 1200,
          store: false,
        }),
      });
    } catch (error) {
      return jsonResponse(
        { error: { message: "Could not connect to the AI service. Please try again." } },
        502,
        origin
      );
    }

    let result;
    try {
      result = await openAIResponse.json();
    } catch (error) {
      return jsonResponse(
        { error: { message: "The AI service returned an unreadable response." } },
        502,
        origin
      );
    }

    if (!openAIResponse.ok) {
      return jsonResponse(
        {
          error: {
            message:
              result?.error?.message ||
              `The AI service returned an error (HTTP ${openAIResponse.status}).`,
          },
        },
        502,
        origin
      );
    }

    const answer = result.output_text;
    if (typeof answer !== "string" || !answer.trim()) {
      return jsonResponse(
        { error: { message: "The AI service returned no answer. Please try again." } },
        502,
        origin
      );
    }

    const citations = getCitations(result);
    const citedAnswer = citations.length
      ? `${answer}\n\nSources:\n${citations
          .map((citation) => `- [${citation.title}](${citation.url})`)
          .join("\n")}`
      : answer;

    return jsonResponse(
      { choices: [{ message: { role: "assistant", content: citedAnswer } }] },
      200,
      origin
    );
  },
};
