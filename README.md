# L'Oréal Routine Builder

The Routine Edit lets you browse the product collection, search by name or ingredient, filter by category, and select products for a personalized routine. Product selections are saved in your browser. The chat remembers the routine conversation, and the language-direction control switches the layout to right-to-left mode.

## Run the site

Serve the project files from a local web server so the browser can load `products.json`. For example, use the VS Code Live Server extension and open `index.html`.

## Connect a Cloudflare Worker

The frontend calls a Cloudflare Worker; it never sends an API key from the browser. This repository includes a ready-to-deploy Worker in `worker.mjs`. It uses OpenAI's Responses API with web search and returns web citations as clickable source links in the chat.

1. In the Cloudflare dashboard, create a Worker and paste in the contents of `worker.mjs`.
2. In the Worker settings, add `OPENAI_API_KEY` as a **secret**. Do not put the key in this repository or in `script.js`.
3. Add `ALLOWED_ORIGIN` as a plain-text variable containing the exact origin where this site is hosted, such as `https://your-site.example` (no trailing slash). For local development, use your local server's origin instead.
4. Deploy the Worker and copy its `workers.dev` URL.
5. Set `WORKER_URL` at the top of `script.js` to that URL, including its trailing slash, then reload the site.

The Worker restricts browser requests to the configured site origin. This is a browser restriction, not authentication: add a Cloudflare rate-limiting rule for the Worker to help protect your API usage. If you change where the site is hosted, update `ALLOWED_ORIGIN` and deploy the Worker again. Web search requires an OpenAI account with access to the configured model and API usage enabled.

This repository does not contain a deployed Worker URL or Cloudflare credentials, so the Worker must be deployed in your Cloudflare account before AI features can connect.
